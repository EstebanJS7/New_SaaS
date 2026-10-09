import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import {
  createNullFiscalCredentialPort,
  FISCAL_CREDENTIAL_PORT,
  type FiscalCredentialPort,
  type FiscalSigningEnvironment,
} from "./fiscal-credential.port.js";
import { createFakeFiscalProvider } from "./fake-fiscal.provider.js";
import { FISCAL_PROVIDER, type FiscalProviderPort } from "./fiscal-provider.port.js";
import { createSifenDirectFiscalProvider } from "./sifen/sifen-direct.provider.js";
import { createSifenServiceFacade } from "./sifen/sifen.facade.js";

/**
 * The closed set of accepted `FISCAL_PROVIDER` values.
 *
 * Exported so the API's schema, the worker's schema and this module's factory
 * all validate against ONE list: a per-deployment copy is a copy that drifts,
 * and this value decides which implementation the whole process runs.
 *
 * These are the **environment's** strings, and they are deliberately not the
 * port's ids ({@link FISCAL_PROVIDER_VALUES}): an environment value is lower
 * case with a dash (`"fake"`, `"sifen-direct"`) while a port id is upper case
 * (`"FAKE"`, `"SIFEN_DIRECT"`). The two vocabularies differ because the
 * environment one predates the id union — `FISCAL_PROVIDER=fake` is a
 * deployment contract that extending the union must not rename — and
 * {@link buildSelectedFiscalProvider} is the single place that maps one onto
 * the other.
 */
export const FISCAL_PROVIDER_ENV_VALUES = Object.freeze(["fake", "sifen-direct"] as const);

/** One accepted `FISCAL_PROVIDER` value, derived from the set above. */
export type FiscalProviderEnvValue = (typeof FISCAL_PROVIDER_ENV_VALUES)[number];

/**
 * Resolves the configured fiscal provider from the two environment values it
 * depends on.
 *
 * Pure and exported so the production refusal below is unit-tested rather than
 * living only inside a Nest factory: an untested safety path is one that
 * regresses silently.
 *
 * The refusal is duplicated on purpose. `apiEnvSchema`'s `superRefine` is the
 * authoritative gate and runs at boot in `main.ts`; this one is defense in depth
 * at the composition root, so a boot path that skipped validation still cannot
 * silently select a fake in production.
 *
 * The refusal is about **absence**, never about the fake: an explicit `"fake"`
 * stays selectable in production because it is the documented dedicated-demo
 * path (`docs/03-architecture/DEMO-TENANT.md`). Refusing it here would break
 * that deployment without protecting anything — selecting the fake already
 * takes an operator typing it on purpose.
 */
export function resolveFiscalProvider(
  nodeEnv: string | undefined,
  rawValue: string | undefined
): FiscalProviderEnvValue | undefined {
  if (rawValue === undefined) {
    if (nodeEnv === "production") {
      throw new Error(
        "FISCAL_PROVIDER is required in production: no production fiscal provider exists until EPIC-16."
      );
    }
    return undefined;
  }
  const selection = FISCAL_PROVIDER_ENV_VALUES.find((candidate) => candidate === rawValue);
  if (selection === undefined) {
    throw new Error(`FISCAL_PROVIDER must be one of: ${FISCAL_PROVIDER_ENV_VALUES.join(", ")}.`);
  }
  return selection;
}

/**
 * Resolves the deployment's DNIT environment from `SIFEN_ENVIRONMENT`.
 *
 * `TEST` is the default **outside production** and it is applied **here**, not
 * by the deployment's parsed env: the worker's schema defaults the parsed object
 * in a `.transform`, so a field-level default would already hold a value by the
 * time a production gate ran and the gate could not tell an operator who forgot
 * the variable from one who chose `TEST`. This factory reads `process.env`
 * directly, so it must default identically.
 *
 * **In production an absent value is refused**, because the default is what
 * makes the failure silent: a deployment that selected `sifen-direct` and forgot
 * the variable would build the real adapter against the **DNIT test host**, with
 * test material and production intent (ADR-008 §3). This is the same shape as
 * {@link resolveFiscalProvider}'s own production rule, and it is here rather
 * than only in an app's schema because this factory is the single construction
 * point every deployable passes through.
 *
 * An unknown string is refused by name and never falls back to `TEST`: the
 * silent fallback would point a deployment at the DNIT test host with a
 * production certificate.
 */
export function resolveSifenEnvironment(
  rawValue: string | undefined,
  nodeEnv: string | undefined
): FiscalSigningEnvironment {
  if (rawValue === undefined) {
    if (nodeEnv === "production") {
      throw new Error("SIFEN_ENVIRONMENT is required in production.");
    }
    return "TEST";
  }
  if (rawValue !== "TEST" && rawValue !== "PRODUCTION") {
    throw new Error("SIFEN_ENVIRONMENT must be one of: TEST, PRODUCTION.");
  }
  return rawValue;
}

export interface BuildSelectedFiscalProviderArgs {
  readonly nodeEnv: string | undefined;
  readonly rawFiscalProvider: string | undefined;
  readonly rawSifenEnvironment: string | undefined;
  readonly credentialPort: FiscalCredentialPort;
}

/**
 * Builds the one provider the process runs, for the resolved selection.
 *
 * Pure and exported for the same reason {@link resolveFiscalProvider} is: the
 * selection and the environment refusal are safety paths a Nest factory alone
 * cannot unit-test. The module's factory reads `process.env` and forwards the
 * injected port here, so the module still declares a single factory provider
 * and still injects {@link FISCAL_CREDENTIAL_PORT}.
 *
 * A `sifen-direct` selection builds the real adapter over the facade whether or
 * not a real credential port is wired. With the fail-closed default every read
 * answers `null`, and the adapter answers `CONFIGURATION_ERROR` per call — the
 * refusal is per call on purpose: a tenant without material is a configuration
 * state, not a reason to take the whole process down at boot.
 *
 * `caPem` is deliberately not passed: no deployment input declares a trust-store
 * override (ADR-008 does not name one), so the transport's own default trust
 * store is the only reviewed configuration. Adding the input is a follow-up,
 * recorded rather than implied.
 */
export function buildSelectedFiscalProvider(
  args: BuildSelectedFiscalProviderArgs
): FiscalProviderPort {
  const provider = resolveFiscalProvider(args.nodeEnv, args.rawFiscalProvider);
  switch (provider) {
    // The non-production default and the explicit dedicated-demo opt-in.
    case undefined:
    case "fake":
      return createFakeFiscalProvider();
    case "sifen-direct":
      return createSifenDirectFiscalProvider({
        facade: createSifenServiceFacade({
          credentialPort: args.credentialPort,
          environment: resolveSifenEnvironment(args.rawSifenEnvironment, args.nodeEnv),
        }),
      });
    default:
      throw new Error("Unsupported FISCAL_PROVIDER configuration.");
  }
}

export interface FiscalProviderModuleOptions {
  /**
   * A Nest provider for `FISCAL_CREDENTIAL_PORT`, replacing the fail-closed
   * default.
   *
   * ADR-008 §2 makes the credential a per-call read on a process-singleton
   * provider, so the port is what a deployment substitutes — never a cached
   * certificate. Both deployables supply the real implementation since
   * [[FISC-012]]; a deployment that wires none keeps the default, which answers
   * `null` for every read, and the adapter turns that into
   * `CONFIGURATION_ERROR` rather than a retry loop.
   */
  readonly credentialPort?: Provider;
}

/**
 * The concrete implementations are created only here; no other domain imports
 * one. Until EPIC-16 this selection built the fake alone; since FISC-012 WU-E2
 * it can also build the real SIFEN adapter, and the fake remains both the
 * non-production default and the explicit dedicated-demo opt-in.
 *
 * This reads `process.env` directly rather than calling the full env parser,
 * matching how `BrandingModule` validates its own Redis requirement: a factory
 * validates what IT needs, so module-level tests can boot the composition root
 * without database or Redis configuration.
 *
 * `forRoot()` exists because of ADR-008 §2: the credential port has to be
 * substitutable at the composition root without every consumer knowing which
 * implementation is wired. Both deployables import the module this way, and the
 * provider is **one or the other**, never both — a module that declared two
 * providers for one token would resolve whichever Nest picked, which is exactly
 * the kind of silent substitution the environment rule forbids.
 */
@Module({})
export class FiscalProviderModule {
  static forRoot(options: FiscalProviderModuleOptions = {}): DynamicModule {
    return {
      module: FiscalProviderModule,
      providers: [
        {
          provide: FISCAL_PROVIDER,
          useFactory: (credentialPort: FiscalCredentialPort) =>
            buildSelectedFiscalProvider({
              nodeEnv: process.env.NODE_ENV,
              rawFiscalProvider: process.env.FISCAL_PROVIDER,
              rawSifenEnvironment: process.env.SIFEN_ENVIRONMENT,
              credentialPort,
            }),
          inject: [FISCAL_CREDENTIAL_PORT],
        },
        options.credentialPort ?? defaultCredentialPortProvider(),
      ],
      exports: [FISCAL_PROVIDER, FISCAL_CREDENTIAL_PORT],
    };
  }
}

/**
 * The fail-closed default, as a `useValue` provider.
 *
 * A value rather than a factory because the port is stateless and holds nothing:
 * every deployment that wires nothing gets the same null-answering object, and a
 * test can read it back from the module instead of having to boot a container.
 */
function defaultCredentialPortProvider(): Provider {
  const port: FiscalCredentialPort = createNullFiscalCredentialPort();
  return { provide: FISCAL_CREDENTIAL_PORT, useValue: port };
}
