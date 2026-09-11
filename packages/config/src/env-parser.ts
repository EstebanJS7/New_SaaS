import { z, ZodError, ZodTypeAny } from "zod";

export type EnvParseResult<T> =
  { success: true; env: T } | { success: false; error: string; missing: string[] };

/**
 * Parses process env with a Zod schema and returns a structured result.
 *
 * Accepts any Zod schema, including an object refined with `superRefine`
 * (a `ZodEffects`), so callers can add cross-field validation such as
 * environment-dependent production gates.
 *
 * On failure the error message names every missing or invalid variable so
 * operators can fix the environment quickly.
 */
export function createEnvParser<S extends ZodTypeAny>(schema: S) {
  return (input: NodeJS.ProcessEnv): EnvParseResult<z.infer<S>> => {
    // `safeParse` on the `ZodTypeAny` constraint widens to `any`; the schema's
    // own output type is recovered here so callers keep a strongly typed env.
    const result = schema.safeParse(input) as z.SafeParseReturnType<NodeJS.ProcessEnv, z.infer<S>>;
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
