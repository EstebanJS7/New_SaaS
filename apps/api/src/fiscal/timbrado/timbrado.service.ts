import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  buildEventGroupXml,
  DteEventValidationError,
  EVENT_REASON_MAX_LENGTH,
  EVENT_REASON_MIN_LENGTH,
  FISCAL_CREDENTIAL_PORT,
  FISCAL_PROVIDER,
  formatDocumentNumber,
  INUTILIZACION_DOCUMENT_TYPE_VALUES,
  signEventXml,
  type DteInutilizacionDocumentType,
  type FiscalCredentialPort,
  type FiscalIssueDocument,
  type FiscalProviderPort,
  type FiscalRangeVoidOutcome,
  type FiscalRangeVoidResult,
  type FiscalSigningEnvironment,
  type FiscalTransportCredential,
} from "@newsaas/fiscal";
import { AuditWriter } from "../../audit/audit-writer.service.js";
import { RequestContextService } from "../../context/request-context.service.js";
import { EntitlementsService } from "../../entitlements/entitlements.service.js";
import { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import { runWithinDeadline } from "../fiscal.deadline.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import { scrubProviderText } from "../fiscal.provider-text.js";
import { assertProfileRucMatchesCertificates } from "../fiscal-ruc-consistency.js";
import { FISCAL_SIGNING_ENVIRONMENT, formatFiscalTimestamp } from "../fiscal.service.js";
import { FiscalSigningMaterialRepository } from "../signing-material/signing-material.repository.js";
import {
  type EmitterProfileRow,
  type EstablishmentRow,
  type FiscalProfileClient,
  FiscalProfileRepository,
  type FiscalRangeVoidWriteRow,
  type TimbradoRangeRow,
} from "./timbrado.repository.js";

export const FISCAL_FEATURE_NOT_ENTITLED_MESSAGE =
  "The fiscal capability is not enabled for this tenant.";
export const FISCAL_PROFILE_NOT_FOUND_MESSAGE = "The emitter fiscal profile was not found.";
export const FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE = "The establishment was not found.";
export const FISCAL_RANGE_NOT_FOUND_MESSAGE = "The timbrado range was not found.";

export const FISCAL_PROFILE_SAVED_ACTION = "fiscal.profile.saved";
export const FISCAL_ESTABLISHMENT_SAVED_ACTION = "fiscal.establishment.saved";
export const FISCAL_RANGE_CREATED_ACTION = "fiscal.timbrado_range.created";
export const FISCAL_RANGE_RETIRED_ACTION = "fiscal.timbrado_range.retired";
/** FISC-016 WU-D: the void's two outcomes, one audit row each. */
export const FISCAL_RANGE_VOIDED_ACTION = "fiscal.timbrado_range.voided";
export const FISCAL_RANGE_VOID_FAILED_ACTION = "fiscal.timbrado_range.void_failed";

/**
 * `rEve/@Id` for a lot of one: its ordinal, the strategy FISC-016 pinned (§25.7).
 *
 * The same value the cancellation uses, and for the same reason — the schema
 * states no uniqueness for the identifier, and a lot that carries one event has
 * one ordinal.
 */
export const FISCAL_RANGE_VOID_EVENT_ID = "1" as const;

/** Deadline for one synchronous provider void call, the cancellation's own bound. */
export const FISCAL_RANGE_VOID_TIMEOUT_MS = 10_000;
export const FISCAL_RANGE_VOID_TIMEOUT_REASON_CODE = "FISCAL_RANGE_VOID_TIMEOUT";
export const FISCAL_RANGE_VOID_TIMEOUT_REASON = "The fiscal provider did not respond in time.";

/**
 * How long an `IN_FLIGHT` claim holds before a fresh call may adopt it: sixty
 * seconds, six times the provider deadline, so the bounded call is always
 * decided before its claim can be adopted and an adoption never races a
 * submission that is still running. Without a lease a deadline would wedge the
 * range forever; with a live lease a second arrival is refused by name.
 */
export const FISCAL_RANGE_VOID_CLAIM_LEASE_MS = 60_000;

/**
 * The named refusals, one per state the schema does not assert (§25.7).
 *
 * Each is a state the caller cannot talk its way out of with a different body:
 * the range is retired, it has nothing left to void, or its document type cannot
 * be expressed in the event at all. Naming them is what keeps a refusal from
 * being silently reported as a success.
 */
export const FISCAL_RANGE_VOID_RETIRED_MESSAGE =
  "The timbrado range is retired: its consumed numbers are burnt and can never be reissued.";
export const FISCAL_RANGE_VOID_EXHAUSTED_MESSAGE =
  "The timbrado range has no numbers left to void: its tail is empty because every number up to its " +
  "authorised end has been consumed.";
export const FISCAL_RANGE_VOID_DOCUMENT_TYPE_MESSAGE =
  "The timbrado range's document type cannot be expressed in an inutilización, which admits 1..9.";
export const FISCAL_RANGE_VOID_CHANGED_MESSAGE =
  "The timbrado range changed while the void was in progress.";
export const FISCAL_RANGE_VOID_IN_FLIGHT_MESSAGE =
  "The timbrado range is already being voided: its submission is in flight.";
export const FISCAL_RANGE_VOID_NO_CLAIM_MESSAGE =
  "The timbrado range is voiding but has no open claim to resume: the range and its void record disagree.";
export const FISCAL_RANGE_VOID_REFUSED_MESSAGE = "The fiscal provider refused the range void.";
export const FISCAL_RANGE_VOID_REASON_MESSAGE =
  `A range void reason must carry ${String(EVENT_REASON_MIN_LENGTH)}..` +
  `${String(EVENT_REASON_MAX_LENGTH)} characters, the domain the event's mOtEve declares.`;

/** What the routes return for a profile. */
export interface EmitterProfileView {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: readonly { code: string; description: string }[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EstablishmentView {
  readonly id: string;
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly cityCode: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TimbradoRangeView {
  readonly id: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly timbradoNumber: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: Date;
  readonly nextNumber: number;
  readonly status: TimbradoRangeRow["status"];
}

/**
 * What a void attempt left behind: the row that records it.
 *
 * The provider's answer is reported in its own columns — the outcome, its code,
 * its message and its reference — and the operator's `reason` is kept apart from
 * the provider's message, because one is the tenant's own text and the other is a
 * service's.
 */
export interface FiscalRangeVoidView {
  readonly id: string;
  readonly rangeId: string;
  readonly fromNumber: number;
  readonly toNumber: number;
  readonly reason: string;
  readonly outcome: FiscalRangeVoidOutcome;
  readonly reasonCode: string | null;
  readonly providerReason: string | null;
  readonly providerReference: string | null;
  readonly rangeStatus: TimbradoRangeRow["status"];
  readonly createdAt: Date;
}

export interface SaveProfileInput {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly responsibleIssuerType: number | null;
  readonly responsibleIssuerTypeName: string | null;
  readonly responsibleIssuerId: string | null;
  readonly responsibleIssuerName: string | null;
  readonly responsibleIssuerRole: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: readonly { code: string; description: string }[];
}

export interface SaveEstablishmentInput {
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly addressComplement1: string | null;
  readonly addressComplement2: string | null;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly districtName: string | null;
  readonly cityCode: number;
  readonly cityName: string;
  readonly phone: string;
  readonly email: string;
  readonly branchName: string | null;
}

export interface CreateRangeInput {
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly timbradoNumber: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: Date;
}

/**
 * The operator-facing surface for the emitter profile and its numbering ranges.
 *
 * Gate order matches the rest of the Fiscal boundary: the `fiscal` entitlement
 * first, then `fiscal.profile.manage`. Every write is one transaction spanning
 * the rows and the audit row, so an unaudited change is structurally impossible.
 *
 * **Nothing here allocates a number.** The allocation is
 * `allocateDocumentNumber` over the Prisma store, and it is deliberately not a
 * route: exposing it would let a caller burn numbers without issuing anything.
 */
@Injectable()
export class FiscalProfileService {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalProfileClient,
    private readonly repository: FiscalProfileRepository,
    private readonly context: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly entitlements: EntitlementsService,
    private readonly permissionResolver: PermissionResolver,
    /**
     * FISC-011 WU-G: the RUC obligation (baseline §22.4, `D101`) is between this
     * profile and the tenant's certificates, so the write path needs to read
     * them. It reads only; nothing here writes signing material.
     */
    private readonly signingMaterials: FiscalSigningMaterialRepository,
    /**
     * FISC-016 WU-D: voiding a range reaches the tax administration, so this
     * surface needs the provider boundary. It is the same port the cancellation
     * uses — one adapter per deployment, selected by `FISCAL_PROVIDER`, never
     * one per caller.
     */
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProviderPort,
    /**
     * The tenant's signing material, read **per call** inside the void and never
     * cached (ADR-008 §2): a rotation has to reach the next submission without a
     * restart.
     */
    @Inject(FISCAL_CREDENTIAL_PORT) private readonly credentialPort: FiscalCredentialPort,
    /**
     * The environment the void's own signing reads use, resolved once by the
     * module from the same two variables the adapter was built with (ADR-008 §3):
     * the material a void signs with and the material it authenticates with stay
     * in one environment.
     */
    @Inject(FISCAL_SIGNING_ENVIRONMENT)
    private readonly signingEnvironment: FiscalSigningEnvironment
  ) {}

  async getProfile(): Promise<EmitterProfileView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const row = await this.repository.findProfile();
    if (row === null) {
      throw new DomainError("NOT_FOUND", FISCAL_PROFILE_NOT_FOUND_MESSAGE);
    }
    return toProfileView(row, row.activities);
  }

  async listEstablishments(): Promise<EstablishmentView[]> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    return (await this.repository.listEstablishments()).map(toEstablishmentView);
  }

  async listRanges(): Promise<TimbradoRangeView[]> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    return (await this.repository.listRanges()).map(toRangeView);
  }

  async saveProfile(input: SaveProfileInput): Promise<EmitterProfileView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();
    const { activities, ...profile } = input;

    // Before the write, not inside it: the certificate read is a cheap,
    // tenant-scoped read, and refusing here keeps the transaction's contents
    // exactly what they were — the rows plus their audit record.
    assertProfileRucMatchesCertificates({
      profile,
      materials: await this.signingMaterials.listActive(),
    });

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await this.repository.upsertProfile(profile, activities, tx);
      await this.audit.append(
        {
          action: FISCAL_PROFILE_SAVED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_emitter_profile",
          targetId: saved.id,
          // Field NAMES only: a profile carries a RUC and an address, and the
          // audit row is not the place for either.
          metadata: {
            schemaVersion: 1,
            fields: Object.keys(profile).sort(),
            activityCount: activities.length,
          },
        },
        tx
      );
      return saved;
    });
    // The rows the upsert just wrote, not a reconstructed shape: the stored
    // activities are what the DE would carry, in their stored order.
    return toProfileView(row, activities);
  }

  async createEstablishment(input: SaveEstablishmentInput): Promise<EstablishmentView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await this.repository.createEstablishment(input, tx);
      await this.audit.append(
        {
          action: FISCAL_ESTABLISHMENT_SAVED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_establishment",
          targetId: created.id,
          metadata: { schemaVersion: 1, code: created.code, created: true },
        },
        tx
      );
      return created;
    });
    return toEstablishmentView(row);
  }

  async updateEstablishment(id: string, input: SaveEstablishmentInput): Promise<EstablishmentView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await this.repository.findEstablishment({ id }, tx);
      if (existing === null) {
        throw new DomainError("NOT_FOUND", FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE);
      }
      const updated = await this.repository.updateEstablishment(id, input, tx);
      await this.audit.append(
        {
          action: FISCAL_ESTABLISHMENT_SAVED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_establishment",
          targetId: updated.id,
          metadata: { schemaVersion: 1, code: updated.code, created: false },
        },
        tx
      );
      return updated;
    });
    return toEstablishmentView(row);
  }

  async createRange(input: CreateRangeInput): Promise<TimbradoRangeView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const establishment = await this.repository.findEstablishment(
        { id: input.establishmentId },
        tx
      );
      if (establishment === null) {
        // A range belongs to an establishment in the SAME tenant, so a foreign
        // id is "not found" rather than a validation error.
        throw new DomainError("NOT_FOUND", FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE);
      }
      const created = await this.repository.createRange(
        {
          establishmentId: input.establishmentId,
          expeditionPoint: input.expeditionPoint,
          documentType: input.documentType,
          series: input.series,
          timbradoNumber: input.timbradoNumber,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          validityStart: input.validityStart,
          // A new range has consumed nothing, and the series' start is set from
          // the first DE's signature date rather than from registration.
          nextNumber: input.rangeFrom,
          seriesStartedAt: null,
          status: "ACTIVE",
        },
        tx
      );
      await this.audit.append(
        {
          action: FISCAL_RANGE_CREATED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_timbrado_range",
          targetId: created.id,
          metadata: {
            schemaVersion: 1,
            timbradoNumber: created.timbradoNumber,
            expeditionPoint: created.expeditionPoint,
            documentType: created.documentType,
            series: created.series,
            rangeFrom: created.rangeFrom,
            rangeTo: created.rangeTo,
          },
        },
        tx
      );
      return created;
    });
    return toRangeView(row);
  }

  /**
   * Voids the range's **remaining tail** at the provider: the numbers from its
   * counter to its authorised end will not be used.
   *
   * The operation is the emitter's own statement, so the caller supplies **only a
   * reason** and everything else is read from the range: the interval, the
   * timbrado number, the establishment, the point of expedition, the document
   * type and the series. A caller that could name the interval could ask the
   * provider to void numbers that were already issued — and since a consumed
   * number is burnt (`next_number` is never lowered) that void would be a lie
   * about the tenant's own history.
   *
   * **Claim first, submit second, settle last.** The claim is one transaction,
   * before any provider call, that CASes the range `ACTIVE → VOIDING` on the
   * counter observed above, writes the record and moves it `PENDING →
   * IN_FLIGHT` with a lease: a range that moved, was retired, or is already
   * claimed by another void ends as a `409` with no submission at all, and the
   * interval the provider is handed is frozen. While the lease is live a second
   * arrival answers the named in-flight `409` and never calls the provider; only
   * a claim whose lease is older than `FISCAL_RANGE_VOID_CLAIM_LEASE_MS` may be
   * adopted, because by then the bounded call has given up and its fate is
   * genuinely unknown. The submission stays outside any transaction (holding one
   * across a service call is forbidden here), and the settlement is one
   * transaction that CASes `VOIDING → RETIRED` when the provider accepted or
   * `VOIDING → ACTIVE` when it refused — the counter was never touched — and
   * closes the `IN_FLIGHT` record with the audit row. A deadline or a transport
   * failure leaves the claim exactly as it is: `VOIDING` and `IN_FLIGHT`,
   * because whether the service received the submission is unknown, and
   * releasing the range would let an issuance take a number the tax
   * administration may already have voided. A fresh call adopts the claim once
   * its lease is stale and re-drives the recorded interval.
   *
   * The gates are the cancellation's: the `fiscal` entitlement, then
   * `fiscal.range.void`, then the named refusals for every state the schema does
   * not assert (§25.7) — all of them before the claim.
   *
   * A range that is not this tenant's, or that does not exist, is a `404`: the
   * read is scoped, so a foreign id can only ever answer nothing.
   */
  async voidRange(id: string, reason: string): Promise<FiscalRangeVoidView> {
    await this.assertFiscalEnabled();
    await this.requireVoidPermission();
    const actorUserProfileId = this.context.requireUserProfileId();
    const tenantId = this.context.requireTenantId();

    const range = await this.repository.findRange(id);
    if (range === null) {
      throw new DomainError("NOT_FOUND", FISCAL_RANGE_NOT_FOUND_MESSAGE);
    }
    // Every refusal by name, before anything is read from the provider or sent
    // to it: the reason's domain, the range's terminal state, whether a tail is
    // left to void, and whether the event can express this range's document type.
    const iTiDE = assertRangeVoidable(range, reason);
    const establishment = await this.repository.findEstablishment({ id: range.establishmentId });
    if (establishment === null) {
      // Unreachable through the composite FK, and answered as the read it is
      // rather than as a fault: the range's establishment is in the same tenant.
      throw new DomainError("NOT_FOUND", FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE);
    }

    // A range already VOIDING carries a claim in flight: a fresh call refuses
    // by name while the claim's lease is live, and adopts it once the lease is
    // stale, because the CAS below can never satisfy a VOIDING range. The
    // record's interval is re-driven as it stands, never a freshly computed
    // tail.
    const now = new Date();
    const adopted = range.status === "VOIDING" ? await this.findOpenRangeVoid(id) : null;
    if (adopted !== null && !isRangeVoidClaimStale(adopted, now)) {
      throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_IN_FLIGHT_MESSAGE);
    }

    const document = await this.rangeVoidDocument({
      range,
      establishmentCode: establishment.code,
      iTiDE,
      reason,
      fromNumber: adopted?.fromNumber ?? range.nextNumber,
      toNumber: adopted?.toNumber ?? range.rangeTo,
    });

    // Phase B — the CLAIM, before the provider call: one transaction that CASes
    // the counter observed above into VOIDING, writes the attempt and moves it
    // PENDING → IN_FLIGHT with its lease. A range that moved, was retired, or is
    // already claimed by a live submission ends here: `409`, and the provider is
    // never asked.
    const staleBefore = new Date(now.getTime() - FISCAL_RANGE_VOID_CLAIM_LEASE_MS);
    const claimed = await this.prisma.$transaction(async (tx) => {
      // Already claimed: only a STALE lease may be adopted, and the CAS carries
      // the attempt too, so at most one re-drive wins.
      if (adopted !== null) {
        const won = await this.repository.adoptRangeVoid(
          adopted.id,
          adopted.attempt,
          staleBefore,
          now,
          tx
        );
        return won === 1 ? { ...adopted, attempt: adopted.attempt + 1, claimedAt: now } : null;
      }
      if ((await this.repository.claimRangeVoid(id, range.nextNumber, tx)) !== 1) {
        return null;
      }
      const record = await this.repository.recordRangeVoid(
        {
          rangeId: id,
          fromNumber: range.nextNumber,
          toNumber: range.rangeTo,
          reason,
          outcome: "PENDING",
          attempt: 1,
          claimedAt: null,
          reasonCode: null,
          providerReason: null,
          providerReference: null,
          rangeStatus: "VOIDING",
        },
        tx
      );
      // The claim enters flight BEFORE the provider can be asked: the interval
      // is claimed rather than merely planned, so a second arrival sees it.
      if ((await this.repository.markRangeVoidInFlight(record.id, record.attempt, now, tx)) !== 1) {
        // Thrown INSIDE the transaction: the range flip and this row roll back
        // together, so a lost claim can never commit alone.
        throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_CHANGED_MESSAGE);
      }
      return { ...record, outcome: "IN_FLIGHT" as const, claimedAt: now };
    });
    if (claimed === null) {
      throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_CHANGED_MESSAGE);
    }

    // Phase C — the provider call, OUTSIDE any transaction, bounded by a deadline.
    const result = await runWithinDeadline<FiscalRangeVoidResult>({
      call: (signal) =>
        this.provider.voidRange({
          tenantId,
          provider: this.provider.provider,
          // The claim's interval: what the signed document carries and what the
          // record below describes, frozen before the call.
          from: claimed.fromNumber,
          to: claimed.toNumber,
          reason,
          document,
          signal,
        }),
      deadlineMs: FISCAL_RANGE_VOID_TIMEOUT_MS,
      onTimeout: () => ({
        outcome: "TRANSIENT_FAILURE",
        providerReference: null,
        reasonCode: FISCAL_RANGE_VOID_TIMEOUT_REASON_CODE,
        reason: FISCAL_RANGE_VOID_TIMEOUT_REASON,
        retryAfterMs: FISCAL_RANGE_VOID_TIMEOUT_MS,
        providerRequest: null,
        providerResponse: null,
        resolvedAt: new Date().toISOString(),
      }),
    });

    if (result.outcome === "TRANSIENT_FAILURE") {
      // The hand-over did not complete, and whether the service received it is
      // unknown: the claim stays VOIDING and IN_FLIGHT, so nothing allocates
      // the numbers and a retry can adopt it once its lease is stale.
      throw new DomainError(
        "CONFLICT",
        scrubProviderText(result.reason) ?? FISCAL_RANGE_VOID_REFUSED_MESSAGE
      );
    }

    const write = mapFiscalRangeVoidOutcome(result);
    // The settlement's target: `RETIRED` when the provider accepted, `ACTIVE`
    // when it refused — the claim's release, not a retirement.
    const rangeStatus: "RETIRED" | "ACTIVE" = write.accepted ? "RETIRED" : "ACTIVE";
    // Phase D — the SETTLEMENT: CAS the claimed range on the same counter and
    // attempt, close the IN_FLIGHT record and audit, all in one transaction.
    const settled = await this.prisma.$transaction(async (tx) => {
      const flipped = await this.repository.settleRangeVoid(
        id,
        claimed.fromNumber,
        claimed.attempt,
        rangeStatus,
        tx
      );
      const closed = await this.repository.settleRangeVoidRecord(
        {
          id: claimed.id,
          attempt: claimed.attempt,
          outcome: write.outcome,
          reasonCode: write.reasonCode,
          providerReason: write.providerReason,
          providerReference: write.providerReference,
          rangeStatus,
        },
        tx
      );
      if (flipped !== 1 || closed !== 1) {
        // Thrown INSIDE the transaction: a `null` return would COMMIT the half
        // that ran and leave the range and its record disagreeing. The throw
        // rolls both back, and the caller maps it to the same `409`.
        throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_CHANGED_MESSAGE);
      }
      await this.audit.append(
        {
          action: write.accepted ? FISCAL_RANGE_VOIDED_ACTION : FISCAL_RANGE_VOID_FAILED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: "fiscal_timbrado_range",
          targetId: id,
          // The interval and the outcome, never the free text: the reason lives in
          // the `fiscal_range_void` row this metadata points at, recorded as the
          // operator's own words rather than as protocol data.
          metadata: {
            schemaVersion: 1,
            outcome: write.outcome,
            fromNumber: claimed.fromNumber,
            toNumber: claimed.toNumber,
            rangeStatus,
            voidId: claimed.id,
          },
        },
        tx
      );
      return {
        ...claimed,
        outcome: write.outcome,
        reasonCode: write.reasonCode,
        providerReason: write.providerReason,
        providerReference: write.providerReference,
        rangeStatus,
      };
    });

    // The provider's refusal is reported first: it is the reason the operation
    // failed, and the range's status is the consequence of it, not a cause.
    if (!write.accepted) {
      throw new DomainError("CONFLICT", write.providerReason ?? FISCAL_RANGE_VOID_REFUSED_MESSAGE);
    }
    return toRangeVoidView(settled, settled.rangeStatus);
  }

  /**
   * The open claim a VOIDING range carries, or the named refusal when the range
   * and its record disagree. The interval comes from the record: it is what the
   * tenant was told and what a partial submission may already have reached.
   */
  private async findOpenRangeVoid(rangeId: string): Promise<FiscalRangeVoidWriteRow> {
    const open = await this.repository.findOpenRangeVoid(rangeId);
    if (open === null) {
      throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_NO_CLAIM_MESSAGE);
    }
    return open;
  }

  /**
   * The document the provider is handed, or `null` when it requires none.
   *
   * The cancellation's rule, applied to the void: a provider whose
   * `requiresSignedDocument` is `true` and that is handed `null` answers
   * `CONFIGURATION_ERROR` and never submits, and a tenant with no active material
   * for this environment is one of the states in which no honest document can be
   * built. The refusal stays in the one place that can phrase it for the provider
   * it is.
   */
  private async rangeVoidDocument(args: {
    readonly range: TimbradoRangeRow;
    readonly establishmentCode: string;
    readonly iTiDE: DteInutilizacionDocumentType;
    readonly reason: string;
    readonly fromNumber: number;
    readonly toNumber: number;
  }): Promise<FiscalIssueDocument | null> {
    if (!this.provider.requiresSignedDocument) return null;
    const credential = await this.credentialPort.read({
      tenantId: args.range.tenantId,
      environment: this.signingEnvironment,
    });
    if (credential === null) return null;

    try {
      return buildInutilizacionEventDocument({
        range: args.range,
        establishmentCode: args.establishmentCode,
        iTiDE: args.iTiDE,
        reason: args.reason,
        fromNumber: args.fromNumber,
        toNumber: args.toNumber,
        now: new Date(),
        credential,
      });
    } catch (error) {
      if (error instanceof DteEventValidationError) {
        throw new DomainError("VALIDATION_FAILED", error.message);
      }
      throw error;
    }
  }

  async retireRange(id: string, reason: string): Promise<TimbradoRangeView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await this.repository.findRange(id, tx);
      if (existing === null) {
        throw new DomainError("NOT_FOUND", FISCAL_RANGE_NOT_FOUND_MESSAGE);
      }
      const retired = await this.repository.retireRangeIfActive(id, tx);
      if (retired !== 1) {
        // Already exhausted or retired: the caller must not be told it worked.
        throw new DomainError("CONFLICT", "The timbrado range is not active.");
      }
      await this.audit.append(
        {
          action: FISCAL_RANGE_RETIRED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_timbrado_range",
          targetId: id,
          metadata: {
            schemaVersion: 1,
            reason,
            consumed: existing.nextNumber - existing.rangeFrom,
          },
        },
        tx
      );
      return { ...existing, status: "RETIRED" as const };
    });
    return toRangeView(row);
  }

  private async assertFiscalEnabled(): Promise<void> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "fiscal"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", FISCAL_FEATURE_NOT_ENTITLED_MESSAGE);
    }
  }

  private async requirePermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(FISCAL_PERMISSIONS.profileManage)) {
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
    }
  }

  /**
   * The void's own permission, deliberately not the profile-management one.
   *
   * A caller trusted to configure numbering is not automatically trusted to tell
   * the tax administration that those numbers will never be used: this is the one
   * range operation that leaves the tenant's database, and it cannot be undone.
   */
  private async requireVoidPermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(FISCAL_PERMISSIONS.rangeVoid)) {
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
    }
  }
}

/**
 * Whether an `IN_FLIGHT` claim's lease has expired at `now`, making it
 * adoptable. `null` counts as stale: nothing renewed the claim's lease, and
 * refusing to adopt it would wedge the range forever.
 */
export function isRangeVoidClaimStale(
  claim: Pick<FiscalRangeVoidWriteRow, "claimedAt">,
  now: Date
): boolean {
  return (
    claim.claimedAt === null ||
    now.getTime() - claim.claimedAt.getTime() >= FISCAL_RANGE_VOID_CLAIM_LEASE_MS
  );
}

/**
 * Every refusal a void can meet BEFORE a provider is asked, by name.
 *
 * The rules are ours because the schema asserts none of them (§25.7): nothing
 * pins `dNumIn <= dNumFin`, nothing keeps the range inside the timbrado, and
 * nothing matches `iTiDE` to it. Three of the four are the range's own state; the
 * first is the request's, and it is checked here rather than only in the builder
 * because the reason is stored either way — a provider that requires no document
 * never reaches the builder, and a four-character reason would then reach a CHECK.
 *
 * Returns the event's document type, narrowed once, so the payload cannot carry a
 * number the event's own enumeration does not declare.
 */
export function assertRangeVoidable(
  range: Pick<TimbradoRangeRow, "status" | "nextNumber" | "rangeTo" | "documentType">,
  reason: string
): DteInutilizacionDocumentType {
  // `tmotEve` is 5..500 (§25.3), and the reason IS the event's reason: the same
  // text travels in `mOtEve` and is stored in the record's `reason` column,
  // whose CHECK mirrors the facet.
  const length = [...reason].length;
  if (length < EVENT_REASON_MIN_LENGTH || length > EVENT_REASON_MAX_LENGTH) {
    throw new DomainError("VALIDATION_FAILED", FISCAL_RANGE_VOID_REASON_MESSAGE);
  }
  // The terminal status first: once a range is RETIRED its consumed numbers are
  // burnt and there is no operation left to perform on it.
  if (range.status === "RETIRED") {
    throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_RETIRED_MESSAGE);
  }
  // An empty tail IS the range being exhausted, whether the column already says
  // so or the counter has simply reached one past the end while the status is
  // still ACTIVE (§13: the claim that takes the last number increments it past
  // the end, and the rollover happens on the next call).
  if (range.nextNumber > range.rangeTo) {
    throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_EXHAUSTED_MESSAGE);
  }
  // `tiTiDEEv` admits 1..9 and the DE's `tiTiDE` admits 1, 4, 5, 6, 7, 9 and 10
  // (§25.2): a range whose document type is 10 is DE-legal and event-illegal, so
  // the operation is refused rather than sent as a document that would validate
  // against nothing.
  const iTiDE = INUTILIZACION_DOCUMENT_TYPE_VALUES.find(
    (candidate) => candidate === range.documentType
  );
  if (iTiDE === undefined) {
    throw new DomainError("CONFLICT", FISCAL_RANGE_VOID_DOCUMENT_TYPE_MESSAGE);
  }
  return iTiDE;
}

/**
 * Builds and signs the inutilización the SIFEN_DIRECT provider submits.
 *
 * The composition is the same hand-off WU-C pinned for the cancellation:
 * `buildEventGroupXml` renders the `gGroupGesEve` the facade's envelope will
 * carry, `signEventXml` applies the DE's XMLDSig profile to each event, and the
 * adapter receives the signed group verbatim. The event's `@Id` is `1` — a lot of
 * one — and `dFecFirma` comes from the caller's clock, local and timezone-free
 * (§25.6).
 *
 * **The numbers are the emitted form of the interval's integers**, zero-padded to
 * the seven digits `tdNumDE` wants, which is why the interval arrives as integers
 * and the padding happens here.
 *
 * **`cdc` is `null`.** An inutilización names a number range and carries no `Id`
 * (§25.3), so the port's carrier reports no document identity rather than a
 * fabricated one.
 *
 * The private key is RESTRICTED material: it enters `signEventXml` and nothing
 * here logs, returns or persists it.
 */
export function buildInutilizacionEventDocument(args: {
  readonly range: Pick<TimbradoRangeRow, "timbradoNumber" | "expeditionPoint" | "series">;
  readonly establishmentCode: string;
  readonly iTiDE: DteInutilizacionDocumentType;
  readonly reason: string;
  readonly fromNumber: number;
  readonly toNumber: number;
  readonly now: Date;
  readonly credential: FiscalTransportCredential;
}): FiscalIssueDocument {
  const signedXml = signEventXml({
    xml: buildEventGroupXml([
      {
        id: FISCAL_RANGE_VOID_EVENT_ID,
        dFecFirma: formatFiscalTimestamp(args.now),
        payload: {
          kind: "inutilizacion",
          dNumTim: args.range.timbradoNumber,
          dEst: args.establishmentCode,
          dPunExp: args.range.expeditionPoint,
          dNumIn: formatDocumentNumber(args.fromNumber),
          dNumFin: formatDocumentNumber(args.toNumber),
          iTiDE: args.iTiDE,
          reason: args.reason,
          // `dSerieNum` is optional in the event and absent for the seriesless
          // initial range, which is a real state and not a missing value (§13).
          ...(args.range.series === null ? {} : { dSerieNum: args.range.series }),
        },
      },
    ]),
    privateKeyPem: args.credential.privateKeyPem,
    certificatePem: args.credential.certificatePem,
  });
  return { cdc: null, signedXml };
}

/** The fields one recorded void carries; anything the answer left out is `null`. */
export interface FiscalRangeVoidWrite {
  readonly outcome: FiscalRangeVoidOutcome;
  readonly reasonCode: string | null;
  readonly providerReason: string | null;
  readonly providerReference: string | null;
  /** Whether the provider accepted the void. */
  readonly accepted: boolean;
}

/**
 * The provider's answer, as the row records it.
 *
 * `VOIDED` is the accepted answer and the only one that retires the range; the
 * other three are refusals this boundary can classify, and every text value is
 * written through the same scrub the cancellation's error columns use — a
 * provider's message is data, never a line of a log.
 */
export function mapFiscalRangeVoidOutcome(result: FiscalRangeVoidResult): FiscalRangeVoidWrite {
  return {
    outcome: result.outcome,
    reasonCode: scrubProviderText(result.reasonCode),
    providerReason: scrubProviderText(result.reason),
    providerReference: scrubProviderText(result.providerReference),
    accepted: result.outcome === "VOIDED",
  };
}

function toRangeVoidView(
  // Only a settled row reaches the wire: the claim's `PENDING` never does.
  row: Omit<FiscalRangeVoidWriteRow, "outcome"> & { readonly outcome: FiscalRangeVoidOutcome },
  rangeStatus: TimbradoRangeRow["status"]
): FiscalRangeVoidView {
  return {
    id: row.id,
    rangeId: row.rangeId,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    reason: row.reason,
    outcome: row.outcome,
    reasonCode: row.reasonCode,
    providerReason: row.providerReason,
    providerReference: row.providerReference,
    rangeStatus,
    createdAt: row.createdAt,
  };
}

function toProfileView(
  row: EmitterProfileRow,
  activities: readonly { code: string; description: string }[]
): EmitterProfileView {
  return {
    ruc: row.ruc,
    checkDigit: row.checkDigit,
    taxpayerType: row.taxpayerType,
    regimeCode: row.regimeCode,
    legalName: row.legalName,
    tradeName: row.tradeName,
    transactionType: row.transactionType,
    taxType: row.taxType,
    emissionType: row.emissionType,
    activities: activities.map(({ code, description }) => ({ code, description })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEstablishmentView(row: EstablishmentRow): EstablishmentView {
  return {
    id: row.id,
    code: row.code,
    addressLine: row.addressLine,
    houseNumber: row.houseNumber,
    departmentCode: row.departmentCode,
    districtCode: row.districtCode,
    cityCode: row.cityCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRangeView(row: TimbradoRangeRow): TimbradoRangeView {
  return {
    id: row.id,
    establishmentId: row.establishmentId,
    expeditionPoint: row.expeditionPoint,
    documentType: row.documentType,
    series: row.series,
    timbradoNumber: row.timbradoNumber,
    rangeFrom: row.rangeFrom,
    rangeTo: row.rangeTo,
    validityStart: row.validityStart,
    nextNumber: row.nextNumber,
    status: row.status,
  };
}
