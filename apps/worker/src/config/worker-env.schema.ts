import { z } from "zod";

/**
 * Environment variables required by the worker at startup.
 *
 * The worker does not serve branding assets, but it parses the same branding
 * asset flag and object-storage bucket as the API so both deployables share one
 * production configuration contract. When branding assets are enabled in
 * production the bucket is mandatory; otherwise the optional in-memory fallback
 * remains available for local development and tests.
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
  })
  .superRefine((env, ctx) => {
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
  });
