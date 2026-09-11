import { z } from "zod";

/**
 * Non-production fallback for the branding asset signed-URL HMAC secret. It is
 * rejected by the production gate below so a deployed API can never sign asset
 * URLs with a value that is public in source control.
 */
export const DEV_INSECURE_BRANDING_ASSET_URL_SECRET = "dev-insecure-secret";

/**
 * Non-production fallback public origin used to build portal branding asset
 * URLs. The API serves the bytes, so the URL must be API-origin absolute; it
 * must never be a storage-provider URL.
 */
export const DEV_BRANDING_ASSET_PUBLIC_BASE_URL = "http://localhost:3001";

/** Minimum length required for the branding asset secret in production. */
export const PRODUCTION_BRANDING_ASSET_SECRET_MIN_LENGTH = 32;

/** Hosts that are not reachable from a public portal and are rejected in production. */
const LOCAL_BRANDING_ASSET_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
]);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Environment variables required by the API at startup.
 *
 * Branding asset delivery has non-production fallbacks so local development
 * and tests boot without extra configuration. The `superRefine` gate refuses
 * those fallbacks — and any short, localhost-pointing value — when
 * `NODE_ENV === "production"`, so operators fail fast at boot instead of
 * serving assets signed with an insecure secret or linked to a non-public
 * origin. When branding assets are enabled in production it also requires
 * `STORAGE_S3_BUCKET`, so the process cannot silently fall back to
 * process-local in-memory storage.
 */
export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    API_HOST: z.string().min(1).default("0.0.0.0"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    /**
     * CORS origin allowlist (transport baseline): comma-separated exact origins
     * (scheme+host+port). EMPTY default = same-origin only — every cross-origin
     * request is denied server-side (deny-by-default posture).
     */
    API_CORS_ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0)
      ),
    /**
     * Master kill-switch for the branding asset lifecycle (DEC-004 PR 1).
     * Defaults to off so the feature rolls out behind the `custom_branding`
     * entitlement without affecting existing tenants.
     */
    BRANDING_ASSETS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    /**
     * HMAC secret for API-local branding asset signed URLs (DEC-004 PR 1).
     * Production MUST override this with a stable, random secret. The default
     * exists only for local development and tests and is rejected by the
     * production gate below.
     */
    BRANDING_ASSET_URL_SECRET: z.string().min(1).default(DEV_INSECURE_BRANDING_ASSET_URL_SECRET),
    /**
     * Public API origin used to build absolute asset URLs for the
     * unauthenticated customer portal. Production MUST point at a public host;
     * the local default is accepted only outside production.
     */
    BRANDING_ASSET_PUBLIC_BASE_URL: z.string().url().default(DEV_BRANDING_ASSET_PUBLIC_BASE_URL),
    /**
     * Object-storage configuration for branding assets. Optional everywhere
     * except production with branding assets enabled, where the bucket is
     * mandatory so the API never silently falls back to process-local
     * in-memory storage. Credentials are resolved by the AWS SDK default chain,
     * never through this schema.
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

    if (
      env.BRANDING_ASSET_URL_SECRET === DEV_INSECURE_BRANDING_ASSET_URL_SECRET ||
      env.BRANDING_ASSET_URL_SECRET.length < PRODUCTION_BRANDING_ASSET_SECRET_MIN_LENGTH
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BRANDING_ASSET_URL_SECRET"],
        message: `BRANDING_ASSET_URL_SECRET must be a random secret of at least ${PRODUCTION_BRANDING_ASSET_SECRET_MIN_LENGTH} characters in production.`,
      });
    }

    const hostname = hostnameOf(env.BRANDING_ASSET_PUBLIC_BASE_URL);
    if (hostname === null || LOCAL_BRANDING_ASSET_HOSTS.has(hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BRANDING_ASSET_PUBLIC_BASE_URL"],
        message: "BRANDING_ASSET_PUBLIC_BASE_URL must be a public origin in production.",
      });
    }

    // Branding asset bytes must live in durable object storage in production.
    // Without a bucket the StorageModule silently selects the in-memory driver,
    // so a production process would accept uploads it cannot persist or serve
    // across restarts. Only gate when the feature is actually enabled; a
    // disabled feature keeps the local in-memory fallback.
    if (env.BRANDING_ASSETS_ENABLED && (env.STORAGE_S3_BUCKET ?? "").trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_S3_BUCKET"],
        message:
          "STORAGE_S3_BUCKET is required when NODE_ENV=production and BRANDING_ASSETS_ENABLED=true.",
      });
    }
  });
