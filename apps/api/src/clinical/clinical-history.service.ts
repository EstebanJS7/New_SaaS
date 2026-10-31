import { Inject, Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { ClinicalServiceBase, type ClinicalBasePrisma } from "./clinical.service.base.js";

export const historyKind = z.enum(["treatments", "studies", "weights"]);
export type HistoryKind = z.infer<typeof historyKind>;
export const historySearch = z
  .object({ beforeVersion: z.number().int().min(1).max(2147483647).optional() })
  .strict();
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const snapshots = {
  treatments: z
    .object({ description: z.string(), administeredAt: instant, context: z.string().nullable() })
    .strict(),
  studies: z.object({ studyType: z.string(), performedAt: instant, result: z.string() }).strict(),
  weights: z
    .object({ quantity: z.string(), unit: z.literal("KG").nullable(), measuredAt: instant })
    .strict(),
};
interface HistoryPrisma extends ClinicalBasePrisma {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
}
interface RevisionRow {
  id: string;
  actor_display_name: string | null;
  correction_reason: string | null;
  created_at: Date;
  before_version: number;
  after_version: number;
  previous: unknown;
  current: unknown;
}
const columns = {
  treatments: [
    ["description", "description"],
    ["administeredAt", "administered_at"],
    ["context", "context"],
  ],
  studies: [
    ["studyType", "study_type"],
    ["performedAt", "performed_at"],
    ["result", "result"],
  ],
  weights: [
    ["quantity", "quantity"],
    ["unit", "unit"],
    ["measuredAt", "measured_at"],
  ],
} as const;

/** Specific Veterinary history; SQL identifiers come exclusively from closed server maps. */
@Injectable()
export class ClinicalHistoryService extends ClinicalServiceBase<HistoryPrisma> {
  constructor(
    @Inject(PrismaService) prisma: HistoryPrisma,
    @Inject(RequestContextService) context: RequestContextService,
    @Inject(EntitlementsService) entitlements: EntitlementsService,
    @Inject(PermissionResolver) permissions: PermissionResolver,
    @Inject(AuditWriter) audit: AuditWriter
  ) {
    super(prisma, context, entitlements, permissions, audit);
  }

  async access(patientId: string) {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission("vet.clinical.read");
    await this.assertPatient(tenantId, patientId);
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    return { allowed: permissions.has("vet.clinical.history_read") };
  }

  async search(
    patientId: string,
    id: string,
    kind: HistoryKind,
    input: z.infer<typeof historySearch>
  ) {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission("vet.clinical.read");
    await this.requirePermission("vet.clinical.history_read");
    await this.assertPatient(tenantId, patientId);
    if (!historyKind.safeParse(kind).success)
      throw new DomainError("VALIDATION_FAILED", "Invalid clinical history type.");
    const table = {
      treatments: "clinical_treatment",
      studies: "clinical_study",
      weights: "clinical_weight",
    }[kind];
    if (!table) throw new DomainError("VALIDATION_FAILED", "Invalid clinical history type.");
    const parsed = historySearch.safeParse(input);
    if (!parsed.success)
      throw new DomainError("VALIDATION_FAILED", "Invalid clinical history search.");
    const parent = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid AND patient_id=${patientId}::uuid`
    );
    if (!parent[0]) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
    const projection = (side: "before" | "after") =>
      Prisma.sql`jsonb_build_object(${Prisma.join(columns[kind].flatMap(([key, column]) => [Prisma.sql`${key}::text`, Prisma.raw(`${side}_${column}${column === "quantity" ? "::text" : ""}`)]))})`;
    const cursor = parsed.data.beforeVersion;
    const rows = await this.prisma.$queryRaw<
      RevisionRow[]
    >(Prisma.sql`SELECT id,actor_display_name,correction_reason,created_at,before_version,after_version,
      ${projection("before")} AS previous, ${projection("after")} AS current
      FROM ${Prisma.raw(table + "_revision")} WHERE tenant_id=${tenantId}::uuid AND patient_id=${patientId}::uuid AND record_id=${id}::uuid
      ${cursor === undefined ? Prisma.empty : Prisma.sql`AND after_version < ${cursor}`}
      ORDER BY after_version DESC LIMIT 21`);
    const items = rows.slice(0, 20).map((row) => {
      const before = snapshots[kind].safeParse(row.previous),
        after = snapshots[kind].safeParse(row.current);
      if (!before.success || !after.success) throw new Error("Invalid clinical history snapshot.");
      return {
        id: row.id,
        actorName: row.actor_display_name,
        reason: row.correction_reason,
        correctedAt: row.created_at.toISOString(),
        beforeVersion: row.before_version,
        afterVersion: row.after_version,
        before: before.data,
        after: after.data,
      };
    });
    return { items, nextCursor: rows.length > 20 ? items.at(-1)!.afterVersion : null };
  }
}
