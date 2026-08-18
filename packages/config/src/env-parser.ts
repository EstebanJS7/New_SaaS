import { z, ZodError, ZodTypeAny } from "zod";

export type EnvParseResult<T> =
  { success: true; env: T } | { success: false; error: string; missing: string[] };

/**
 * Parses process env with a Zod schema and returns a structured result.
 *
 * On failure the error message names every missing or invalid variable so
 * operators can fix the environment quickly.
 */
export function createEnvParser<T extends Record<string, ZodTypeAny>>(schema: z.ZodObject<T>) {
  return (input: NodeJS.ProcessEnv): EnvParseResult<z.infer<typeof schema>> => {
    const result = schema.safeParse(input);
    if (result.success) {
      return { success: true, env: result.data };
    }

    const missing = collectMissingKeys(result.error);
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    return {
      success: false,
      error: `Environment validation failed: ${formatted}`,
      missing,
    };
  };
}

function collectMissingKeys(error: ZodError): string[] {
  return error.issues
    .filter((issue) => issue.message.toLowerCase().includes("required"))
    .map((issue) => issue.path.join("."));
}
