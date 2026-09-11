export { PrismaModule } from "./prisma.module.js";
export { PrismaService } from "./prisma.service.js";

/**
 * Shared append-only audit primitive (design D9). The API's request-scoped
 * `AuditWriter` delegates here, and the worker calls it as SYSTEM — one
 * sanctioned writer path for `audit_log`, reachable from both deployables.
 */
export { appendAuditLog } from "./audit-log.js";
export type {
  AuditActorType,
  AuditAppendInput,
  AuditAppendedRow,
  AuditAppendTx,
  AuditLogDelegate,
} from "./audit-log.js";

/**
 * Prisma namespace utilities (sql/join/raw) re-exported for application code
 * that must build safe raw SQL (e.g. SELECT ... FOR UPDATE row locks). Keeps
 * `@prisma/client` a private implementation detail of THIS package so no other
 * workspace package needs a direct dependency on it.
 */
export { Prisma } from "./generated/index.js";

/**
 * Seed-owned reference catalogs (EPIC-02 design D3/D7): the permission
 * catalog and the six fixed roles are CODE-owned seed data. Exporting the
 * constants lets backend boundaries (RBAC administration validation, settings
 * union-sync tests) validate against the SAME source of truth the seed
 * writes — never a drift-prone local copy.
 */
export {
  BREED_SEEDS,
  FEATURE_CODE_PATTERN,
  FEATURE_CODE_SEEDS,
  PERMISSION_KEY_PATTERN,
  PERMISSION_SEEDS,
  ROLE_PERMISSION_MATRIX,
  ROLE_SEEDS,
  SPECIES_SEEDS,
  STARTER_PLAN_SEED,
  seedReferenceData,
  type PermissionKey,
  type RoleCode,
  type SpeciesCode,
} from "./reference-seed.js";
