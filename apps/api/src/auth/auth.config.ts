import { z } from "zod";

/**
 * Auth-scoped configuration (design D4).
 *
 * Parsed through its own tolerant schema instead of the bootstrap
 * `apiEnvSchema`: auth settings carry OWASP-floor defaults, must stay
 * overridable per environment, and unit/integration tests boot these services
 * without the full infrastructure env (DATABASE_URL/REDIS_URL). Unknown keys
 * are stripped by zod; invalid values fail fast at first use.
 */
const authEnvSchema = z.object({
  ARGON_MEMORY_COST: z.coerce.number().int().min(1024).default(19456),
  ARGON_TIME_COST: z.coerce.number().int().min(1).default(2),
  ARGON_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  /** Rolling idle TTL in seconds (design D4: 2h default). */
  SESSION_IDLE_TTL: z.coerce.number().int().min(60).default(7200),
  /** Absolute TTL in seconds (design D4: 12h default). */
  SESSION_ABSOLUTE_TTL: z.coerce.number().int().min(300).default(43200),
});

export interface AuthConfig {
  argonMemoryCost: number;
  argonTimeCost: number;
  argonParallelism: number;
  sessionIdleTtlSeconds: number;
  sessionAbsoluteTtlSeconds: number;
  /**
   * Cookie `Secure` flag (design D4): ON unless development. Any non-development
   * environment — production, staging, QA, test, or an unset NODE_ENV — gets
   * the secure-by-default posture; only local development serves plain HTTP.
   * Plain-HTTP test harnesses opt out explicitly via config override.
   */
  cookieSecure: boolean;
}

/** DI token carrying {@link AuthConfig}; override in tests for determinism. */
export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

/** Validates and maps the auth-related environment variables. */
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = authEnvSchema.parse(env);
  return {
    argonMemoryCost: parsed.ARGON_MEMORY_COST,
    argonTimeCost: parsed.ARGON_TIME_COST,
    argonParallelism: parsed.ARGON_PARALLELISM,
    sessionIdleTtlSeconds: parsed.SESSION_IDLE_TTL,
    sessionAbsoluteTtlSeconds: parsed.SESSION_ABSOLUTE_TTL,
    // Secure unless development (design D4): fail-safe default — an unset or
    // exotic NODE_ENV must never downgrade the transport baseline.
    cookieSecure: env.NODE_ENV !== "development",
  };
}
