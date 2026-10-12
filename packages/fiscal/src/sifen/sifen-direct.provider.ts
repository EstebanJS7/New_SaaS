/**
 * FISC-012 WU-E — the real SIFEN provider behind the Fiscal port (ADR-009).
 *
 * The adapter over `sifen.facade.ts`: `issue` hands **a lot of one** to the
 * asynchronous reception service, `query` asks by the identity the caller has,
 * and `cancel` submits the caller's signed event group through the event
 * reception service. Everything protocol-shaped stays in the facade and in the
 * outcome mapping — this module owns the port's answer, the failure partition
 * and the snapshot descriptors, and nothing else. It reads no ambient clock
 * (the `now` dependency is the result's `resolvedAt`), logs nothing, and holds
 * no credential, envelope or socket of its own.
 *
 * Five decisions live here:
 *
 * 1. **`issue` is a lot of one.** §9.2.1 admits 1–50 `rDE` per lot and the
 *    Manual frames sending as "en lotes"; the batch is the path whose answer is
 *    **asynchronous**, which is what `SUBMITTED`, the `providerReference` and
 *    the reconciliation exist for (ADR-007 §1–§2). The synchronous reception
 *    stays available in the facade and is deliberately unused here: a
 *    single-document fast path is a later decision, not an implication of this
 *    adapter.
 * 2. **`query` is chosen by the identity the caller has.** The reference is the
 *    fast path and the CDC is the path that survives a lost hand-over answer
 *    (ADR-007 §2): a request carrying a `providerReference` asks the batch
 *    service, and only one without it — the Guide's "solo en caso de no recibir
 *    el Número de Lote" — asks the per-CDC consultation.
 * 3. **The failure partition is this adapter's.** The facade lets
 *    `SifenTransportError`, `SifenParseError` and `SifenFacadeError` travel out
 *    unmapped **by design**, so the terminal/retryable split is decided here and
 *    nowhere else; {@link mapSifenFailure} is the table, and it is asserted
 *    member by member.
 * 4. **The snapshots are descriptors, not documents.** The port says the raw
 *    request and response are sanitized by the Fiscal boundary; the adapter
 *    makes that cheap by never putting the signed XML in them — the request
 *    descriptor carries the CDC, the service and the byte count, and the answer
 *    descriptor carries the answer's own code and message (ADR-009's
 *    Consequences).
 * 5. **`cancel` submits the caller's signed event group.** §25 profiles the
 *    family: SIFEN's cancellation is an `rGeVeCan` event inside the signed
 *    `gGroupGesEve` the caller hands over — ADR-009 applied to cancel, which is
 *    why this adapter refuses a `null` document exactly as `issue` does — and
 *    the answer's `dEstRes` maps onto `CANCELLED`/`REJECTED` while its result
 *    codes travel as strings. §25.5 records that no retrieved source enumerates
 *    the event result codes, so an unlisted code is carried, never coerced.
 *
 * **Nothing here retries.** A `TRANSIENT_FAILURE` is a statement the caller acts
 * on — the worker rethrows and BullMQ applies its backoff — and a
 * `CONFIGURATION_ERROR` is a statement an operator acts on. The adapter does not
 * sleep, re-send or loop.
 */

import { randomInt } from "node:crypto";

import type {
  FiscalCancelOutcome,
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalIssueRequest,
  FiscalIssueResult,
  FiscalProviderPort,
  FiscalQueryRequest,
  FiscalQueryResult,
} from "../fiscal-provider.port.js";
import {
  SifenFacadeError,
  type SifenFacadeFailure,
  type SifenServiceFacade,
} from "./sifen.facade.js";
import type { SifenEstadoResultado } from "./sifen.codes.js";
import type { SifenEventReceptionResponse, SifenEventResult } from "./sifen.messages.js";
import {
  mapBatchQueryOutcome,
  mapBatchReceptionOutcome,
  mapCdcQueryOutcome,
  type SifenOutcomeContext,
} from "./sifen.outcomes.js";
import { SifenParseError } from "./sifen.parser.js";
import { SifenSerializationError } from "./sifen.serializer.js";
import { SifenTransportError, type SifenTransportFailure } from "./sifen.transport.js";

/** The identifier the port's own vocabulary declares, in one place. */
const SIFEN_DIRECT_PROVIDER = "SIFEN_DIRECT" as const;

/**
 * The facade call a snapshot describes.
 *
 * The adapter's own name for the operation, not a protocol path: the facade owns
 * the §8 paths, and this union only tells a reader of the snapshot which of the
 * calls produced it.
 */
export type SifenDirectService = "receiveBatch" | "queryBatch" | "queryDe" | "receiveEvent";

/**
 * What the adapter asked SIFEN, as a descriptor.
 *
 * ADR-009's request now carries the document's bytes, so the snapshot must not
 * be a record of those bytes. This is the record of the **operation**: which
 * service, which document (its CDC) and how many bytes were handed over.
 * `xmlBytes` is `null` for a query, which sends no document.
 */
export interface SifenDirectRequestSnapshot {
  readonly provider: typeof SIFEN_DIRECT_PROVIDER;
  readonly service: SifenDirectService;
  readonly cdc: string | null;
  readonly xmlBytes: number | null;
}

/**
 * What SIFEN answered, as a descriptor.
 *
 * The answer's own code and message, never its body: the per-CDC consultation's
 * body carries the whole DE in `xContenDE`, and a snapshot that stored the body
 * would store the document a second time (ADR-009's Consequences).
 */
export interface SifenDirectResponseSnapshot {
  readonly provider: typeof SIFEN_DIRECT_PROVIDER;
  readonly service: SifenDirectService;
  /**
   * The answer's own status: `dCodRes` for the three DE services, where it is
   * always present, and the first `gResProcEVe`'s `dEstRes` for the event
   * family. `null` only for an event answer with no entry at all — unreachable
   * through `parseEventReceptionResponse`, but not a status to invent.
   */
  readonly statusCode: string | null;
  readonly message: string | null;
}

/**
 * `reasonCode` when a requiring provider is handed `document: null` (ADR-009 §3).
 *
 * **Ours, not SIFEN's**: the violation is in the caller's request, no service
 * was asked about it, and the code exists so the row an operator reads names the
 * skipped stage instead of a generic failure.
 */
export const SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE = "SIGNED_DOCUMENT_REQUIRED" as const;

/** `reason` for the same violation, in one fixed sentence. */
export const SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON =
  "The SIFEN_DIRECT provider submits a signed document and the request carries none; the " +
  "caller skipped the document stage ADR-009 requires.";

/** `reasonCode` when a query arrives with neither a reference nor a CDC. */
export const SIFEN_DIRECT_QUERY_IDENTITY_MISSING_REASON_CODE = "QUERY_IDENTITY_MISSING" as const;

/** `reason` for the same violation: the query has no identity to ask with. */
export const SIFEN_DIRECT_QUERY_IDENTITY_MISSING_REASON =
  "The query carries neither a provider reference nor a CDC, so there is no identity to ask " +
  "SIFEN with (ADR-007 §2).";

/**
 * The separator between two `dMsgRes` values in a cancel `reason`, matching
 * `sifen.outcomes.ts`'s; the schema says nothing about how messages compose.
 */
const REASON_SEPARATOR = "; ";

/** `reasonCode` for an error the adapter cannot name. */
export const SIFEN_DIRECT_UNMAPPED_FAILURE_REASON_CODE = "UNMAPPED_PROVIDER_FAILURE" as const;

/** `reason` for an error the adapter cannot name: fail closed, do not retry blind. */
export const SIFEN_DIRECT_UNMAPPED_FAILURE_REASON =
  "The SIFEN call failed with an error this adapter does not recognise; it is reported as a " +
  "configuration error instead of being retried.";

/**
 * `reason` when the parser refused SIFEN's bytes.
 *
 * A fixed sentence rather than the error's own message: `MALFORMED_XML` embeds
 * the library's message, which can quote the response, and the row's
 * `last_error_message` must never carry response bytes.
 */
const SIFEN_DIRECT_PARSE_FAILURE_REASON =
  "SIFEN answered with bytes this client could not read as a service answer, so the request's " +
  "outcome at SIFEN is unknown; the reason code names what the parser refused.";

/**
 * `reason` when the serializer refused the request.
 *
 * Fixed for the same reason as the parse sentence: `UNEXPECTED_DOCUMENT_ROOT`'s
 * message prints the document's first 48 characters, so the error's own message
 * cannot reach a persisted row.
 */
const SIFEN_DIRECT_SERIALIZATION_FAILURE_REASON =
  "The SIFEN envelope could not be built from the request, so no call was made; the reason " +
  "code names what the serializer refused.";

/** The two failure outcomes this adapter can produce. */
export type SifenFailureOutcome = "CONFIGURATION_ERROR" | "TRANSIENT_FAILURE";

/** One mapped failure: the outcome, the code an operator sees, and the reason. */
export interface SifenFailureMapping {
  readonly outcome: SifenFailureOutcome;
  readonly reasonCode: string;
  readonly reason: string;
}

/**
 * The transport failures, partitioned.
 *
 * **`TRANSIENT_FAILURE` is not "try the same bytes again"; it is "the hand-over
 * did not complete and the caller may ask again".** The three members below are
 * the ones where the request may never have reached SIFEN or may have reached it
 * without an answer, so a retry can complete what a dropped connection
 * interrupted. **The duplicate protection is the CDC**: the worker resends the
 * stored signed bytes — the same CDC, the same signature (WU-D2) — and SIFEN's
 * own duplicate rules answer for a repeated CDC (ADR-007's Context quotes the
 * Guide: "Enviar el mismo CDC varias veces en lotes distintos y que aún se
 * encuentren en procesamiento" is a blocking offence), so a retry cannot create a
 * second document. The other six members are conditions a retry cannot change:
 * an endpoint or a trust store a deployment configured, a certificate that needs
 * rotation, a redirect that says the call was not authenticated (§23.5), or an
 * answer outside the contract. Each one is terminal and reaches an operator with
 * the member's own name as the reason code.
 */
const SIFEN_TRANSPORT_OUTCOMES: Record<SifenTransportFailure, SifenFailureOutcome> = {
  // A deployment misconfiguration: the URL is the environment's host joined to
  // the facade's §8 path, so a retry derives the same broken URL.
  INVALID_ENDPOINT: "CONFIGURATION_ERROR",
  // ADR-008 §3: an expired certificate is refused locally, and rotation is an
  // operator's act, not a retry's.
  CREDENTIAL_EXPIRED: "CONFIGURATION_ERROR",
  // The same operator act as an expiry: a clock or a deployment, not a retry.
  CREDENTIAL_NOT_YET_VALID: "CONFIGURATION_ERROR",
  // `classifySocketFailure` only answers TLS_FAILURE for certificate/trust
  // codes, so the material or the trust store is wrong; a retry presents the
  // same rejected certificate.
  TLS_FAILURE: "CONFIGURATION_ERROR",
  // The connection could not be completed, so the hand-over may never have
  // happened: a retry can complete it. The CDC is stable across attempts and
  // SIFEN's duplicate rules answer for a repeated one (ADR-007's Context).
  NETWORK_FAILURE: "TRANSIENT_FAILURE",
  // SIFEN did not answer inside the inactivity window; whether it received the
  // document is unknown. A retry resends the same CDC, protected the same way.
  TIMEOUT: "TRANSIENT_FAILURE",
  // The caller's signal fired (a deadline or a shutdown); whether SIFEN received
  // the document is unknown. A retry resends the same CDC, protected the same way.
  ABORTED: "TRANSIENT_FAILURE",
  // §23.5: both hosts answer 302 → /vdesk/hangup.php3 for everything
  // unauthenticated, so a redirect says the call was not authenticated or the
  // path is wrong. Following or retrying it would loop.
  REDIRECT_NOT_ALLOWED: "CONFIGURATION_ERROR",
  // The cap is a client constant (ADR-008's 8 MiB response bound), and an
  // answer above it is outside the contract; an operator should see it rather
  // than loop a document against it.
  RESPONSE_TOO_LARGE: "CONFIGURATION_ERROR",
};

/**
 * The facade's own failure, partitioned.
 *
 * `CREDENTIAL_UNAVAILABLE` is the story's criterion: a tenant with no active
 * material for this environment cannot authenticate, and ADR-008 §3 makes that
 * a configuration error — the other environment's certificate is never
 * substituted.
 */
const SIFEN_FACADE_OUTCOMES: Record<SifenFacadeFailure, SifenFailureOutcome> = {
  CREDENTIAL_UNAVAILABLE: "CONFIGURATION_ERROR",
};

/**
 * Maps anything the facade can throw onto the port's failure vocabulary.
 *
 * Total and non-throwing by construction: a `SifenTransportError` and a
 * `SifenFacadeError` are read by their own discriminant, a `SifenParseError` and
 * a `SifenSerializationError` by theirs, and **anything else is a configuration
 * error** — the fail-closed default, because an error this adapter cannot name is
 * not evidence that a retry is safe. The parse and serialization reasons are
 * fixed sentences rather than the errors' own messages, which can quote response
 * or document bytes.
 *
 * A parse refusal is terminal on purpose: the bytes arrived but were not an
 * answer this client can read, which is a contract condition rather than a
 * "try again" from the service, and the row it produces carries the parser's own
 * failure code (`MISSING_ELEMENT`, `MALFORMED_XML`, …) so an operator can see
 * what the client refused. A resubmission is still possible through the bounded
 * `ERROR` re-drive, so a genuinely transient garbage answer is not stranded.
 */
export function mapSifenFailure(error: unknown): SifenFailureMapping {
  if (error instanceof SifenTransportError) {
    return {
      outcome: SIFEN_TRANSPORT_OUTCOMES[error.failure],
      reasonCode: error.failure,
      // The transport's own message: one fixed sentence per member, and
      // payload-free by its construction — the only variable part is a socket
      // code validated against a conservative pattern.
      reason: error.message,
    };
  }
  if (error instanceof SifenFacadeError) {
    return {
      outcome: SIFEN_FACADE_OUTCOMES[error.failure],
      reasonCode: error.failure,
      reason: error.message,
    };
  }
  if (error instanceof SifenParseError) {
    return {
      outcome: "CONFIGURATION_ERROR",
      reasonCode: error.failure,
      reason: SIFEN_DIRECT_PARSE_FAILURE_REASON,
    };
  }
  if (error instanceof SifenSerializationError) {
    return {
      outcome: "CONFIGURATION_ERROR",
      reasonCode: error.failure,
      reason: SIFEN_DIRECT_SERIALIZATION_FAILURE_REASON,
    };
  }
  return {
    outcome: "CONFIGURATION_ERROR",
    reasonCode: SIFEN_DIRECT_UNMAPPED_FAILURE_REASON_CODE,
    reason: SIFEN_DIRECT_UNMAPPED_FAILURE_REASON,
  };
}

/**
 * The event reception's answer, mapped onto the port's cancel vocabulary.
 *
 * Pure and total, in `sifen.outcomes.ts`'s style: every field of the result is
 * set, with `null` for what the answer did not provide. §10's three `dEstRes`
 * values map exactly as `issue`'s do — `Aprobado` and `Aprobado con observación`
 * are an accepted cancellation, `Rechazado` a rejected one — and the answer's
 * `dCodRes` values are **carried as strings, never coerced**: §25.5 records that
 * no retrieved source enumerates the event family's result codes, so an unlisted
 * four-digit code reaches the caller as itself, exactly as §23.8 item 7's open
 * catalogue does for the DE's own codes.
 *
 * The **first** `gResProcEVe` entry is the one that answers: the adapter submits
 * a lot of one event, and `gResProcEVe` is `1..15` (§25.5). An answer carrying
 * no entry at all — which `parseEventReceptionResponse` refuses before this
 * point — resolved nothing, so it is a `CONFIGURATION_ERROR` rather than an
 * outcome this module would have to invent.
 */
export function mapEventReceptionCancelOutcome(
  args: SifenOutcomeContext & { readonly response: SifenEventReceptionResponse }
): FiscalCancelResult {
  const event = args.response.gResProcEVe[0];
  if (event === undefined) {
    return cancelResult(args, { outcome: "CONFIGURATION_ERROR", reasonCode: null, reason: null });
  }

  return cancelResult(args, {
    outcome: cancelOutcomeForEventStatus(event.dEstRes),
    reasonCode: firstEventResultCode(event),
    reason: eventMessages(event).join(REASON_SEPARATOR) || null,
  });
}

/**
 * `dEstRes` -> the cancel vocabulary: an exhaustive `switch` over the validated
 * union, so a fourth published status stops this file from compiling instead of
 * falling through a default.
 */
function cancelOutcomeForEventStatus(dEstRes: SifenEstadoResultado): FiscalCancelOutcome {
  switch (dEstRes) {
    case "Aprobado":
    case "Aprobado con observación":
      return "CANCELLED";
    case "Rechazado":
      return "REJECTED";
  }
}

/**
 * The first result code the event's answer reports, as a string.
 *
 * §25.3 and §25.5 mark `dCodRes` optional inside a `gResProc` entry, so an entry
 * may carry only a message; skipping one that carries no code keeps a code-less
 * observation from erasing the code behind it — the rule `sifen.outcomes.ts`
 * applies to the DE's protocols too.
 */
function firstEventResultCode(event: SifenEventResult): string | null {
  for (const group of event.gResProc) {
    if (group.dCodRes !== undefined) {
      return group.dCodRes;
    }
  }
  return null;
}

/** The event's `dMsgRes` values, in the order reported, with empty ones skipped. */
function eventMessages(event: SifenEventResult): readonly string[] {
  return event.gResProc
    .map((group) => group.dMsgRes)
    .filter((message): message is string => message !== undefined && message !== "");
}

/** The fields a cancel result may set; anything unset is `null`, never omitted. */
interface CancelResultFields {
  readonly outcome: FiscalCancelOutcome;
  readonly reasonCode?: string | null;
  readonly reason?: string | null;
}

/** One cancel result, constructed field by field, for the reason above. */
function cancelResult(
  context: SifenOutcomeContext,
  fields: CancelResultFields
): FiscalCancelResult {
  return {
    outcome: fields.outcome,
    reasonCode: fields.reasonCode ?? null,
    reason: fields.reason ?? null,
    retryAfterMs: null,
    providerRequest: context.providerRequest,
    providerResponse: context.providerResponse,
    resolvedAt: context.resolvedAt,
  };
}

/** The 15 digits `dId` carries (§23.3, §23.4). */
const SIFEN_DIRECT_CONTROL_NUMBER_DIGITS = 15;

/**
 * A 15-digit control number (`dId`) that `SIFEN_ID_PATTERN` accepts.
 *
 * §9.2.1 calls the field a "Número secuencial autoincremental … responsabilidad
 * del contribuyente"; a process with no persisted counter cannot be sequential
 * across restarts, and the one property the pattern enforces — 1 to 15 digits,
 * never all zero — is kept by drawing a non-zero leading digit. The randomness
 * comes from `node:crypto` and never from a clock.
 */
export function generateSifenControlNumber(): string {
  let digits = String(randomInt(1, 10));
  while (digits.length < SIFEN_DIRECT_CONTROL_NUMBER_DIGITS) {
    digits += String(randomInt(0, 10));
  }
  return digits;
}

export interface SifenDirectProviderDependencies {
  /** The facade, already bound to an environment and a credential port. */
  readonly facade: SifenServiceFacade;
  /**
   * The envelope's 15-digit control number; injected so a test is deterministic.
   *
   * Defaults to {@link generateSifenControlNumber}. The control number belongs to
   * the envelope and not to the document: it identifies the operation's message,
   * which is why one is drawn per call and why it never derives from a clock.
   */
  readonly controlNumber?: () => string;
  /** The clock the result's `resolvedAt` comes from. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/** One issue result's failure fields, so every failure branch sets every field. */
interface IssueFailureFields {
  readonly outcome: SifenFailureOutcome;
  readonly reasonCode: string;
  readonly reason: string;
  readonly cdc: string | null;
  readonly providerRequest: SifenDirectRequestSnapshot | null;
  readonly resolvedAt: string;
}

/** One query result's failure fields, for the same reason. */
interface QueryFailureFields {
  readonly outcome: SifenFailureOutcome;
  readonly reasonCode: string;
  readonly reason: string;
  readonly providerRequest: SifenDirectRequestSnapshot | null;
  readonly resolvedAt: string;
}

/** One cancel result's failure fields, for the same reason. */
interface CancelFailureFields {
  readonly outcome: SifenFailureOutcome;
  readonly reasonCode: string;
  readonly reason: string;
  readonly providerRequest: SifenDirectRequestSnapshot | null;
  readonly resolvedAt: string;
}

/**
 * Creates the provider over one facade.
 *
 * Construction reads no credential, opens no socket and reads no clock: the
 * facade reads the credential inside each call (ADR-008 §2), and the clock is
 * read when a result is built.
 */
export function createSifenDirectFiscalProvider(
  dependencies: SifenDirectProviderDependencies
): FiscalProviderPort {
  const clock = dependencies.now ?? ((): Date => new Date());
  const controlNumber = dependencies.controlNumber ?? generateSifenControlNumber;

  function requestSnapshot(args: {
    readonly service: SifenDirectService;
    readonly cdc: string | null;
    readonly xmlBytes: number | null;
  }): SifenDirectRequestSnapshot {
    return {
      provider: SIFEN_DIRECT_PROVIDER,
      service: args.service,
      cdc: args.cdc,
      xmlBytes: args.xmlBytes,
    };
  }

  function responseSnapshot(args: {
    readonly service: SifenDirectService;
    readonly statusCode: string | null;
    readonly message: string | null;
  }): SifenDirectResponseSnapshot {
    return {
      provider: SIFEN_DIRECT_PROVIDER,
      service: args.service,
      statusCode: args.statusCode,
      message: args.message,
    };
  }

  function issueFailure(args: IssueFailureFields): FiscalIssueResult {
    return {
      outcome: args.outcome,
      externalId: null,
      providerReference: null,
      cdc: args.cdc,
      reasonCode: args.reasonCode,
      reason: args.reason,
      // No service answered with a retry hint, and the caller's queue owns its
      // backoff (ADR-007 §5 bounds the reconciliation, not the transport).
      retryAfterMs: null,
      providerRequest: args.providerRequest,
      providerResponse: null,
      resolvedAt: args.resolvedAt,
    };
  }

  function queryFailure(args: QueryFailureFields): FiscalQueryResult {
    return {
      outcome: args.outcome,
      cdc: null,
      externalId: null,
      reasonCode: args.reasonCode,
      reason: args.reason,
      retryAfterMs: null,
      providerRequest: args.providerRequest,
      providerResponse: null,
      resolvedAt: args.resolvedAt,
    };
  }

  function cancelFailure(args: CancelFailureFields): FiscalCancelResult {
    return {
      outcome: args.outcome,
      reasonCode: args.reasonCode,
      reason: args.reason,
      retryAfterMs: null,
      providerRequest: args.providerRequest,
      providerResponse: null,
      resolvedAt: args.resolvedAt,
    };
  }

  async function issue(request: FiscalIssueRequest): Promise<FiscalIssueResult> {
    const resolvedAt = clock().toISOString();
    const document = request.document;

    if (document === null) {
      // ADR-009 §3: never a throw, never a submission. No facade call, so no
      // control number is drawn and no snapshot describes a call that did not
      // happen.
      return issueFailure({
        outcome: "CONFIGURATION_ERROR",
        reasonCode: SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE,
        reason: SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON,
        cdc: null,
        providerRequest: null,
        resolvedAt,
      });
    }

    const providerRequest = requestSnapshot({
      service: "receiveBatch",
      cdc: document.cdc,
      xmlBytes: Buffer.byteLength(document.signedXml, "utf8"),
    });

    try {
      const response = await dependencies.facade.receiveBatch({
        tenantId: request.tenantId,
        dId: controlNumber(),
        deXmls: [document.signedXml],
      });
      const mapped = mapBatchReceptionOutcome({
        providerRequest,
        providerResponse: responseSnapshot({
          service: "receiveBatch",
          statusCode: response.dCodRes,
          message: response.dMsgRes ?? null,
        }),
        resolvedAt,
        response,
      });
      // The batch answer identifies an operation and never a document, so the
      // mapper sets `cdc: null` on every row. The adapter is the side that knows
      // which document it handed over, and ADR-007 §2 makes the CDC the identity
      // the reconciliation must have when the hand-over answer is lost — so the
      // result carries the document's own identity beside the operation's handle.
      return { ...mapped, cdc: document.cdc };
    } catch (error) {
      return issueFailure({
        ...mapSifenFailure(error),
        cdc: document.cdc,
        providerRequest,
        resolvedAt,
      });
    }
  }

  async function query(request: FiscalQueryRequest): Promise<FiscalQueryResult> {
    const resolvedAt = clock().toISOString();

    // The `signal` on the request is not forwarded: the facade binds one at
    // construction and offers no per-call override. The caller's own deadline
    // still bounds this call (the port documents the race), and changing the
    // facade's signature is not this slice's.
    if (request.providerReference !== null) {
      const providerRequest = requestSnapshot({
        service: "queryBatch",
        cdc: request.cdc,
        xmlBytes: null,
      });
      try {
        const response = await dependencies.facade.queryBatch({
          tenantId: request.tenantId,
          dId: controlNumber(),
          dProtConsLote: request.providerReference,
        });
        return mapBatchQueryOutcome({
          providerRequest,
          providerResponse: responseSnapshot({
            service: "queryBatch",
            statusCode: response.dCodResLot,
            message: response.dMsgResLot,
          }),
          resolvedAt,
          response,
        });
      } catch (error) {
        return queryFailure({ ...mapSifenFailure(error), providerRequest, resolvedAt });
      }
    }

    if (request.cdc !== null) {
      const providerRequest = requestSnapshot({
        service: "queryDe",
        cdc: request.cdc,
        xmlBytes: null,
      });
      try {
        const response = await dependencies.facade.queryDe({
          tenantId: request.tenantId,
          dId: controlNumber(),
          dCDC: request.cdc,
        });
        return mapCdcQueryOutcome({
          providerRequest,
          providerResponse: responseSnapshot({
            service: "queryDe",
            statusCode: response.dCodRes,
            message: response.dMsgRes,
          }),
          resolvedAt,
          response,
        });
      } catch (error) {
        return queryFailure({ ...mapSifenFailure(error), providerRequest, resolvedAt });
      }
    }

    return queryFailure({
      outcome: "CONFIGURATION_ERROR",
      reasonCode: SIFEN_DIRECT_QUERY_IDENTITY_MISSING_REASON_CODE,
      reason: SIFEN_DIRECT_QUERY_IDENTITY_MISSING_REASON,
      providerRequest: null,
      resolvedAt,
    });
  }

  async function cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult> {
    const resolvedAt = clock().toISOString();
    const document = request.document;

    if (document === null) {
      // ADR-009 §3 applied to cancel: never a throw, never a submission. No
      // facade call, so no control number is drawn and no snapshot describes a
      // call that did not happen.
      return cancelFailure({
        outcome: "CONFIGURATION_ERROR",
        reasonCode: SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE,
        reason: SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON,
        providerRequest: null,
        resolvedAt,
      });
    }

    const providerRequest = requestSnapshot({
      service: "receiveEvent",
      cdc: document.cdc,
      xmlBytes: Buffer.byteLength(document.signedXml, "utf8"),
    });

    try {
      const response = await dependencies.facade.receiveEvent({
        tenantId: request.tenantId,
        dId: controlNumber(),
        eventGroupXml: document.signedXml,
      });
      return mapEventReceptionCancelOutcome({
        providerRequest,
        providerResponse: eventResponseSnapshot(response),
        resolvedAt,
        response,
      });
    } catch (error) {
      return cancelFailure({ ...mapSifenFailure(error), providerRequest, resolvedAt });
    }
  }

  /**
   * The event answer's descriptor: its first `dEstRes`, and its `dMsgRes`
   * values joined the way `reason` joins them.
   *
   * The parser refuses an answer outside `gResProcEVe` 1..15, so a parsed
   * answer always carries an entry; the `null`s keep the descriptor total
   * without inventing a status the service never stated.
   */
  function eventResponseSnapshot(
    response: SifenEventReceptionResponse
  ): SifenDirectResponseSnapshot {
    const event = response.gResProcEVe[0];
    return responseSnapshot({
      service: "receiveEvent",
      statusCode: event === undefined ? null : event.dEstRes,
      message: event === undefined ? null : eventMessages(event).join(REASON_SEPARATOR) || null,
    });
  }

  return {
    provider: SIFEN_DIRECT_PROVIDER,
    requiresSignedDocument: true,
    issue,
    query,
    cancel,
  };
}
