/**
 * FISC-010 WU-B — what SIFEN's result codes mean.
 *
 * Every value and every pairing here traces to a line of
 * `docs/06-fiscal/SIFEN-BASELINE.md` §23 (which in turn quotes the Manual's
 * tables and the DNIT Guide):
 *
 * ```text
 * dEstRes      Aprobado | Aprobado con observación | Rechazado   §10, §23.3
 * dCodRes      0300 queued, 0301 not queued                      §23.7
 * dCodResLot   0360, 0361 (10 min), 0362, 0364 (48 h)            §23.7
 * dCodRes      0420 not found, 0421 not authorized, 0422 found   §23.6 (Tabla G)
 * dCodRes      0500 not found, 0501 not authorized, 0502 found   §23.6 (Tabla H)
 * ```
 *
 * **This module is the vocabulary, not the provider port's.** The port's outcome
 * enum (`APPROVED`, `REJECTED`, `FUNCTIONAL_REJECTION`, …) belongs to the
 * boundary in `fiscal-provider.port.ts` and arrives with WU-E, which maps these
 * descriptors onto it. The descriptors are SIFEN-semantic on purpose: they carry
 * the value the service actually sent, so `Aprobado con observación` survives as
 * itself and not as a lossy `approved`.
 *
 * **The tables are open sets, and that is a finding, not a shortcut.** §23.8
 * item 7 records that the `dCodRes` catalogue is not enumerated by any retrieved
 * source: the schema declares `xs:string` (§23.3) and the Guide supplies only
 * the codes §23.7 lists. So a parse must not refuse a well-formed code this
 * module has never seen — it must handle it as data. Every descriptor is
 * therefore total and answers `unknown` **carrying the raw code**, which is the
 * one thing a caller can act on: `unknown` is never coerced into an outcome.
 *
 * Two deliberate details worth not re-deriving:
 *
 * 1. **The lookup is a `find` over pairs, never an index by the parsed value.**
 *    `table[code]` with `code = "__proto__"` resolves through
 *    `Object.prototype`, which is the prototype-pollution shape ADR-008 §5's
 *    "constructs its result field by field" guardrail exists for. The pairs are
 *    compared by equality, exactly as `dte.catalogues.ts` does it.
 * 2. **`dEstRes` is matched case-sensitively against §10's spelling**, which is
 *    `Aprobado con observación` with a lowercase `o`. §23.7 quotes the Guide's
 *    prose spelling that one with a capital `O`; prose is not the field value,
 *    and the Manual's field table is what the field carries.
 */

/**
 * `dEstRes`'s three published values and the outcome each one carries.
 *
 * `as const` so the union below is derived from the table rather than declared
 * beside it — one source for the domain, which is what makes the parser's
 * "one of three published strings" check and WU-E's mapping the same fact.
 */
export const SIFEN_DE_STATUS_OUTCOMES = [
  { dEstRes: "Aprobado", outcome: "approved" },
  { dEstRes: "Aprobado con observación", outcome: "approved_with_observation" },
  { dEstRes: "Rechazado", outcome: "rejected" },
] as const;

/** The three strings `dEstRes` may carry (§10, §23.3, §23.9). */
export type SifenEstadoResultado = (typeof SIFEN_DE_STATUS_OUTCOMES)[number]["dEstRes"];

/** The outcomes `dEstRes` maps onto; `unknown` is the value outside the domain. */
export type SifenDeStatusOutcome = (typeof SIFEN_DE_STATUS_OUTCOMES)[number]["outcome"] | "unknown";

/**
 * What `dEstRes` said, with the value it said it in.
 *
 * The observation is **preserved** rather than folded into the outcome: §10
 * requires `Aprobado con observación` to map to an approval while the observation
 * itself reaches the caller, and the only place it survives is right here.
 */
export type SifenDeStatusDescriptor =
  | { readonly outcome: "approved"; readonly dEstRes: SifenEstadoResultado }
  | { readonly outcome: "approved_with_observation"; readonly dEstRes: SifenEstadoResultado }
  | { readonly outcome: "rejected"; readonly dEstRes: SifenEstadoResultado }
  | { readonly outcome: "unknown"; readonly dEstRes: string };

/**
 * §23.7's Guide batch-reception codes: `0300` queued, `0301` not queued.
 *
 * §23.7 records these two as the batch's own answers. `0300` hands back the batch
 * number the caller must poll with, `0301` says the **batch** was never queued —
 * which is not the same statement as a rejected DE, and is why the two are
 * separate outcomes rather than a boolean.
 */
export const SIFEN_BATCH_RECEPTION_CODES = [
  { dCodRes: "0300", outcome: "queued" },
  { dCodRes: "0301", outcome: "notQueued" },
] as const;

/** The outcomes a batch reception carries. */
export type SifenBatchReceptionOutcome =
  (typeof SIFEN_BATCH_RECEPTION_CODES)[number]["outcome"] | "unknown";

/**
 * What the batch service answered.
 *
 * `queued` carries `dProtConsLote`, the **asynchronous handle** §23.7 tells the
 * caller to poll with — and it stays `string | undefined` because the Guide's own
 * recovery rule covers the case where a `0300` came back without the number
 * ("se puede consultar el lote con un CDC que fue enviado en el lote
 * respectivo … solo en caso de no recibir el Número de Lote").
 */
export type SifenBatchReceptionDescriptor =
  | {
      readonly outcome: "queued";
      readonly dCodRes: string;
      readonly dProtConsLote: string | undefined;
    }
  | { readonly outcome: "notQueued"; readonly dCodRes: string }
  | { readonly outcome: "unknown"; readonly dCodRes: string };

/**
 * §23.7's Guide batch-query codes, and the two timings they imply.
 *
 * `0364` is the end of the **48-hour** window, after which the Guide sends the
 * caller to the per-CDC query — which is why WU-B implements that service
 * (§23.9, §23.6).
 */
export const SIFEN_BATCH_QUERY_CODES = [
  { dCodResLot: "0360", outcome: "unknownLot" },
  { dCodResLot: "0361", outcome: "processing" },
  { dCodResLot: "0362", outcome: "concluded" },
  { dCodResLot: "0364", outcome: "windowClosed" },
] as const;

/**
 * §23.7, the Guide's own number: "se recomienda comenzar a realizar la consulta
 * pasados los 10 minutos de la recepción y luego a intervalos regulares no
 * menores a 10 minutos".
 *
 * It is a **recommendation**, and §23.7 says so; it is a constant because a
 * client that polls faster is the behaviour the Guide is warning against. It
 * rides on the `processing` outcome as `retryAfterMs`, and it is also the
 * interval §23.7 recommends between a `0300` and the first query.
 */
export const SIFEN_BATCH_POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * §23.7, the Guide's window: "0364 La consulta del lote contempla un plazo de
 * hasta 48 horas posteriores al envío del mismo."
 *
 * Exported for the caller that has to decide whether a `0364` was expected; this
 * module owns no clock, so nothing here compares it to anything.
 */
export const SIFEN_BATCH_QUERY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The outcomes a batch query carries. */
export type SifenBatchQueryOutcome =
  (typeof SIFEN_BATCH_QUERY_CODES)[number]["outcome"] | "unknown";

/**
 * What the batch query answered for the whole batch.
 *
 * Only `processing` carries `retryAfterMs`, and that is the point of the union:
 * a caller that polls on every outcome is polling on `concluded`, which the
 * Guide's cadence does not ask for.
 */
export type SifenBatchQueryDescriptor =
  | { readonly outcome: "unknownLot"; readonly dCodResLot: string }
  | { readonly outcome: "processing"; readonly dCodResLot: string; readonly retryAfterMs: number }
  | { readonly outcome: "concluded"; readonly dCodResLot: string }
  | { readonly outcome: "windowClosed"; readonly dCodResLot: string }
  | { readonly outcome: "unknown"; readonly dCodResLot: string };

/**
 * §23.6's Tabla G — the CDC query: `0420` CDC inexistente, `0421` RUC del
 * certificado sin permiso, `0422` CDC encontrado.
 */
export const SIFEN_CDC_QUERY_CODES = [
  { dCodRes: "0420", outcome: "notFound" },
  { dCodRes: "0421", outcome: "notAuthorized" },
  { dCodRes: "0422", outcome: "found" },
] as const;

/**
 * §23.6's Tabla H — the RUC status query: `0500` RUC no existe, `0501` RUC sin
 * permiso de consulta por WS, `0502` RUC encontrado.
 *
 * The same three outcomes as Tabla G in a different code space, which is exactly
 * why the two have one descriptor shape and two tables: the vocabulary is shared,
 * the codes are not.
 */
export const SIFEN_RUC_QUERY_CODES = [
  { dCodRes: "0500", outcome: "notFound" },
  { dCodRes: "0501", outcome: "notAuthorized" },
  { dCodRes: "0502", outcome: "found" },
] as const;

/** The outcomes an unsigned consultation carries, in either code space. */
export type SifenLookupOutcome = "notFound" | "notAuthorized" | "found" | "unknown";

/** What a consultation answered, with the code it answered in. */
export interface SifenLookupDescriptor {
  readonly outcome: SifenLookupOutcome;
  readonly dCodRes: string;
}

/** `dEstRes`'s descriptor; `unknown` carries the value the service sent. */
export function describeDeStatus(dEstRes: string): SifenDeStatusDescriptor {
  const entry = SIFEN_DE_STATUS_OUTCOMES.find((candidate) => candidate.dEstRes === dEstRes);
  if (entry === undefined) {
    return { outcome: "unknown", dEstRes };
  }
  switch (entry.outcome) {
    case "approved":
      return { outcome: "approved", dEstRes: entry.dEstRes };
    case "approved_with_observation":
      return { outcome: "approved_with_observation", dEstRes: entry.dEstRes };
    case "rejected":
      return { outcome: "rejected", dEstRes: entry.dEstRes };
  }
}

/**
 * The batch reception's descriptor.
 *
 * `dProtConsLote` is a parameter rather than something the table holds, because
 * it belongs to the answer and not to the code: the same `0300` with and without
 * a lot number sends the caller down two different paths (§23.7).
 */
export function describeBatchReception(
  dCodRes: string,
  dProtConsLote: string | undefined
): SifenBatchReceptionDescriptor {
  const entry = SIFEN_BATCH_RECEPTION_CODES.find((candidate) => candidate.dCodRes === dCodRes);
  if (entry === undefined) {
    return { outcome: "unknown", dCodRes };
  }
  if (entry.outcome === "queued") {
    return { outcome: "queued", dCodRes, dProtConsLote };
  }
  return { outcome: "notQueued", dCodRes };
}

/** The batch query's descriptor, carrying the Guide's cadence on `processing`. */
export function describeBatchQuery(dCodResLot: string): SifenBatchQueryDescriptor {
  const entry = SIFEN_BATCH_QUERY_CODES.find((candidate) => candidate.dCodResLot === dCodResLot);
  if (entry === undefined) {
    return { outcome: "unknown", dCodResLot };
  }
  switch (entry.outcome) {
    case "unknownLot":
      return { outcome: "unknownLot", dCodResLot };
    case "processing":
      return {
        outcome: "processing",
        dCodResLot,
        retryAfterMs: SIFEN_BATCH_POLL_INTERVAL_MS,
      };
    case "concluded":
      return { outcome: "concluded", dCodResLot };
    case "windowClosed":
      return { outcome: "windowClosed", dCodResLot };
  }
}

/** The CDC query's descriptor: Tabla G, `0420`/`0421`/`0422`. */
export function describeCdcQuery(dCodRes: string): SifenLookupDescriptor {
  return describeLookup(SIFEN_CDC_QUERY_CODES, dCodRes);
}

/** The RUC status query's descriptor: Tabla H, `0500`/`0501`/`0502`. */
export function describeRucQuery(dCodRes: string): SifenLookupDescriptor {
  return describeLookup(SIFEN_RUC_QUERY_CODES, dCodRes);
}

function describeLookup(
  table: readonly { readonly dCodRes: string; readonly outcome: SifenLookupOutcome }[],
  dCodRes: string
): SifenLookupDescriptor {
  const entry = table.find((candidate) => candidate.dCodRes === dCodRes);
  if (entry === undefined) {
    return { outcome: "unknown", dCodRes };
  }
  return { outcome: entry.outcome, dCodRes };
}
