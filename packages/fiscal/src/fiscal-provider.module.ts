import { Module } from "@nestjs/common";
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

/**
 * The concrete implementation is created only here; no other domain imports it.
 * EPIC-16 replaces this selection with a real adapter.
 *
 * This reads `process.env` directly rather than calling the full env parser,
 * matching how `BrandingModule` validates its own Redis requirement: a factory
 * validates what IT needs, so module-level tests can boot the composition root
 * without database or Redis configuration.
 */
@Module({
  providers: [
    {
      provide: FISCAL_PROVIDER,
      useFactory: () => {
        const provider = resolveFiscalProvider(process.env.NODE_ENV, process.env.FISCAL_PROVIDER);
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
  ],
  exports: [FISCAL_PROVIDER],
})
export class FiscalProviderModule {}
