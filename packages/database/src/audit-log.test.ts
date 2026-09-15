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

  it("derives PORTAL from a portal access actor and records the actor id", async () => {
    const auditLog = makeFakeAuditLog();

    await appendAuditLog(
      { auditLog },
      {
        action: "portal.profile.updated",
        tenantId: "11111111-1111-4111-8111-111111111111",
        actorPortalAccessId: "33333333-3333-4333-8333-333333333333",
      }
    );

    const row = [...auditLog.rows.values()][0];
    expect(row.actorType).toBe("PORTAL");
    expect(row.actorPortalAccessId).toBe("33333333-3333-4333-8333-333333333333");
    // Portal attribution never sets a staff profile.
    expect(row.actorUserProfileId).toBeUndefined();
  });

  it("rejects an unattributed explicit PORTAL actor type and a malformed portal id", async () => {
    const auditLog = makeFakeAuditLog();

    await expect(
      appendAuditLog({ auditLog }, { action: "portal.booking.requested", actorType: "PORTAL" })
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      appendAuditLog(
        { auditLog },
        { action: "portal.booking.requested", actorPortalAccessId: "not-a-uuid" }
      )
    ).rejects.toBeInstanceOf(DomainError);
    expect(auditLog.rows.size).toBe(0);
  });

  describe("portal attribution invariant", () => {
    const PORTAL_ACCESS_ID = "33333333-3333-4333-8333-333333333333";
    const STAFF_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

    it("accepts an explicit PORTAL actor type paired with a portal access id", async () => {
      const auditLog = makeFakeAuditLog();

      await appendAuditLog(
        { auditLog },
        {
          action: "portal.booking.requested",
          actorType: "PORTAL",
          actorPortalAccessId: PORTAL_ACCESS_ID,
        }
      );

      const row = [...auditLog.rows.values()][0];
      expect(row.actorType).toBe("PORTAL");
      expect(row.actorPortalAccessId).toBe(PORTAL_ACCESS_ID);
      expect(row.actorUserProfileId).toBeUndefined();
    });

    it("rejects PORTAL without a portal access id and writes nothing", async () => {
      const auditLog = makeFakeAuditLog();
      const tx = { auditLog };

      await expect(
        appendAuditLog(tx, {
          action: "portal.profile.updated",
          tenantId: "11111111-1111-4111-8111-111111111111",
          actorType: "PORTAL",
        })
      ).rejects.toBeInstanceOf(DomainError);
      expect(auditLog.rows.size).toBe(0);
    });

    it("rejects PORTAL carrying a staff actor even with a portal access id", async () => {
      const auditLog = makeFakeAuditLog();
      const tx = { auditLog };

      await expect(
        appendAuditLog(tx, {
          action: "portal.booking.approved",
          tenantId: "11111111-1111-4111-8111-111111111111",
          actorType: "PORTAL",
          actorPortalAccessId: PORTAL_ACCESS_ID,
          actorUserProfileId: STAFF_PROFILE_ID,
        })
      ).rejects.toBeInstanceOf(DomainError);
      expect(auditLog.rows.size).toBe(0);
    });

    it("rejects an ambiguous portal id plus staff id without an explicit actor type", async () => {
      const auditLog = makeFakeAuditLog();
      const tx = { auditLog };

      await expect(
        appendAuditLog(tx, {
          action: "portal.booking.requested",
          tenantId: "11111111-1111-4111-8111-111111111111",
          actorPortalAccessId: PORTAL_ACCESS_ID,
          actorUserProfileId: STAFF_PROFILE_ID,
        })
      ).rejects.toBeInstanceOf(DomainError);
      expect(auditLog.rows.size).toBe(0);
    });

    it("rejects non-PORTAL actors carrying a portal access id and writes nothing", async () => {
      const auditLog = makeFakeAuditLog();
      const tx = { auditLog };

      for (const actorType of ["STAFF", "SYSTEM"] as const) {
        await expect(
          appendAuditLog(tx, {
            action: "portal.booking.approved",
            tenantId: "11111111-1111-4111-8111-111111111111",
            actorType,
            actorPortalAccessId: PORTAL_ACCESS_ID,
            ...(actorType === "STAFF" && { actorUserProfileId: STAFF_PROFILE_ID }),
          })
        ).rejects.toBeInstanceOf(DomainError);
      }
      expect(auditLog.rows.size).toBe(0);
    });
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
