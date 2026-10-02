import { Module } from "@nestjs/common";
import { FISCAL_PROVIDER_ENV_VALUES } from "../config/api-env.schema.js";
import { createFakeFiscalProvider } from "./fake-fiscal.provider.js";
import { FISCAL_PROVIDER } from "./fiscal-provider.port.js";

/**
 * Reads the closed `FISCAL_PROVIDER` value from the process environment.
 *
 * This deliberately reads `process.env` directly rather than calling the full
 * env parser, matching how `BrandingModule` validates its own Redis requirement:
 * a factory validates what IT needs, so module-level tests can boot the
 * composition root without database or Redis configuration. The authoritative
 * production refusal lives in `apiEnvSchema`'s `superRefine`, which runs at boot
 * in `main.ts`; the check below is defense in depth at the composition root so a
 * boot path that skipped validation still cannot silently select a fake.
 */
function resolveFiscalProviderValue(): (typeof FISCAL_PROVIDER_ENV_VALUES)[number] | undefined {
  const raw = process.env.FISCAL_PROVIDER;
  if (raw === undefined) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FISCAL_PROVIDER is required in production: no production fiscal provider exists until EPIC-16."
      );
    }
    return undefined;
  }
  if (!(FISCAL_PROVIDER_ENV_VALUES as readonly string[]).includes(raw)) {
    throw new Error(`FISCAL_PROVIDER must be one of: ${FISCAL_PROVIDER_ENV_VALUES.join(", ")}.`);
  }
  return raw as (typeof FISCAL_PROVIDER_ENV_VALUES)[number];
}

/**
 * The concrete implementation is created only here; no other domain imports it.
 * EPIC-16 replaces this selection with a real adapter.
 */
@Module({
  providers: [
    {
      provide: FISCAL_PROVIDER,
      useFactory: () => {
        const provider = resolveFiscalProviderValue();
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
export class FiscalModule {}
