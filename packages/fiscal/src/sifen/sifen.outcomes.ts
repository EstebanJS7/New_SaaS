/**
 * FISC-010 WU-E — a parsed SIFEN answer, mapped onto the port's vocabulary.
 *
 * Pure and total: no I/O, no clock (the instant arrives as an argument), no
 * ambient state, no logging. Every function sets **every** field of the result
 * it returns, with `null` for a field the answer does not provide — ADR-007 §2's
 * shapes have no "absent" encoding, and an omitted key would make two different
 * answers indistinguishable to the caller that persists them.
 *
 * Sources, all in `docs/06-fiscal/SIFEN-BASELINE.md`, which is this module's
 * protocol record of truth:
 *
 * ```text
 * dEstRes            Aprobado · Aprobado con observación · Rechazado    §10, §23.3
 * batch reception    0300 queued · 0301 not queued                      §23.7
 * batch query        0360 · 0361 (10 min) · 0362 · 0364 (48 h)          §23.7
 * Consulta DE        0420 not found · 0421 not authorized · 0422 found  §23.6 Tabla G
 * Consulta RUC       0500 not found · 0501 not authorized · 0502 found  §23.6 Tabla H
 * ```
 *
 * Four rules shape the module, and each one is a way of not inventing protocol
 * or of not losing what the service said:
 *
 * 1. **`dEstRes` is mapped by an exhaustive switch over its validated union**,
 *    not by an index into a table and not through `describeDeStatus`'s
 *    `unknown` arm. The parser already refuses a fourth status (§23.3: the
 *    schema declares a bare `xs:string`, so the client validates the domain
 *    itself), so a `switch` here is the compiler's guarantee that a new
 *    published status cannot be mapped by accident — it stops compiling.
 *    `Aprobado con observación` becomes `APPROVED`, as §10 requires, and the
 *    observation survives in `reason` because the messages are read there
 *    verbatim.
 * 2. **The reason codes stay strings and are carried, never coerced.** §23.8
 *    item 7 records that no retrieved source enumerates the `dCodRes`
 *    catalogue, so an unlisted four-digit code reaches the caller as itself.
 * 3. **A code that resolves nothing carries no document identity.** Per ADR-007
 *    §2, `PROCESSING`, a batch the service does not know, a closed window and a
 *    terminal configuration error identify no DE: `cdc` and `externalId` are
 *    `null` there, and only a row that reports a document's fate fills them —
 *    0362's first group, and Tabla G's `0422`.
 * 4. **`reason` is the service's own text** — the `dMsgRes` values, joined, or,
 *    where the schema leaves them out, a client-authored note that says what is
 *    missing. Every note below is **ours**, marked as such, and none of them is
 *    presented as a protocol constant.
 *
 * **One field is read here that the parser does not expose**: the CDC of the DE
 * a `0422` answer carries. `WS_SiConsDE_v141.xsd` types `xContenDE` as
 * `xs:string`, the parser keeps the field whole (§23.8 item 3's bare-or-wrapped
 * rule), and `SifenDeContent` carries the DE's bytes — so this module reads the
 * `Id` attribute that `DE_v150.xsd` **requires** on `<DE>` (§4: "The CDC is the
 * `Id` attribute of `<DE>` and is required"; §5: "the `Id` attribute whose value
 * is the CDC") and validates it against `tCDC` before returning it. A value that
 * does not match is `null`, never echoed.
 */

import type {
  FiscalIssueOutcome,
  FiscalIssueResult,
  FiscalQueryOutcome,
  FiscalQueryResult,
} from "../fiscal-provider.port.js";
import {
  describeBatchQuery,
  describeBatchReception,
  describeCdcQuery,
  describeRucQuery,
  type SifenEstadoResultado,
  type SifenLookupOutcome,
} from "./sifen.codes.js";
import {
  SIFEN_CDC_PATTERN,
  type SifenBatchQueryResponse,
  type SifenBatchReceptionResponse,
  type SifenCdcQueryResponse,
  type SifenDeContent,
  type SifenProcessingProtocol,
  type SifenRucQueryResponse,
  type SifenRucStatus,
} from "./sifen.messages.js";

/**
 * What every mapping needs beside the answer it maps.
 *
 * `resolvedAt` is an argument rather than a read of the clock, because this
 * module owns no clock; the caller's instant is the one the document's row is
 * updated with. The two snapshots travel **raw** and are only echoed — ADR-007
 * §2's port shapes say so, and sanitizing them is the Fiscal boundary's job
 * (the sanitized snapshot writer, not this module).
 */
export interface SifenOutcomeContext {
  /** RAW provider request for the snapshot; the Fiscal boundary sanitizes it. */
  readonly providerRequest: unknown;
  /** RAW provider response for the snapshot; the Fiscal boundary sanitizes it. */
  readonly providerResponse: unknown;
  /** ISO instant, supplied by the caller's clock. */
  readonly resolvedAt: string;
}

/**
 * The RUC query's answer, in SIFEN's own vocabulary.
 *
 * Deliberately **not** a `FiscalQueryResult`: the port has no capability for
 * this service (ADR-007 §3 gives the port one query and this is not it), and the
 * Manual's §9.6 diagnostic has no outcome to map onto — it reports what SIFEN
 * knows about a RUC, not what happened to a document. The caller that asked is
 * the one deciding what to do with the answer, so the answer is handed back
 * whole: the descriptor's outcome, the code it came from, and the container when
 * the service sent one.
 */
export interface SifenRucQueryOutcome {
  readonly outcome: SifenLookupOutcome;
  readonly dCodRes: string;
  readonly status: SifenRucStatus | undefined;
}

/**
 * The separator between two `dMsgRes` values in `reason`.
 *
 * Client-authored: the schema lets `gResProc` repeat and publishes nothing about
 * how the messages compose into one string, so this is formatting and not
 * protocol. The individual messages stay available in `providerResponse`.
 */
const REASON_SEPARATOR = "; ";

/**
 * `reason` when a protocol with no `dEstRes` also carries no `dMsgRes`.
 *
 * **Ours, not SIFEN's.** §23.3 declares both `dEstRes` and `gResProc` optional,
 * so an answer can say nothing at all; the document's row is left with
 * `FUNCTIONAL_REJECTION` and the operator is owed a reason for it.
 */
export const SIFEN_RECEPTION_FATE_ABSENT_REASON =
  "The processing protocol carries no dEstRes, so SIFEN did not state the document's fate.";

/**
 * `reason` when SIFEN approved with an observation and stated none.
 *
 * **Ours, not SIFEN's.** §10 requires the observation to survive; a message is
 * where an observation normally arrives, and when none did, the status that
 * announced it is the only trace left to preserve.
 */
export const SIFEN_OBSERVATION_UNSTATED_REASON =
  "SIFEN reported 'Aprobado con observación' without stating the observation in a dMsgRes.";

/**
 * `reason` when an answered protocol carries no `dMsgRes` at all.
 *
 * **Ours, not SIFEN's.** §23.3 declares `dMsgRes` optional inside `gResProc`,
 * and an approval with neither an observation nor a message is a legitimate
 * answer.
 */
export const SIFEN_RECEPTION_MESSAGE_ABSENT_REASON = "The processing protocol reports no dMsgRes.";

/**
 * `reason` when the batch service answered without a message.
 *
 * **Ours, not SIFEN's.** §23.4 declares all five `rResEnviLoteDe` members
 * optional, so a batch answer can be a code and nothing else.
 */
export const SIFEN_BATCH_RECEPTION_MESSAGE_ABSENT_REASON =
  "The batch reception answer reports no dMsgRes.";

/**
 * `reason` when a `0362` concluded the batch and carried no per-DE group.
 *
 * **Ours, not SIFEN's.** §23.4 makes `gResProcLote` optional, and a conclusion
 * that reports no document is not an answer this client can apply: the batch is
 * done and nothing said what happened.
 */
export const SIFEN_BATCH_CONCLUDED_WITHOUT_RESULTS_REASON =
  "SIFEN concluded the batch processing without reporting any DE result, so no document's fate " +
  "can be read from the answer.";

/**
 * `reason` for `0364`, §23.7's closed window.
 *
 * **Ours, not SIFEN's**, and the mapping decision ADR-007 §6 records: the batch
 * path stops here for this batch, and the per-CDC query answers for the
 * document instead. The service's own `dMsgResLot` stays in `providerResponse`.
 */
export const SIFEN_BATCH_WINDOW_CLOSED_REASON =
  "SIFEN's batch query window closed after 48 hours (§23.7), so this batch will not resolve " +
  "through the batch service; the per-CDC consulta (Manual §9.4) is the fallback (ADR-007 §6).";

/**
 * The synchronous reception's answer — §23.3, `rRetEnviDe.rProtDe`.
 *
 * §10's three values map onto the port as `APPROVED`/`REJECTED`, and an absent
 * `dEstRes` is a **functional rejection** rather than an approval: the schema
 * allows the field to be missing, and approving a document whose fate the
 * provider never stated would be a lie the emitter then acts on.
 *
 * `externalId` is `dProtAut`, the authorization protocol; `providerReference`
 * is `null`, because a synchronous answer leaves nothing to poll — the document
 * is resolved in the call that carried it.
 */
export function mapReceptionOutcome(
  args: SifenOutcomeContext & {
    readonly protocol: SifenProcessingProtocol;
  }
): FiscalIssueResult {
  const { protocol } = args;

  return issueResult(args, {
    outcome: issueOutcomeForDeStatus(protocol.dEstRes),
    externalId: protocol.dProtAut ?? null,
    cdc: protocol.cdc ?? null,
    reasonCode: firstResultCode(protocol.gResProc),
    reason: receptionReason(protocol),
  });
}

/**
 * The batch reception's answer — §23.4, `rResEnviLoteDe`.
 *
 * `0300` is `SUBMITTED`, with `dProtConsLote` as `providerReference`: the
 * document is in SIFEN's queue and its fate arrives through the port's `query`
 * capability later. **A `0300` without the lot number is still `SUBMITTED`**,
 * because the Guide's own recovery rule covers exactly that case (§23.7: consult
 * the batch with a CDC that was sent, "solo en caso de no recibir el Número de
 * Lote"), and refusing the hand-over would be wrong — SIFEN holds the document.
 * `0301` is a functional rejection of the **batch**, which is not the same
 * statement as a rejected DE.
 *
 * `cdc` and `externalId` are `null` on every row: this answer identifies an
 * operation, never a document.
 */
export function mapBatchReceptionOutcome(
  args: SifenOutcomeContext & {
    readonly response: SifenBatchReceptionResponse;
  }
): FiscalIssueResult {
  const { response } = args;
  const descriptor = describeBatchReception(response.dCodRes, response.dProtConsLote);
  const reason = response.dMsgRes ?? SIFEN_BATCH_RECEPTION_MESSAGE_ABSENT_REASON;

  switch (descriptor.outcome) {
    case "queued":
      return issueResult(args, {
        outcome: "SUBMITTED",
        providerReference: descriptor.dProtConsLote ?? null,
        reasonCode: response.dCodRes,
        reason,
      });
    case "notQueued":
      return issueResult(args, {
        outcome: "FUNCTIONAL_REJECTION",
        reasonCode: response.dCodRes,
        reason,
      });
    case "unknown":
      // §23.8 item 7: an unlisted but well-formed code is data. The raw code
      // travels as `reasonCode` and the outcome is the one a batch that was
      // never handed over produces.
      return issueResult(args, {
        outcome: "FUNCTIONAL_REJECTION",
        reasonCode: response.dCodRes,
        reason,
      });
  }
}

/**
 * The batch-result query's answer — §23.4, `rResEnviConsLoteDe`.
 *
 * The four published codes, and what each one means to a caller holding a
 * batch handle:
 *
 * ```text
 * 0360  SIFEN does not know the batch  -> CONFIGURATION_ERROR
 * 0361  still processing               -> PROCESSING, the Guide's ten minutes
 * 0362  concluded                      -> the FIRST group's fate, with its identity
 * 0364  the 48-hour window closed      -> CONFIGURATION_ERROR, per-CDC fallback
 * ```
 *
 * `0360` is terminal precisely because the handle is not recoverable: SIFEN
 * never queued the batch this client believes it sent, so the document cannot be
 * resolved through this path.
 *
 * **`0362`'s identity is the first group's** — `id` for `cdc` and `dProtAut` for
 * `externalId` — because §23.7's recovery path has to persist the identity it
 * just learned, and one batch carries up to fifty documents. A conclusion with
 * no group is a `CONFIGURATION_ERROR`: the batch is done and the answer says
 * nothing about any document, which is not a resolution to apply.
 */
export function mapBatchQueryOutcome(
  args: SifenOutcomeContext & {
    readonly response: SifenBatchQueryResponse;
  }
): FiscalQueryResult {
  const { response } = args;
  const descriptor = describeBatchQuery(response.dCodResLot);

  switch (descriptor.outcome) {
    case "unknownLot":
      return queryResult(args, {
        outcome: "CONFIGURATION_ERROR",
        reasonCode: response.dCodResLot,
        reason: response.dMsgResLot,
      });
    case "processing":
      return queryResult(args, {
        outcome: "PROCESSING",
        reasonCode: response.dCodResLot,
        reason: response.dMsgResLot,
        // §23.7's Guide: "se recomienda comenzar a realizar la consulta pasados
        // los 10 minutos de la recepción y luego a intervalos regulares no
        // menores a 10 minutos". The constant is `sifen.codes.ts`'s, not a
        // number written here.
        retryAfterMs: descriptor.retryAfterMs,
      });
    case "windowClosed":
      return queryResult(args, {
        outcome: "CONFIGURATION_ERROR",
        reasonCode: response.dCodResLot,
        reason: SIFEN_BATCH_WINDOW_CLOSED_REASON,
      });
    case "concluded":
      return concludedBatchResult(args);
    case "unknown":
      return queryResult(args, {
        outcome: "CONFIGURATION_ERROR",
        reasonCode: response.dCodResLot,
        reason: response.dMsgResLot,
      });
  }
}

/**
 * The CDC query's answer — §23.6, `rEnviConsDeResponse` (Manual §9.4, Tabla G).
 *
 * `0420` says SIFEN does not have the document at all. The port's nearest member
 * is `CONFIGURATION_ERROR`, and that is a **mapping decision, not a semantic
 * claim**: the worker's `mapOutcomeToStatus` sends `CONFIGURATION_ERROR` to the
 * `ERROR` status, `ERROR` is one of the statuses the delivery path may claim
 * (`CLAIMABLE_STATUSES`), and the reconciliation sweep re-drives exactly those
 * rows — so a document SIFEN has never seen returns to a claimable state and is
 * resubmitted, which is what a nonexistent CDC has to produce. `0421` is
 * terminal for the same mapping's other half: the certificate is not authorized
 * to consult, and a retry cannot change that.
 *
 * `0422` is the approval, with the DE in `xContenDE`: `cdc` is the DE's own
 * `Id`, read and validated by `cdcOfContainedDe` below, and `externalId` is the
 * container's `dProtAut` when the answer was wrapped in `rContDe`.
 */
export function mapCdcQueryOutcome(
  args: SifenOutcomeContext & {
    readonly response: SifenCdcQueryResponse;
  }
): FiscalQueryResult {
  const { response } = args;
  const descriptor = describeCdcQuery(response.dCodRes);

  switch (descriptor.outcome) {
    case "notFound":
    case "notAuthorized":
      return queryResult(args, {
        outcome: "CONFIGURATION_ERROR",
        reasonCode: response.dCodRes,
        reason: response.dMsgRes,
      });
    case "found":
      return queryResult(args, {
        outcome: "APPROVED",
        cdc: cdcOfContainedDe(response.xContenDE),
        externalId: response.xContenDE?.dProtAut ?? null,
        reasonCode: response.dCodRes,
        reason: response.dMsgRes,
      });
    case "unknown":
      // Carried, not coerced: §23.8 item 7's open catalogue means a code this
      // client has never seen is an answer this client cannot interpret, and
      // `TRANSIENT_FAILURE` would invite a retry the service did not ask for.
      return queryResult(args, {
        outcome: "CONFIGURATION_ERROR",
        reasonCode: response.dCodRes,
        reason: response.dMsgRes,
      });
  }
}

/**
 * The RUC status query's answer — §23.6, `rResEnviConsRUC` (Manual §9.6,
 * Tabla H).
 *
 * SIFEN-semantic on purpose: the port has no capability for this diagnostic
 * (ADR-007 §3), so there is no outcome to translate into. `0500`/`0501` are the
 * descriptor's own `notFound`/`notAuthorized` **with no status** — the answer
 * found no RUC, so a container beside one of those codes is not a status this
 * diagnostic will hand over. `0502` is `found` with `xContRUC`, the five fields
 * the Manual's Schema XML 17 pins. A code outside Tabla H is `unknown` carrying
 * the raw code — and carrying the container too, when the answer happened to
 * send one, because this result has no raw-response field (the context's
 * snapshots are the caller's to keep) and dropping the only payload of the
 * answer would lose it silently.
 */
export function mapRucQueryOutcome(
  args: SifenOutcomeContext & {
    readonly response: SifenRucQueryResponse;
  }
): SifenRucQueryOutcome {
  const { response } = args;
  const descriptor = describeRucQuery(response.dCodRes);

  switch (descriptor.outcome) {
    case "found":
      return { outcome: "found", dCodRes: descriptor.dCodRes, status: response.xContRUC };
    case "notFound":
    case "notAuthorized":
      return { outcome: descriptor.outcome, dCodRes: descriptor.dCodRes, status: undefined };
    case "unknown":
      return { outcome: "unknown", dCodRes: descriptor.dCodRes, status: response.xContRUC };
  }
}

/**
 * A `0362`: the batch concluded, so the answer is the **first** group's fate.
 *
 * The first group is the one SIFEN reports first, and it is the only one a
 * single `FiscalQueryResult` can carry. The caller that reconciles a whole batch
 * reads every group from the parsed response it already holds; what this mapping
 * guarantees is that the row which asked gets a resolution and an identity it
 * can persist.
 */
function concludedBatchResult(
  args: SifenOutcomeContext & { readonly response: SifenBatchQueryResponse }
): FiscalQueryResult {
  const group = args.response.gResProcLote[0];
  if (group === undefined) {
    return queryResult(args, {
      outcome: "CONFIGURATION_ERROR",
      reasonCode: args.response.dCodResLot,
      reason: SIFEN_BATCH_CONCLUDED_WITHOUT_RESULTS_REASON,
    });
  }

  const messages = group.gResProc.map((entry) => entry.dMsgRes);

  return queryResult(args, {
    outcome: queryOutcomeForDeStatus(group.dEstRes),
    cdc: group.cdc,
    externalId: group.dProtAut ?? null,
    reasonCode: firstResultCode(group.gResProc) ?? args.response.dCodResLot,
    reason: messages.length === 0 ? args.response.dMsgResLot : messages.join(REASON_SEPARATOR),
  });
}

/**
 * `dEstRes` -> the issuance vocabulary.
 *
 * An exhaustive `switch` over the validated union, so a fourth published status
 * stops this file from compiling instead of falling through a default.
 */
function issueOutcomeForDeStatus(dEstRes: SifenEstadoResultado | undefined): FiscalIssueOutcome {
  switch (dEstRes) {
    case "Aprobado":
    case "Aprobado con observación":
      return "APPROVED";
    case "Rechazado":
      return "REJECTED";
    case undefined:
      return "FUNCTIONAL_REJECTION";
  }
}

/** `dEstRes` -> the query vocabulary, for the per-DE group a `0362` reports. */
function queryOutcomeForDeStatus(dEstRes: SifenEstadoResultado): FiscalQueryOutcome {
  switch (dEstRes) {
    case "Aprobado":
    case "Aprobado con observación":
      return "APPROVED";
    case "Rechazado":
      return "REJECTED";
  }
}

/**
 * The protocol's or the group's first reported result code.
 *
 * §23.3 and §23.4 mark `dCodRes` optional inside a group, so an entry may carry
 * only a message; the first code the answer actually reports is the one it
 * reports first, and skipping an entry that carries none is what keeps a
 * code-less observation from erasing the code behind it.
 */
function firstResultCode(
  groups: readonly { readonly dCodRes: string | undefined }[]
): string | null {
  for (const group of groups) {
    if (group.dCodRes !== undefined) {
      return group.dCodRes;
    }
  }
  return null;
}

/**
 * The reception's `reason`: the service's messages, or a note saying which part
 * of the answer is missing.
 *
 * An `Aprobado con observación` whose observation arrives in `dMsgRes` is
 * preserved verbatim by the first branch, which is what §10 requires.
 */
function receptionReason(protocol: SifenProcessingProtocol): string {
  const messages = protocol.gResProc
    .map((group) => group.dMsgRes)
    .filter((message): message is string => message !== undefined && message !== "");

  if (messages.length > 0) {
    return messages.join(REASON_SEPARATOR);
  }
  if (protocol.dEstRes === undefined) {
    return SIFEN_RECEPTION_FATE_ABSENT_REASON;
  }
  if (protocol.dEstRes === "Aprobado con observación") {
    return SIFEN_OBSERVATION_UNSTATED_REASON;
  }
  return SIFEN_RECEPTION_MESSAGE_ABSENT_REASON;
}

/**
 * The `<DE>` element's opening tag, and the `Id` attribute inside it.
 *
 * `DE_v150.xsd` requires `Id` on `<DE>` (§4, §5) and its value is the CDC, so
 * the attribute is what the answer's own identity is read from. The attribute
 * list is captured up to the tag's `>`, which bounds the search to the opening
 * tag: `<DE Id="…">` carries only `Id` and any namespace declaration, and a `>`
 * inside an attribute value would be a malformed document the parser refuses
 * long before this module sees it.
 */
const DE_OPENING_TAG_PATTERN = /<(?:[A-Za-z_][\w.-]*:)?DE(?=[\s/>])([^>]*)>/;
const DE_ID_ATTRIBUTE_PATTERN = /\bId\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * The CDC of the DE a `0422` answer carried, or `null` when it cannot be read.
 *
 * Conservative on purpose: the value is returned only when it matches §23.6's
 * `tCDC`, so a truncated or reconstructed DE yields `null` rather than an
 * identifier that would be persisted as if SIFEN had confirmed it.
 */
function cdcOfContainedDe(content: SifenDeContent | undefined): string | null {
  if (content === undefined) {
    return null;
  }
  const tag = DE_OPENING_TAG_PATTERN.exec(content.deXml);
  if (tag === null) {
    return null;
  }
  const attribute = DE_ID_ATTRIBUTE_PATTERN.exec(tag[1] ?? "");
  if (attribute === null) {
    return null;
  }
  const value = attribute[1] ?? attribute[2] ?? "";
  return SIFEN_CDC_PATTERN.test(value) ? value : null;
}

/** The fields an issue result may set; anything unset is `null`, never omitted. */
interface IssueResultFields {
  readonly outcome: FiscalIssueOutcome;
  readonly externalId?: string | null;
  readonly providerReference?: string | null;
  readonly cdc?: string | null;
  readonly reasonCode?: string | null;
  readonly reason?: string | null;
  readonly retryAfterMs?: number | null;
}

/**
 * One issue result, constructed field by field.
 *
 * Every branch above goes through this, so "all fields set" is a property of one
 * expression instead of a discipline each branch has to keep.
 */
function issueResult(context: SifenOutcomeContext, fields: IssueResultFields): FiscalIssueResult {
  return {
    outcome: fields.outcome,
    externalId: fields.externalId ?? null,
    providerReference: fields.providerReference ?? null,
    cdc: fields.cdc ?? null,
    reasonCode: fields.reasonCode ?? null,
    reason: fields.reason ?? null,
    retryAfterMs: fields.retryAfterMs ?? null,
    providerRequest: context.providerRequest,
    providerResponse: context.providerResponse,
    resolvedAt: context.resolvedAt,
  };
}

/** The fields a query result may set; anything unset is `null`, never omitted. */
interface QueryResultFields {
  readonly outcome: FiscalQueryOutcome;
  readonly cdc?: string | null;
  readonly externalId?: string | null;
  readonly reasonCode?: string | null;
  readonly reason?: string | null;
  readonly retryAfterMs?: number | null;
}

/** One query result, constructed field by field, for the same reason. */
function queryResult(context: SifenOutcomeContext, fields: QueryResultFields): FiscalQueryResult {
  return {
    outcome: fields.outcome,
    cdc: fields.cdc ?? null,
    externalId: fields.externalId ?? null,
    reasonCode: fields.reasonCode ?? null,
    reason: fields.reason ?? null,
    retryAfterMs: fields.retryAfterMs ?? null,
    providerRequest: context.providerRequest,
    providerResponse: context.providerResponse,
    resolvedAt: context.resolvedAt,
  };
}
