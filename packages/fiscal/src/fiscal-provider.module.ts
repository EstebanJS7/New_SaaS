import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import {
  createNullFiscalCredentialPort,
  FISCAL_CREDENTIAL_PORT,
  type FiscalCredentialPort,
} from "./fiscal-credential.port.js";
import { createFakeFiscalProvider } from "./fake-fiscal.provider.js";
import { FISCAL_PROVIDER } from "./fiscal-provider.port.js";

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
 */
export function resolveFiscalProvider(
  nodeEnv: string | undefined,
  rawValue: string | undefined
): "fake" | undefined {
  if (rawValue === undefined) {
    if (nodeEnv === "production") {
      throw new Error(
        "FISCAL_PROVIDER is required in production: no production fiscal provider exists until EPIC-16."
      );
    }
    return undefined;
  }
  if (rawValue !== "fake") {
    throw new Error("FISCAL_PROVIDER must be one of: fake.");
  }
  return rawValue;
}

export interface FiscalProviderModuleOptions {
  /**
   * A Nest provider for `FISCAL_CREDENTIAL_PORT`, replacing the fail-closed
   * default.
   *
   * ADR-008 §2 makes the credential a per-call read on a process-singleton
   * provider, so the port is what a deployment substitutes — never a cached
   * certificate. The worker supplies the real implementation in [[FISC-012]];
   * until then the default answers `null` for every read, and the adapter turns
   * that into `CONFIGURATION_ERROR` rather than a retry loop.
   */
  readonly credentialPort?: Provider;
}

/**
 * The concrete implementation is created only here; no other domain imports it.
 * EPIC-16 replaces this selection with a real adapter.
 *
 * This reads `process.env` directly rather than calling the full env parser,
 * matching how `BrandingModule` validates its own Redis requirement: a factory
 * validates what IT needs, so module-level tests can boot the composition root
 * without database or Redis configuration.
 *
 * `forRoot()` exists because of ADR-008 §2: the credential port has to be
 * substitutable at the composition root without every consumer knowing which
 * implementation is wired. Both deployables import the module this way, and the
 * default provider is **one or the other**, never both — a module that declared
 * two providers for one token would resolve whichever Nest picked, which is
 * exactly the kind of silent substitution the environment rule forbids.
 */
@Module({})
export class FiscalProviderModule {
  static forRoot(options: FiscalProviderModuleOptions = {}): DynamicModule {
    return {
      module: FiscalProviderModule,
      providers: [
        {
          provide: FISCAL_PROVIDER,
          useFactory: () => {
            const provider = resolveFiscalProvider(
              process.env.NODE_ENV,
              process.env.FISCAL_PROVIDER
            );
            switch (provider) {
              // The non-production default and the explicit dedicated-demo opt-in.
              case undefined:
              case "fake":
                return createFakeFiscalProvider();
              default:
                throw new Error("Unsupported FISCAL_PROVIDER configuration.");
            }
          },
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
