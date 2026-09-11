import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { appendAuditLog, type AuditAppendInput, type AuditLogDelegate } from "./audit-log.js";

/**
 * Structural fake of the append-only delegate — intentionally exposes no
 * update/delete method, mirroring the real boundary's mutation-free surface.
 */
function makeFakeAuditLog() {
  const rows = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const delegate: AuditLogDelegate & { rows: typeof rows } = {
    create: ({ data }) => {
      sequence += 1;
      const id = `audit-${sequence}`;
      rows.set(id, { id, ...data });
      return Promise.resolve({ id });
    },
    rows,
  };

  return delegate;
}

describe("appendAuditLog (shared append-only primitive)", () => {
  it("derives SYSTEM without attribution and STAFF with it", async () => {
    const auditLog = makeFakeAuditLog();
    const tx = { auditLog };

    await appendAuditLog(tx, { action: "a.b" });
    await appendAuditLog(tx, {
      action: "a.c",
      actorUserProfileId: "22222222-2222-4222-8222-222222222222",
    });

    const byAction = new Map([...auditLog.rows.values()].map((row) => [row.action, row]));
    expect(byAction.get("a.b")?.actorType).toBe("SYSTEM");
    expect(byAction.get("a.c")?.actorType).toBe("STAFF");
  });

  it("accepts a three-segment domain.event action (positive validation coverage)", async () => {
    const auditLog = makeFakeAuditLog();

    await appendAuditLog({ auditLog }, { action: "branding.reset.storage_retired" });

    const rows = [...auditLog.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("branding.reset.storage_retired");
  });

  it("attaches requestId when supplied and omits it for out-of-request writers", async () => {
    const auditLog = makeFakeAuditLog();
    const tx = { auditLog };

    await appendAuditLog(tx, { action: "job.ran" }, "req-1");
    await appendAuditLog(tx, { action: "job.ran" });

    const rows = [...auditLog.rows.values()];
    expect(rows[0]?.requestId).toBe("req-1");
    expect(rows[1]?.requestId).toBeUndefined();
  });

  it("defaults metadata to an empty jsonb object", async () => {
    const auditLog = makeFakeAuditLog();
    await appendAuditLog({ auditLog }, { action: "a.b" });
    expect([...auditLog.rows.values()][0]?.metadata).toEqual({});
  });

  it("rejects malformed actions, ids and metadata loudly without writing", async () => {
    const auditLog = makeFakeAuditLog();
    const tx = { auditLog };
    const invalidInputs: AuditAppendInput[] = [
      { action: "no-separator" },
      { action: "UPPER.event" },
      { action: "a.b", tenantId: "not-a-uuid" },
    ];

    for (const bad of invalidInputs) {
      await expect(appendAuditLog(tx, bad)).rejects.toBeInstanceOf(DomainError);
    }
    expect(auditLog.rows.size).toBe(0);
  });
});
