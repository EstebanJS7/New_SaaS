import { z } from "zod";
import { preflight, formatPreflightResult } from "./index.js";

export const preflightEnvSchema = z.object({
  PREFLIGHT_HOST: z.string().min(1).default("127.0.0.1"),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
});

export function parsePreflightEnv(input: NodeJS.ProcessEnv) {
  return preflightEnvSchema.parse(input);
}

async function main(): Promise<void> {
  let env: ReturnType<typeof parsePreflightEnv>;
  try {
    env = parsePreflightEnv(process.env);
  } catch (error) {
    console.error("Preflight environment validation failed.");
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }

  const result = await preflight({
    postgresHost: env.PREFLIGHT_HOST,
    postgresPort: env.POSTGRES_PORT,
    redisHost: env.PREFLIGHT_HOST,
    redisPort: env.REDIS_PORT,
  });

  console.info(formatPreflightResult(result));

  if (!result.postgres.reachable || !result.redis.reachable) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
