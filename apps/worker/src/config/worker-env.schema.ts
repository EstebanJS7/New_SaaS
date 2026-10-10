import { FISCAL_PROVIDER_ENV_VALUES } from "@newsaas/fiscal";
import { z } from "zod";

/**
 * Environment variables required by the worker at startup.
 *
 * The worker does not serve branding assets, but it parses the same branding
 * asset flag and object-storage bucket as the API so both deployables share one
 * production configuration contract. When branding assets are enabled in
 * production the bucket is mandatory; otherwise the optional in-memory fallback
 * remains available for local development and tests.
 *
 * FISC-012 WU-D1 adds the fiscal deployment inputs. The tenant secret boundary's
 * key ring is required in production for the same reason the API requires it:
 * without it the store silently selects the in-memory driver, so the credential
 * reader would lose RESTRICTED signing material across restarts.
 * `SIFEN_ENVIRONMENT` is required to be *present* in production because a
 * silent `TEST` default is a wrong-host submission waiting to happen
 * (ADR-008 §3). FISC-012 WU-E2 adds `FISCAL_PROVIDER`, validated against the
 * package's closed set so a typo refuses at boot instead of deep inside
 * `FiscalProviderModule`.
 */
export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    REDIS_URL: z.string().min(1),
    // The worker now persists cleanup intents and audit rows.
    DATABASE_URL: z.string().min(1),
    /** Master kill-switch for the branding asset lifecycle (parity with API). */
    BRANDING_ASSETS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    /**
     * Object-storage configuration. Optional everywhere except production with
     * branding assets enabled. Credentials are resolved by the AWS SDK default
     * chain, never through this schema.
     */
    STORAGE_S3_BUCKET: z.string().optional(),
    STORAGE_S3_ENDPOINT: z.string().optional(),
    STORAGE_S3_REGION: z.string().optional(),
    STORAGE_S3_KEY_PREFIX: z.string().optional(),
    /**
     * Versioned platform master keys for the tenant secret boundary, as
     * `<version>:<base64-32-bytes>` entries (ADR-005). Optional in development
     * and tests, where the in-memory driver is selected; REQUIRED in production
     * by the gate below, because tenant signing material must never be held only
     * in process memory. This value is a key, so it has no development default,
     * is never logged, and its format is validated by the boundary's own
     * fail-closed parser rather than a second copy here.
     */
    SECRET_STORE_MASTER_KEYS: z.string().optional(),
    /**
     * Master-key version new writes use. Optional: the highest declared version
     * is current, so adding a key to the list is a complete rotation.
     */
    SECRET_STORE_MASTER_KEY_VERSION: z.string().optional(),
    /**
     * The fiscal provider this deployment selects (FISC-012 WU-E2).
     *
     * Optional in the schema and required in production by the gate below —
     * the same contract the API declares. Absence in production would silently
     * build the fake, and the closed set is the package's, so a typo refuses at
     * boot instead of deep inside `FiscalProviderModule`.
     */
    FISCAL_PROVIDER: z.enum(FISCAL_PROVIDER_ENV_VALUES).optional(),
    /**
     * The DNIT environment this deployment talks to (ADR-008 §3).
     *
     * Optional in the schema and required in production by the gate below: a
     * field-level `.default("TEST")` would have already applied by the time the
     * gate ran, so the gate could not tell a production boot that forgot the
     * variable from one that deliberately chose TEST. The default is applied
     * after the gate instead, so development and tests read `TEST` while a
     * production boot without an explicit choice refuses to start.
     *
     * WU-E's provider factory reads `process.env` directly, the same way the
     * secret store's factory does; this entry is the validated deployment
     * contract that makes the refusal happen at boot.
     */
    SIFEN_ENVIRONMENT: z.enum(["TEST", "PRODUCTION"]).optional(),
    /**
     * The directory holding the three official XSDs `prepareDteSchemas` fetched
     * (ADR-010 §2). Optional at boot on purpose: the document stage fails closed
     * per submission when the directory is absent, rather than refusing the
     * whole worker. The stage that reads it is WU-D2's; this entry is only the
     * validated deployment contract.
     */
    DTE_XSD_DIR: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.FISCAL_PROVIDER === undefined) {
      // Match the API gate: an absent provider in production would silently
      // select the fake. Explicit `fake` stays legitimate (the dedicated demo
      // tenant, docs/03-architecture/DEMO-TENANT.md); absence is the failure.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FISCAL_PROVIDER"],
        message: "FISCAL_PROVIDER is required in production.",
      });
    }

    if (env.NODE_ENV !== "production") {
      return;
    }

    // Match the API gate: production with branding assets enabled must never
    // silently fall back to process-local in-memory storage.
    if (env.BRANDING_ASSETS_ENABLED && (env.STORAGE_S3_BUCKET ?? "").trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_S3_BUCKET"],
        message:
          "STORAGE_S3_BUCKET is required when NODE_ENV=production and BRANDING_ASSETS_ENABLED=true.",
      });
    }

    // Tenant signing material must live in an encrypted column, never in
    // process memory. Without a master key the secret boundary silently selects
    // the in-memory driver, so a production process would accept signing
    // material it cannot persist or decrypt across restarts.
    if ((env.SECRET_STORE_MASTER_KEYS ?? "").trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECRET_STORE_MASTER_KEYS"],
        message: "SECRET_STORE_MASTER_KEYS is required in production.",
      });
    }

    // A production worker that omitted the environment would silently talk to
    // the DNIT test host with a production certificate. Explicit `TEST` stays
    // legitimate (homologation deployments exist); absence is the failure.
    if (env.SIFEN_ENVIRONMENT === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SIFEN_ENVIRONMENT"],
        message: "SIFEN_ENVIRONMENT is required in production.",
      });
    }
  })
  .transform((env) => ({
    ...env,
    SIFEN_ENVIRONMENT: env.SIFEN_ENVIRONMENT ?? "TEST",
  }));
