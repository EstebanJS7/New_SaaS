import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Parses a minimal .env file and returns entries that are not already present
 * in the current process environment.
 *
 * Parent-process environment variables take precedence over .env values, which
 * matches the behavior expected in CI and test runs.
 */
function applyEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    // Strip surrounding quotes added for values containing spaces.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Loads the repository root .env file from a workspace app/package.
 *
 * Expected CWD is the app/package root (e.g. apps/api), so the root .env is
 * two directories up. The load is a no-op if the file is missing, keeping dev
 * scripts safe on clean checkouts before .env is created from .env.example.
 */
export function loadRootEnv() {
  if (process.env.NEWSAAS_SKIP_ENV_LOAD === "true") {
    return;
  }

  const envPath = resolve(process.cwd(), "../../.env");
  applyEnvFile(envPath);
}
