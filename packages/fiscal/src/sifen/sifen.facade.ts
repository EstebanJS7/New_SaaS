/**
 * FISC-010 WU-E — the six services, each one bound to its endpoint and its
 * credential.
 *
 * Baseline §8 is the Manual's §7.10 table, and it is the only source for the
 * paths: both DNIT hosts publish the same ones, and the WSDL that would confirm
 * them is unreadable from here (every path answers `302 → /vdesk/hangup.php3`,
 * §23.5). So {@link SIFEN_SERVICE_PATHS} is that table transcribed, **including
 * the `.wsdl` suffix** — the Guide obtains the WSDL itself by appending `?wsdl`,
 * which is what tells these paths are service addresses rather than
 * documentation links.
 *
 * Every method here does the same five things, in the same order, and the order
 * is the contract:
 *
 * ```text
 * 1  read the tenant's credential for this environment   credentialPort.read
 * 2  a null read is a typed failure                      SifenFacadeError
 * 3  build the request envelope                          sifen.serializer.ts
 * 4  POST it through the transport                       sendSifenRequest
 * 5  parse the answer and return it                      sifen.parser.ts
 * ```
 *
 * Four properties follow from that, and each one is why the module looks the way
 * it does:
 *
 * 1. **The credential is read per call and never cached.** The provider is a
 *    process singleton (ADR-008 §2), so a credential held in a field would be a
 *    tenant's RESTRICTED private key living across tenants and across rotations.
 *    The read happens *before* the envelope is built, so a tenant with no
 *    material never has one built for it.
 * 2. **A null read is a failure, not a silent fallback.** The port answers
 *    `null` as a state (a tenant with no `ACTIVE` material for this environment),
 *    and this facade refuses the call with `CREDENTIAL_UNAVAILABLE`. Turning it
 *    into the port's terminal `CONFIGURATION_ERROR` is [[FISC-012]]'s adapter,
 *    which is where the port vocabulary belongs.
 * 3. **Nothing is wrapped.** `SifenTransportError` and `SifenParseError` travel
 *    out of here **unchanged**: the adapter maps them, and a wrapper would erase
 *    the `failure` discriminant it branches on. Only this module's own failure —
 *    a credential this layer could not even obtain — is a
 *    {@link SifenFacadeError}.
 * 4. **No endpoint string is written anywhere else.** Each method names one key
 *    of {@link SIFEN_SERVICE_PATHS}, and the URL is that path joined to the
 *    configured base. The local double is the only caller that sets a base URL;
 *    every deployment takes `sifenBaseUrl(environment)`.
 *
 * **No logging, no ambient clock outside `now`, no `process.env`.** The clock is
 * a dependency because the transport checks the credential's freshness against
 * an instant and a test must be able to place it; the outcome mapper's
 * `resolvedAt` is the caller's own instant, because this layer returns the parsed
 * answer and not a port result.
 */

import type { FiscalCredentialPort, FiscalSigningEnvironment } from "../fiscal-credential.port.js";
import type {
  SifenBatchQueryResponse,
  SifenBatchReceptionResponse,
  SifenCdcQueryResponse,
  SifenEventReceptionResponse,
  SifenReceptionResponse,
  SifenRucQueryResponse,
} from "./sifen.messages.js";
import {
  parseBatchQueryResponse,
  parseBatchReceptionResponse,
  parseCdcQueryResponse,
  parseEventReceptionResponse,
  parseReceptionResponse,
  parseRucQueryResponse,
} from "./sifen.parser.js";
import {
  serializeBatchQuery,
  serializeBatchReception,
  serializeCdcQuery,
  serializeEventReception,
  serializeReception,
  serializeRucQuery,
} from "./sifen.serializer.js";
import { sendSifenRequest, sifenBaseUrl } from "./sifen.transport.js";

/**
 * §8's paths, exactly as the Manual's table writes them, `.wsdl` suffix
 * included.
 *
 * Frozen, and the only place in this package where a service path appears — the
 * `?wsdl` suffix is not part of any of them, and neither is the host, which is
 * the environment's (`SIFEN_ENVIRONMENT_HOSTS`).
 */
export const SIFEN_SERVICE_PATHS = Object.freeze({
  receiveDe: "/de/ws/sync/recibe.wsdl",
  receiveBatch: "/de/ws/async/recibe-lote.wsdl",
  queryBatch: "/de/ws/consultas/consulta-lote.wsdl",
  queryDe: "/de/ws/consultas/consulta.wsdl",
  queryRuc: "/de/ws/consultas/consulta-ruc.wsdl",
  receiveEvent: "/de/ws/eventos/evento.wsdl",
} as const);

export interface SifenFacadeDependencies {
  readonly credentialPort: FiscalCredentialPort;
  readonly environment: FiscalSigningEnvironment;
  /**
   * Defaults to `sifenBaseUrl(environment)`. An origin without a trailing slash;
   * the local double is the only caller that sets it.
   */
  readonly baseUrl?: string;
  /** Defaults to `sendSifenRequest`. Injected so the facade is testable without a network. */
  readonly transport?: typeof sendSifenRequest;
  /**
   * Defaults to `() => new Date()`. The instant the transport's credential
   * freshness check is made against — the results' `resolvedAt` belongs to the
   * caller of `sifen.outcomes.ts`.
   */
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly caPem?: readonly string[];
  readonly signal?: AbortSignal;
}

/**
 * One typed method per implemented service.
 *
 * The arguments are the service's own inputs and the tenant; nothing about the
 * transport, the envelope or the credential is visible to the caller. The
 * answers are the parsed shapes of `sifen.messages.ts`, which is what
 * `sifen.outcomes.ts` maps onto the provider port.
 */
export interface SifenServiceFacade {
  receiveDe(args: {
    readonly tenantId: string;
    readonly dId: string;
    readonly signedDteXml: string;
  }): Promise<SifenReceptionResponse>;
  receiveBatch(args: {
    readonly tenantId: string;
    readonly dId: string;
    readonly deXmls: readonly string[];
  }): Promise<SifenBatchReceptionResponse>;
  queryBatch(args: {
    readonly tenantId: string;
    readonly dId: string;
    readonly dProtConsLote?: string;
    readonly dCDC?: string;
  }): Promise<SifenBatchQueryResponse>;
  queryDe(args: {
    readonly tenantId: string;
    readonly dId: string;
    readonly dCDC: string;
  }): Promise<SifenCdcQueryResponse>;
  queryRuc(args: {
    readonly tenantId: string;
    readonly dId: string;
    readonly dRUCCons: string;
  }): Promise<SifenRucQueryResponse>;
  receiveEvent(args: {
    readonly tenantId: string;
    readonly dId: string;
    readonly eventXml: string;
  }): Promise<SifenEventReceptionResponse>;
}

/** What this layer itself refused, as opposed to what the transport or the parser did. */
export type SifenFacadeFailure = "CREDENTIAL_UNAVAILABLE";

/** One fixed sentence per failure, in the style of the transport's own table. */
const SIFEN_FACADE_MESSAGES: Record<SifenFacadeFailure, string> = {
  CREDENTIAL_UNAVAILABLE:
    "The tenant has no active SIFEN signing material for this environment, so the call cannot " +
    "be authenticated (ADR-008 §2).",
};

/**
 * A failure of this layer, in the house style (`DteCatalogueError`,
 * `SifenTransportError`, `SifenParseError`): a discriminant plus a message.
 *
 * The message carries no credential, no certificate and no body — the whole
 * class of thing this layer touches — and the only instance currently produced
 * is a credential that could not be read at all.
 */
export class SifenFacadeError extends Error {
  readonly failure: SifenFacadeFailure;

  constructor(failure: SifenFacadeFailure, message: string) {
    super(message);
    this.name = "SifenFacadeError";
    this.failure = failure;
  }
}

/**
 * Binds the six services to one environment, one credential port and one
 * transport.
 *
 * Construction reads no credential, opens no socket and reads no clock: every
 * one of those happens inside the call that needs it.
 */
export function createSifenServiceFacade(
  dependencies: SifenFacadeDependencies
): SifenServiceFacade {
  const baseUrl = dependencies.baseUrl ?? sifenBaseUrl(dependencies.environment);
  const transport = dependencies.transport ?? sendSifenRequest;
  const clock = dependencies.now ?? ((): Date => new Date());

  /**
   * The five steps, once, so no method can order them differently.
   *
   * `serialize` and `parse` are thunks and not values: the envelope is built
   * **after** the credential check, which is the order the contract pins, and
   * nothing is serialized for a call that will not be made.
   */
  async function call<T>(args: {
    readonly tenantId: string;
    readonly path: string;
    readonly serialize: () => string;
    readonly parse: (body: string) => T;
  }): Promise<T> {
    const credential = await dependencies.credentialPort.read({
      tenantId: args.tenantId,
      environment: dependencies.environment,
    });
    if (credential === null) {
      throw new SifenFacadeError(
        "CREDENTIAL_UNAVAILABLE",
        SIFEN_FACADE_MESSAGES.CREDENTIAL_UNAVAILABLE
      );
    }

    const envelope = args.serialize();
    const response = await transport({
      endpoint: `${baseUrl}${args.path}`,
      envelope,
      credential,
      now: clock(),
      timeoutMs: dependencies.timeoutMs,
      caPem: dependencies.caPem,
      signal: dependencies.signal,
    });

    return args.parse(response.body);
  }

  return {
    receiveDe: ({ tenantId, dId, signedDteXml }) =>
      call({
        tenantId,
        path: SIFEN_SERVICE_PATHS.receiveDe,
        serialize: () => serializeReception({ dId, deXml: signedDteXml }),
        parse: parseReceptionResponse,
      }),

    receiveBatch: ({ tenantId, dId, deXmls }) =>
      call({
        tenantId,
        path: SIFEN_SERVICE_PATHS.receiveBatch,
        serialize: () => serializeBatchReception({ dId, deXmls }),
        parse: parseBatchReceptionResponse,
      }),

    queryBatch: ({ tenantId, dId, dProtConsLote, dCDC }) =>
      call({
        tenantId,
        path: SIFEN_SERVICE_PATHS.queryBatch,
        serialize: () => serializeBatchQuery({ dId, dProtConsLote, dCDC }),
        parse: parseBatchQueryResponse,
      }),

    queryDe: ({ tenantId, dId, dCDC }) =>
      call({
        tenantId,
        path: SIFEN_SERVICE_PATHS.queryDe,
        serialize: () => serializeCdcQuery({ dId, dCDC }),
        parse: parseCdcQueryResponse,
      }),

    queryRuc: ({ tenantId, dId, dRUCCons }) =>
      call({
        tenantId,
        path: SIFEN_SERVICE_PATHS.queryRuc,
        serialize: () => serializeRucQuery({ dId, dRUCCons }),
        parse: parseRucQueryResponse,
      }),

    receiveEvent: ({ tenantId, dId, eventXml }) =>
      call({
        tenantId,
        path: SIFEN_SERVICE_PATHS.receiveEvent,
        serialize: () => serializeEventReception({ dId, eventXml }),
        parse: parseEventReceptionResponse,
      }),
  };
}
