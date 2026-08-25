import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import {
  AuditWriter,
  type AuditAppendInput,
  type AuditLogDelegate,
} from "./audit-writer.service.js";

/**
 * Structural fake of the append-only delegate. There is deliberately NO
 * update/delete method here either — the boundary under test cannot express
 * one.
 */
function makeFakeAuditLog() {
  const rows = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const delegate: AuditLogDelegate & { rows: typeof rows } = {
    // Sync body (eslint require-await): awaiting a plain value keeps the
    // runtime contract identical to the real async delegate.
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

/** Boots a writer inside an explicit request scope and hands back captures. */
function makeWriter(input?: { requestId?: string }) {
  const auditLog = makeFakeAuditLog();
  const context = new RequestContextService();
  // DI is token-based (@Inject(PrismaService)), so the narrow fake plugs in
  // directly — no boundary cast needed.
  const writer = new AuditWriter({ auditLog }, context);
  const requestId = input?.requestId ?? "req-audit-unit";
  return { writer, context, requestId, rows: auditLog.rows };
}

describe("AuditWriter (design D9 append-only boundary)", () => {
  it("exposes append() as the ONLY public method (runtime enumeration)", () => {
    const methods = Object.getOwnPropertyNames(AuditWriter.prototype).filter(
      (name) => name !== "constructor"
    );
    expect(methods).toEqual(["append"]);
  });

  it("has no mutation-path keys at the type level", () => {
    // Compile-time assertion: anything besides "append" would fail to typecheck.
    type PublicSurface = keyof AuditWriter;
    const _assertAppendOnly: Exclude<PublicSurface, "append"> extends never ? true : never = true;
    expect(_assertAppendOnly).toBe(true);
  });

  it("writes the row exactly as appended and reads back identical values", async () => {
    const { writer, context, requestId, rows } = makeWriter();

    await context.run(requestId, async () => {
      await writer.append({
        action: "auth.login_succeeded",
        tenantId: "11111111-1111-4111-8111-111111111111",
        actorUserProfileId: "22222222-2222-4222-8222-222222222222",
        targetType: "user_profile",
        targetId: "22222222-2222-4222-8222-222222222222",
        metadata: { email: "owner@clinic.test" },
      });
    });

    expect(rows.size).toBe(1);
    const row = [...rows.values()][0];
    expect(row.action).toBe("auth.login_succeeded");
    expect(row.actorType).toBe("STAFF");
    expect(row.tenantId).toBe("11111111-1111-4111-8111-111111111111");
    expect(row.actorUserProfileId).toBe("22222222-2222-4222-8222-222222222222");
    expect(row.targetType).toBe("user_profile");
    expect(row.metadata).toEqual({ email: "owner@clinic.test" });
    expect(row.requestId).toBe(requestId);
  });

  it("fills requestId from RequestContextService — callers cannot spoof it", async () => {
    const { writer, context, requestId, rows } = makeWriter();
    const hostile = { action: "x.y", requestId: "forged" } as unknown as AuditAppendInput;

    await context.run(requestId, async () => {
      await writer.append(hostile);
    });

    expect([...rows.values()][0].requestId).toBe(requestId);
  });

  it("derives actor_type: STAFF with attribution, SYSTEM without", async () => {
    const { writer, context, rows } = makeWriter();

    await context.run("r1", async () => {
      await writer.append({
        action: "a.b",
        actorUserProfileId: "22222222-2222-4222-8222-222222222222",
      });
      await writer.append({ action: "a.c" });
      // Explicit actorType always wins over derivation.
      await writer.append({
        action: "a.d",
        actorType: "SYSTEM",
        actorUserProfileId: "22222222-2222-4222-8222-222222222222",
      });
    });

    const byAction = new Map([...rows.values()].map((row) => [row.action, row]));
    expect(byAction.get("a.b")?.actorType).toBe("STAFF");
    expect(byAction.get("a.c")?.actorType).toBe("SYSTEM");
    expect(byAction.get("a.d")?.actorType).toBe("SYSTEM");
  });

  it("defaults metadata to an empty jsonb object", async () => {
    const { writer, context, rows } = makeWriter();
    await context.run("r", async () => {
      await writer.append({ action: "a.b" });
    });
    expect([...rows.values()][0].metadata).toEqual({});
  });

  it("rejects malformed actions, ids and metadata shapes loudly", async () => {
    const { writer, context, rows } = makeWriter();
    const invalidInputs: AuditAppendInput[] = [
      { action: "no-separator" },
      { action: "UPPER.event" },
      { action: "a.b", tenantId: "not-a-uuid" },
      { action: "a.b", actorUserProfileId: "also-not-a-uuid" },
    ];
    const badMetadata = { action: "a.b" } as unknown as AuditAppendInput;
    (badMetadata as unknown as { metadata: unknown }).metadata = "not-an-object";
    invalidInputs.push(badMetadata);

    for (const bad of invalidInputs) {
      await expect(context.run("r", () => writer.append(bad))).rejects.toBeInstanceOf(DomainError);
    }
    // Nothing was written by rejected appends.
    expect(rows.size).toBe(0);
  });
});
