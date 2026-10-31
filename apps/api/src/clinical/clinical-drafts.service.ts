import { Inject, Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { ClinicalServiceBase } from "./clinical.service.base.js";
import { ClinicalRecordsService } from "./clinical.records.service.js";
import { parseClinicalInput } from "./clinical.zod.js";
import {
  clinicalDraftCopy,
  saveClinicalDraft,
  searchClinicalDraft,
  submitClinicalDraft,
  closeClinicalDraft,
  creationCommands,
  correctionCommands,
  type ClinicalDraftCopy,
} from "./clinical-drafts.schema.js";

interface DraftRow {
  id: string;
  kind: ClinicalDraftCopy["kind"];
  state: "ACTIVE" | "PENDING" | "COMPLETED" | "DISCARDED";
  version: number;
  payload: unknown;
  command: unknown;
  updated_at: Date;
}
interface Scope {
  tenant: string;
  patient: string;
  author: string;
}
const conflict = () => new DomainError("CONFLICT", "Clinical draft changed or cannot be resent.");
type Tx = Prisma.TransactionClient;

/** Veterinary working copies only. No browser persistence, background purge or generic draft framework. */
@Injectable()
export class ClinicalDraftsService extends ClinicalServiceBase<PrismaService> {
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(RequestContextService) context: RequestContextService,
    @Inject(EntitlementsService) entitlements: EntitlementsService,
    @Inject(PermissionResolver) permissions: PermissionResolver,
    @Inject(AuditWriter) audit: AuditWriter,
    @Inject(ClinicalRecordsService) private readonly records: ClinicalRecordsService
  ) {
    super(prisma, context, entitlements, permissions, audit);
  }
  private async scope(patient: string): Promise<Scope> {
    const tenant = await this.requireTenantContext();
    await this.requirePermission("vet.clinical.read");
    await this.assertPatient(tenant, patient);
    return { tenant, patient, author: this.requestContext.requireUserProfileId() };
  }
  private async authorize(s: Scope, copy: ClinicalDraftCopy) {
    await this.requirePermission(copy.initial ? "vet.clinical.update" : "vet.clinical.create");
    if (copy.initial) {
      const table = {
        treatment: "clinical_treatment",
        study: "clinical_study",
        weight: "clinical_weight",
      }[copy.kind];
      const rows = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id=${copy.initial.id}::uuid AND tenant_id=${s.tenant}::uuid AND patient_id=${s.patient}::uuid`
      );
      if (!rows[0]) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
    } else if (!copy.fields.creation)
      throw new DomainError("VALIDATION_FAILED", "A creation key is required.");
    else if (copy.fields.creation.savedId)
      throw new DomainError("VALIDATION_FAILED", "Confirmed IDs are server-owned.");
  }
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text,24))::text`
    );
  }
  private async row(tx: Pick<Tx, "$queryRaw">, s: Scope, id: string) {
    const rows = await tx.$queryRaw<DraftRow[]>(
      Prisma.sql`SELECT id,kind,state,version,payload,command,updated_at FROM clinical_working_draft WHERE id=${id}::uuid AND tenant_id=${s.tenant}::uuid AND patient_id=${s.patient}::uuid AND author_id=${s.author}::uuid`
    );
    return rows[0];
  }
  private copy(row: DraftRow) {
    return parseClinicalInput(clinicalDraftCopy, row.payload, "Invalid clinical draft.");
  }
  private async same(tx: Tx, a: unknown, b: unknown) {
    const rows = await tx.$queryRaw<{ same: boolean }[]>(
      Prisma.sql`SELECT ${JSON.stringify(a)}::jsonb = ${JSON.stringify(b)}::jsonb AS same`
    );
    return rows[0]?.same === true;
  }
  private async auditDraft(tx: Tx, s: Scope, id: string, action: string) {
    await this.audit.append(
      {
        tenantId: s.tenant,
        actorUserProfileId: s.author,
        action: "clinical_working_draft." + action,
        targetType: "clinical_working_draft",
        targetId: id,
        metadata: { patientId: s.patient },
      },
      tx as unknown as AuditAppendTx
    );
  }
  private async dto(row: DraftRow, s: Scope) {
    const copy = this.copy(row);
    let confirmedId: string | null = null;
    if (!copy.initial && row.state !== "ACTIVE" && copy.fields.creation) {
      const receipts = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT response->>'id' AS id FROM clinical_creation_receipt WHERE tenant_id=${s.tenant}::uuid AND patient_id=${s.patient}::uuid AND kind=${copy.kind} AND key=${copy.fields.creation.key}::uuid`
      );
      confirmedId = receipts[0]?.id ?? null;
    }
    return {
      id: row.id,
      version: row.version,
      state: row.state,
      copy,
      command: row.command,
      confirmedId,
      updatedAt: row.updated_at.toISOString(),
    };
  }
  async search(patient: string, input: unknown) {
    const s = await this.scope(patient),
      query = parseClinicalInput(searchClinicalDraft, input, "Invalid draft search.");
    const keys = await this.permissionResolver.resolveForActiveRequest();
    const rows = await this.prisma.$queryRaw<
      DraftRow[]
    >(Prisma.sql`SELECT id,kind,state,version,payload,command,updated_at FROM clinical_working_draft WHERE tenant_id=${s.tenant}::uuid AND patient_id=${s.patient}::uuid AND author_id=${s.author}::uuid AND kind=${query.kind} AND state IN ('ACTIVE','PENDING')
      AND ((payload ? 'initial' AND ${keys.has("vet.clinical.update")}) OR (NOT (payload ? 'initial') AND ${keys.has("vet.clinical.create")}))
      ${query.before ? Prisma.sql`AND id < ${query.before}::uuid` : Prisma.empty} ORDER BY id DESC LIMIT 21`);
    return {
      items: await Promise.all(rows.slice(0, 20).map((row) => this.dto(row, s))),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  async get(patient: string, id: string) {
    const s = await this.scope(patient),
      row = await this.row(this.prisma, s, id);
    if (!row) throw new DomainError("NOT_FOUND", "Clinical draft was not found.");
    await this.authorize(s, this.copy(row));
    return this.dto(row, s);
  }
  async save(patient: string, id: string, input: unknown) {
    const s = await this.scope(patient),
      body = parseClinicalInput(saveClinicalDraft, input, "Invalid clinical draft.");
    await this.authorize(s, body.copy);
    if (
      body.copy.fields.creation?.command !== undefined ||
      (body.copy.initial && body.copy.fields.creation)
    )
      throw new DomainError(
        "VALIDATION_FAILED",
        "An existing attempt cannot become an unsent draft."
      );
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const row = await this.row(tx, s, id);
      if (!row) {
        if (body.version !== 0) throw new DomainError("NOT_FOUND", "Clinical draft was not found.");
        const inserted = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`INSERT INTO clinical_working_draft(id,tenant_id,patient_id,author_id,kind,payload) VALUES(${id}::uuid,${s.tenant}::uuid,${s.patient}::uuid,${s.author}::uuid,${body.copy.kind},${JSON.stringify(body.copy)}::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`
        );
        if (!inserted[0]) throw new DomainError("NOT_FOUND", "Clinical draft was not found.");
      } else {
        if (row.state !== "ACTIVE" || row.kind !== body.copy.kind) throw conflict();
        const old = this.copy(row);
        if (
          !(await this.same(tx, old.initial ?? null, body.copy.initial ?? null)) ||
          old.fields.creation?.key !== body.copy.fields.creation?.key
        )
          throw conflict();
        if (row.version === body.version + 1 && (await this.same(tx, row.payload, body.copy)))
          return;
        if (row.version !== body.version) throw conflict();
        await tx.$executeRaw(
          Prisma.sql`UPDATE clinical_working_draft SET payload=${JSON.stringify(body.copy)}::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`
        );
      }
      await this.auditDraft(tx, s, id, "saved");
    });
    return this.get(patient, id);
  }
  async discard(patient: string, id: string, input: unknown) {
    const s = await this.scope(patient),
      body = parseClinicalInput(closeClinicalDraft, input, "Invalid draft version.");
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const row = await this.row(tx, s, id);
      if (!row) throw new DomainError("NOT_FOUND", "Clinical draft was not found.");
      await this.authorize(s, this.copy(row));
      if (row.state === "DISCARDED" && row.version === body.version + 1) return;
      if (row.version !== body.version || !["ACTIVE", "PENDING"].includes(row.state))
        throw conflict();
      await tx.$executeRaw(
        Prisma.sql`UPDATE clinical_working_draft SET state='DISCARDED',version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`
      );
      await this.auditDraft(tx, s, id, "discarded");
    });
    return { discarded: true };
  }
  async submit(patient: string, id: string, input: unknown) {
    const s = await this.scope(patient),
      body = parseClinicalInput(submitClinicalDraft, input, "Invalid draft submission.");
    const attempt = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const row = await this.row(tx, s, id);
      if (!row) throw new DomainError("NOT_FOUND", "Clinical draft was not found.");
      const copy = this.copy(row);
      await this.authorize(s, copy);
      const parsed = (
        copy.initial ? correctionCommands[copy.kind] : creationCommands[copy.kind]
      ).safeParse(body.command);
      if (!parsed.success) throw new DomainError("VALIDATION_FAILED", "Invalid clinical command.");
      const command = parsed.data;
      if (
        copy.initial
          ? !("expectedVersion" in command) || command.expectedVersion !== copy.initial.version
          : !("idempotencyKey" in command) || command.idempotencyKey !== copy.fields.creation?.key
      )
        throw conflict();
      if (row.state !== "ACTIVE") {
        if (
          copy.initial ||
          row.state === "DISCARDED" ||
          row.version !== body.version + (row.state === "COMPLETED" ? 2 : 1) ||
          !(await this.same(tx, row.command, command))
        )
          throw conflict();
        return { copy, command };
      }
      if (row.version !== body.version) throw conflict();
      await tx.$executeRaw(
        Prisma.sql`UPDATE clinical_working_draft SET state='PENDING',command=${JSON.stringify(command)}::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`
      );
      await this.auditDraft(tx, s, id, "submitted");
      return { copy, command };
    });
    // Durable PENDING is committed before clinical dispatch. A crash leaves a conservative
    // correction block; creation can retry only its frozen idempotent command.
    const { copy, command } = attempt;
    let result: { id: string };
    if (copy.initial) {
      if (copy.kind === "treatment")
        result = await this.records.updateTreatment(
          patient,
          copy.initial.id,
          parseClinicalInput(correctionCommands.treatment, command, "Invalid command.")
        );
      else if (copy.kind === "study")
        result = await this.records.updateStudy(
          patient,
          copy.initial.id,
          parseClinicalInput(correctionCommands.study, command, "Invalid command.")
        );
      else
        result = await this.records.updateWeight(
          patient,
          copy.initial.id,
          parseClinicalInput(correctionCommands.weight, command, "Invalid command.")
        );
    } else {
      if (copy.kind === "treatment") {
        const c = parseClinicalInput(creationCommands.treatment, command, "Invalid command.");
        result = await this.records.createTreatment(patient, c, c.idempotencyKey);
      } else if (copy.kind === "study") {
        const c = parseClinicalInput(creationCommands.study, command, "Invalid command.");
        result = await this.records.createStudy(patient, c, c.idempotencyKey);
      } else {
        const c = parseClinicalInput(creationCommands.weight, command, "Invalid command.");
        result = await this.records.createWeight(patient, c, c.idempotencyKey);
      }
    }
    return result;
  }
  async complete(patient: string, id: string, input: unknown) {
    const s = await this.scope(patient),
      body = parseClinicalInput(closeClinicalDraft, input, "Invalid draft version.");
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const row = await this.row(tx, s, id);
      if (!row) throw new DomainError("NOT_FOUND", "Clinical draft was not found.");
      await this.authorize(s, this.copy(row));
      if (row.state === "COMPLETED" && row.version === body.version + 1) return;
      if (row.state !== "PENDING" || row.version !== body.version) throw conflict();
      await tx.$executeRaw(
        Prisma.sql`UPDATE clinical_working_draft SET state='COMPLETED',version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`
      );
      await this.auditDraft(tx, s, id, "completed");
    });
    return { completed: true };
  }
}
