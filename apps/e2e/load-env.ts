import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Fills the lane's environment from the repository's `.env`, **without overriding anything already set**.
 *
 * The lane needs the same connection strings every other command in this repository uses, and `.env` is
 * where this repository keeps them — including the NON-DEFAULT host ports its `docker-compose.yml`
 * maps (PostgreSQL on 5433, Redis on 6380), which a lane that assumed the defaults would fail to reach
 * for reasons that have nothing to do with the product.
 *
 * CI has no `.env` (it is gitignored) and provides these as job env instead, so this is a no-op there.
 * An explicitly exported variable always wins, which is what makes a one-off `DATABASE_URL=... pnpm e2e`
 * behave the way it looks like it should.
 */
export function loadRepoEnv(): void {
  const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match === null) continue;
    const key = match[1];
    const raw = match[2];
    if (key === undefined || raw === undefined || process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
