import { z } from "zod";

/**
 * Environment variables required by the API at startup.
 */
export const apiEnvSchema = z.object({
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
});
