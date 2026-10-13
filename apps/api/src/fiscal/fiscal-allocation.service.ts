import { Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  TimbradoAllocationError,
  allocateDocumentNumber,
  type AllocatedDocumentNumber,
  type TimbradoRangeKey,
} from "@newsaas/fiscal";
import {
  createFiscalProfileReader,
  createTimbradoRangeStore,
  type FiscalProfileReadClient,
  type TimbradoRangePrismaClient,
  type TimbradoRangePrismaDelegate,
} from "@newsaas/fiscal-persistence";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * FISC-015 WU-B — the fiscal number's authorisation ([[DEC-056]]).
 *
 * The decision [[DEC-056]] took is that a confirmed invoice carries ONE
 * authorised number, allocated **at confirmation**, from the tenant's timbrado
 * range, **inside the confirmation transaction**, with the range's identity
 * persisted beside the invoice. This service is that decision's implementation,
 * and the caller hands it the transaction handle so the range's
 * compare-and-swap and the invoice's `DRAFT -> CONFIRMED` transition commit
 * together: a crash between them can neither lose a number nor hand out two.
 * `allocateDocumentNumber`'s own contract says so
 * (`packages/fiscal/src/timbrado/allocation.ts`), and the caller honours it by
 * passing the transaction's client.
 *
 * ## The decision table
 *
 * - **The tenant declared its issuance point and it resolves to exactly one
 *   ACTIVE range**: the number comes from that range, and the allocation's
 *   identity — the range, the timbrado number, the establishment, the point of
 *   expedition, the document type — its fiscal series and the formatted
 *   `dNumDoc` are persisted beside the invoice. The confirmation proceeds.
 * - **The tenant declared its point and it resolves to NO ACTIVE range**: a
 *   `CONFLICT` naming that state, and the confirmation rolls back.
 * - **The tenant declared its point and it resolves to MORE THAN ONE ACTIVE
 *   range**: the same refusal, naming that state, and the same rollback.
 * - **The tenant declared NOTHING** (no profile, or all three columns NULL):
 *   nothing is allocated and nothing is persisted; this method answers `null`
 *   and the caller keeps Billing's `invoice_number_sequence` counter.
 *
 * **Why "exactly one" and not "the current one".** The allocation itself knows
 * how to pick a range when two authorisations are ACTIVE — it takes the greatest
 * `validityStart`. That is the right rule for the allocator and the WRONG rule
 * for a tenant that declared an issuance point: it would hand out a number under
 * an authorisation the tenant did not mean, and `dEst`/`dPunExp`/`iTiDE` are
 * statements about which authorisation the document is issued under. So the
 * declaration is resolved strictly: none is a refusal and several is a refusal,
 * and the message says which of the two happened ([[DEC-057]] Q4).
 *
 * **Why the counter stays, and why this is not two truths.** A tenant uses
 * exactly one of the two sources, and WHICH one is a property of its
 * declaration, not of the code path — so `BillingRepository.allocateNumber`
 * remains, unchanged, as the non-fiscal path for a tenant that has declared no
 * issuance point ([[DEC-056]]'s decision table; the alternative — deleting the
 * counter — would refuse confirmation to every tenant that has not been
 * onboarded fiscally, which is a product decision nobody made). The two never
 * compete for the same invoice: this method answers `null` when nothing is
 * declared, and only then does the caller allocate from the counter.
 *
 * **Why the error code is `CONFLICT` and the state lives in the message.** The
 * error registry (`packages/shared`) is FROZEN and append-only, and it is not
 * this unit's surface: the two refusals are a well-formed request against an
 * existing in-tenant resource whose OWN configuration forbids the command, which
 * is exactly the `409` the registry already carries. Each state therefore has
 * its own stable, exported message constant, so a caller (and a test) can tell
 * which of the two it hit.
 *
 * **Why this service and not a call into `packages/fiscal` from Billing.**
 * Billing must not import a concrete fiscal client or a fiscal table: it reaches
 * the allocation through this application-boundary service, the same one-way
 * direction the [[DEC-051]] cancellation hand-off already uses. `FiscalModule`
 * re-exports this class and its transaction-handle type precisely because
 * `fiscal-boundary.test.ts` admits only `fiscal.service.js` and
 * `fiscal.module.js` as Billing's import surface. The `TimbradoRangeStore`
 * adapter and the profile read come from `@newsaas/fiscal-persistence`, so
 * `packages/fiscal` stays Prisma-free and Billing keeps its own aggregate.
 *
 * **What is NOT here.** No route: exposing the allocation would let a caller
 * burn numbers without issuing anything (FISC-011's own rule). No audit row: the
 * confirmation's own audit row records the transition, and this service is part
 * of that transaction. No secret: the allocation reads no credential.
 */

/**
 * Stable `409 CONFLICT` message for a declared issuance point that resolves to
 * no ACTIVE timbrado range. The tenant declared a point the fiscal data cannot
 * authorise, and the confirmation is refused rather than numbered under a range
 * the tenant did not mean.
 */
export const FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE =
  "The issuance point this tenant declared has no ACTIVE timbrado range.";

/**
 * Stable `409 CONFLICT` message for a declared issuance point that resolves to
 * more than one ACTIVE timbrado range. Two authorisations may each be ACTIVE at
 * once — a new timbrado has to be registrable while the current one is in use —
 * so this is a real tenant state and not a data defect, and it is refused rather
 * than resolved by the allocator's "greatest validity start" rule.
 */
export const FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE =
  "The issuance point this tenant declared matches more than one ACTIVE timbrado range.";

/**
 * Stable `409 CONFLICT` message for an authorisation whose last series (`ZZ`) is
 * spent. The allocator refuses to wrap, because wrapping would hand out numbers
 * the emitter is not authorised for; the tenant needs a new timbrado.
 */
export const FISCAL_ALLOCATION_SERIES_EXHAUSTED_MESSAGE =
  "The timbrado range for the declared issuance point has exhausted its last series; a new authorisation is required.";

/**
 * Stable `409 CONFLICT` message for any other refusal from the allocator — a
 * range that vanished between the count and the claim, a contended counter, or a
 * range whose own numbers cannot describe a sequence. The message is stable and
 * carries no ids: the allocator's own message names internal rows and belongs in
 * diagnostics, not in an API envelope.
 */
export const FISCAL_ALLOCATION_REFUSED_MESSAGE =
  "The timbrado range for the declared issuance point could not allocate a number.";

/**
 * The transaction handle this service needs, in the shapes the persistence
 * adapters are declared against: the profile read ([[FISC-015]] WU-C), the
 * timbrado range store ([[FISC-011]]), the `count` that resolves the
 * declaration, and the allocation's own insert.
 *
 * `count` is not part of `TimbradoRangeStore` — the port has no use for it —
 * and it is declared here in Prisma's own argument types for the same reason
 * `@newsaas/fiscal-persistence` does: the real transaction client fits by
 * construction, and a fake can record the statement.
 */
export interface FiscalAllocationTx extends FiscalProfileReadClient, TimbradoRangePrismaClient {
  fiscalTimbradoRange: TimbradoRangePrismaDelegate & {
    count(args: Prisma.FiscalTimbradoRangeCountArgs): Promise<number>;
  };
  invoiceFiscalAllocation: {
    create(args: Prisma.InvoiceFiscalAllocationCreateArgs): Promise<unknown>;
  };
}

/** The three profile columns that identify the authorisation, all declared. */
interface DeclaredIssuancePoint {
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
}

@Injectable()
export class FiscalAllocationService {
  constructor(private readonly context: RequestContextService) {}

  /**
   * Allocates the invoice's fiscal number under the tenant's declared issuance
   * point and persists the allocation's identity. It writes NOTHING to the
   * invoice itself: the fiscal number lives in this row, and the invoice's own
   * `(series, number)` stays Billing's (see the return site for why).
   *
   * MUST be called inside the confirmation's transaction, with that
   * transaction's client: the range's compare-and-swap and the invoice's
   * transition have to commit together ([[DEC-056]]).
   */
  async allocateForConfirmation(args: {
    readonly invoiceId: string;
    readonly tx: FiscalAllocationTx;
  }): Promise<void> {
    const tenantId = this.context.requireTenantId();
    const declared = await this.readDeclaredIssuancePoint(tenantId, args.tx);
    if (declared === null) {
      // Nothing declared: no fiscal identity to persist, and the confirmation
      // numbers the invoice with Billing's own `invoice_number_sequence`.
      return;
    }

    const key: TimbradoRangeKey = {
      tenantId,
      establishmentId: declared.establishmentId,
      expeditionPoint: declared.expeditionPoint,
      documentType: declared.documentType,
    };

    await this.assertExactlyOneActiveRange(key, args.tx);
    const allocated = await this.allocate(key, args.tx);

    // The allocation's IDENTITY, written where the allocation happened — the
    // worker reads this row instead of reconstructing a range key a confirmed
    // invoice cannot recover (DEC-056). The invoice's own `number` stays the
    // integer below; `document_number` is the DE's seven-digit `dNumDoc`.
    await args.tx.invoiceFiscalAllocation.create({
      data: {
        tenantId,
        invoiceId: args.invoiceId,
        rangeId: allocated.rangeId,
        timbradoNumber: allocated.timbradoNumber,
        establishmentId: allocated.establishmentId,
        expeditionPoint: allocated.expeditionPoint,
        documentType: allocated.documentType,
        series: allocated.series,
        documentNumber: allocated.documentNumber,
      },
    });

    // NOTHING is written to the invoice's own `(series, number)`: Billing's
    // header guard makes the series immutable across a permitted transition
    // (`a permitted transition cannot change the invoice series`), and its
    // uniqueness is `(tenant_id, series, number)`. The two identities stay
    // separate — the invoice's internal number comes from the counter and the
    // FISCAL number is this row's `document_number` — which is what makes a
    // successor range's restarted numbering impossible to collide (finding
    // R3-001). The fiscal number is what the DE and the KuDE carry.
    void allocated;
  }

  /**
   * The tenant's declared issuance point, read through WU-C's reader — the one
   * read of those three columns, shared with the worker.
   *
   * `null` means "the tenant has declared nothing", which is a single state
   * because the migration makes the three columns all-or-nothing: no profile,
   * or a profile whose three columns are NULL. A half-declared row is not
   * representable, so it needs no branch here.
   */
  private async readDeclaredIssuancePoint(
    tenantId: string,
    tx: FiscalAllocationTx
  ): Promise<DeclaredIssuancePoint | null> {
    const read = await createFiscalProfileReader(tx).readProfile(tenantId);
    if (read === null) {
      return null;
    }
    const { defaultEstablishmentId, defaultExpeditionPoint, defaultDocumentType } = read;
    if (
      defaultEstablishmentId === null ||
      defaultExpeditionPoint === null ||
      defaultDocumentType === null
    ) {
      return null;
    }
    return {
      establishmentId: defaultEstablishmentId,
      expeditionPoint: defaultExpeditionPoint,
      documentType: defaultDocumentType,
    };
  }

  /**
   * The declaration must resolve to EXACTLY ONE ACTIVE range — see the class
   * doc for why "the current one" is not good enough for a declared point.
   *
   * The count is tenant-scoped and rides inside the caller's transaction, so it
   * reads the same snapshot the allocation then draws from. It is a validation
   * and not a lock: two concurrent confirmations of the same tenant both see the
   * one range and both allocate, which is correct — they take different numbers
   * from the same authorisation through its compare-and-swap.
   */
  private async assertExactlyOneActiveRange(
    key: TimbradoRangeKey,
    tx: FiscalAllocationTx
  ): Promise<void> {
    const active = await tx.fiscalTimbradoRange.count({
      where: {
        tenantId: key.tenantId,
        establishmentId: key.establishmentId,
        expeditionPoint: key.expeditionPoint,
        documentType: key.documentType,
        status: "ACTIVE",
      },
    });
    if (active === 0) {
      throw new DomainError("CONFLICT", FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE);
    }
    if (active > 1) {
      throw new DomainError("CONFLICT", FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE);
    }
  }

  /**
   * The allocation itself, over the Prisma store the caller's transaction
   * provides. The allocator's failures are translated into this boundary's
   * stable `409`s: `SERIES_EXHAUSTED` is a tenant state an operator can act on,
   * and the rest are refusals whose internal detail stays in the message the
   * allocator raised.
   */
  private async allocate(
    key: TimbradoRangeKey,
    tx: FiscalAllocationTx
  ): Promise<AllocatedDocumentNumber> {
    try {
      return await allocateDocumentNumber({ store: createTimbradoRangeStore(tx), key });
    } catch (error) {
      if (error instanceof TimbradoAllocationError) {
        throw new DomainError(
          "CONFLICT",
          error.failure === "SERIES_EXHAUSTED"
            ? FISCAL_ALLOCATION_SERIES_EXHAUSTED_MESSAGE
            : FISCAL_ALLOCATION_REFUSED_MESSAGE
        );
      }
      throw error;
    }
  }
}
