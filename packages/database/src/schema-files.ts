import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root, resolved independently of the vitest working directory. */
const PACKAGE_ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

/**
 * Loads the Prisma schema document. Tests parse this text plus the migration
 * SQL instead of requiring a live database — CI applies these exact files, so
 * they are the authoritative persistence surface.
 */
export function loadPrismaSchema(): string {
  return readFileSync(join(PACKAGE_ROOT, "prisma", "schema.prisma"), "utf8");
}

/**
 * Returns migration folders ordered by their timestamp-prefixed name, exactly
 * the order `prisma migrate deploy` applies them in.
 */
export function loadMigrations(): MigrationFile[] {
  const dir = join(PACKAGE_ROOT, "prisma", "migrations");

  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry): entry is typeof entry & { name: string } =>
        entry.isDirectory() && /^\d{14}_/.test(entry.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(join(dir, entry.name, "migration.sql"), "utf8"),
    }));
}

export function findMigration(migrations: MigrationFile[], suffix: string): MigrationFile {
  const found = migrations.find((migration) => migration.name.endsWith(suffix));
  if (!found) {
    throw new Error(
      `Expected migration named *${suffix}, got: ${migrations.map((m) => m.name).join(", ")}`
    );
  }

  return found;
}
