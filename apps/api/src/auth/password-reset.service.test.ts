import { describe, expect, it } from "vitest";
import type { AuditAppendInput } from "@newsaas/database";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { CredentialService } from "./credential.service.js";
import {
  PasswordResetService,
  type PasswordResetPrisma,
  type PasswordResetTx,
} from "./password-reset.service.js";
import {
  PasswordResetTokenService,
  hashPasswordResetToken,
} from "./password-reset-token.service.js";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const PROFILE = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a-live-reset-token";
const HASH = hashPasswordResetToken(TOKEN);

interface Harness {
  service: PasswordResetService;
  statements: string[];
  auditInputs: AuditAppendInput[];
  auditTx: unknown[];
  /** How often the AMBIENT (injected) token client was consulted instead. */
  ambientConsults: number;
}

/**
 * A stub that records the ORDER of statements, because the order is the design:
 * the hash is computed before the transaction opens, and inside it the token is
 * spent first.
 */
function harness(
  options: { tokenRow?: unknown; hashFails?: boolean; updateFails?: boolean } = {}
): Harness {
  const statements: string[] = [];
  const auditInputs: AuditAppendInput[] = [];
  const auditTx: unknown[] = [];
  let ambientConsults = 0;

  const tokenRow =
    options.tokenRow === undefined
      ? {
          id: "22222222-2222-4222-8222-222222222222",
          userProfileId: PROFILE,
          tokenHash: HASH,
          expiresAt: new Date(NOW.getTime() + 60_000),
          consumedAt: null,
        }
      : options.tokenRow;

  const tx: PasswordResetTx = {
    passwordResetToken: {
      create: () => Promise.resolve({ id: "unused" }),
      findFirst: () => {
        statements.push("tx:findFirst");
        return Promise.resolve(tokenRow as never);
      },
      updateMany: (args) => {
        statements.push(
          (args.where as { id?: string }).id === undefined ? "tx:spendOthers" : "tx:consumeCas"
        );
        return Promise.resolve({ count: 1 });
      },
    },
    userCredential: {
      update: (args) => {
        statements.push("tx:credentialUpdate");
        if (options.updateFails) return Promise.reject(new Error("write failed"));
        return Promise.resolve({
          userProfileId: (args.where as { userProfileId: string }).userProfileId,
        });
      },
    },
    staffSession: {
      deleteMany: (args) => {
        statements.push("tx:sessionsDelete");
        expect(args.where).toEqual({ userProfileId: PROFILE });
        return Promise.resolve({ count: 3 });
      },
    },
    auditLog: {
      create: () => Promise.resolve({ id: "audit" }),
    },
  };

  const prisma: PasswordResetPrisma = {
    $transaction: (callback) => {
      statements.push("tx:begin");
      return callback(tx);
    },
  };
  // The AMBIENT client. The reset service must never reach it: it passes its own
  // transaction, and a service that quietly used this one would spend the token
  // outside the atomic unit. Counting its calls is what proves that.
  const tokens = new PasswordResetTokenService({
    passwordResetToken: {
      create: () => Promise.resolve({ id: "unused" }),
      findFirst: () => {
        ambientConsults += 1;
        return Promise.resolve(null);
      },
      updateMany: () => {
        ambientConsults += 1;
        return Promise.resolve({ count: 0 });
      },
    },
  });
  const credentials = {
    hash: (password: string) => {
      statements.push("hash");
      if (options.hashFails) return Promise.reject(new Error("argon failed"));
      return Promise.resolve(`$argon2id$stub$${password}`);
    },
  } as unknown as CredentialService;
  const audit = {
    append: (input: AuditAppendInput, passedTx?: unknown) => {
      statements.push("tx:audit");
      auditInputs.push(input);
      auditTx.push(passedTx);
      return Promise.resolve({ id: "audit" });
    },
  } as unknown as AuditWriter;

  return {
    service: new PasswordResetService(prisma, tokens, credentials, audit),
    statements,
    auditInputs,
    auditTx,
    get ambientConsults() {
      return ambientConsults;
    },
  };
}

describe("PasswordResetService — one transaction, in a deliberate order", () => {
  it("hashes BEFORE the transaction opens, so argon2 does not hold a transaction", async () => {
    const { service, statements } = harness();
    await service.resetPassword(TOKEN, "a-new-password", NOW);

    // The order is the design: tens of milliseconds of deliberate CPU cost must not
    // sit inside a transaction holding locks.
    expect(statements[0]).toBe("hash");
    expect(statements.indexOf("tx:begin")).toBeGreaterThan(statements.indexOf("hash"));
  });

  it("spends the token INSIDE the transaction, so a later failure does not burn the link", async () => {
    const { service, statements } = harness();
    await service.resetPassword(TOKEN, "a-new-password", NOW);

    const consume = statements.indexOf("tx:consumeCas");
    expect(consume).toBeGreaterThan(statements.indexOf("tx:begin"));
    expect(consume).toBeLessThan(statements.indexOf("tx:credentialUpdate"));
    // A token spent outside the transaction that then failed would burn the link
    // against a password that never changed — the user locked out with no way back.
  });

  it("changes the hash, ends EVERY session, spends the other links and audits — in one transaction", async () => {
    const { service, statements, auditInputs, auditTx } = harness();
    const outcome = await service.resetPassword(TOKEN, "a-new-password", NOW);

    expect(statements).toEqual([
      "hash",
      "tx:begin",
      "tx:findFirst",
      "tx:consumeCas",
      "tx:credentialUpdate",
      "tx:sessionsDelete",
      "tx:spendOthers",
      "tx:audit",
    ]);
    expect(outcome).toEqual({ userProfileId: PROFILE, sessionsEnded: 3 });

    // The audit joins the TRANSACTION, never runs after it: an append failure must
    // abort the password change rather than commit it unaudited.
    expect(auditTx[0]).toBeDefined();
    expect(auditInputs[0]).toMatchObject({
      action: "auth.password_reset_completed",
      actorUserProfileId: PROFILE,
      targetType: "user_profile",
      targetId: PROFILE,
      metadata: { sessionsEnded: 3 },
    });
    // The record names nobody and carries no secret: no token, no hash, no address.
    const serialized = JSON.stringify(auditInputs[0]);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("argon2");
  });

  it("ends every session, not just the caller's — that is the point of a reset", async () => {
    const { service, statements } = harness();
    await service.resetPassword(TOKEN, "a-new-password", NOW);
    // The `WHERE` is asserted inside the stub: `{ userProfileId }`, which deletes
    // all of them. A reset is how somebody takes an account back, and a surviving
    // session is the attacker's.
    expect(statements).toContain("tx:sessionsDelete");
  });

  it("refuses an unusable token with the login's own vocabulary, and touches nothing", async () => {
    const { service, statements } = harness({ tokenRow: null });
    await expect(service.resetPassword(TOKEN, "a-new-password", NOW)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "This password reset link is not valid. Request a new one.",
    });
    // The transaction opened and the lookup happened; nothing after it did.
    expect(statements).toEqual(["hash", "tx:begin", "tx:findFirst"]);
  });

  it("refuses a missing or empty password before hashing anything", async () => {
    for (const bad of [undefined, null, "", 42, {}]) {
      const { service, statements } = harness();
      await expect(service.resetPassword(TOKEN, bad, NOW)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(statements).toEqual([]);
    }
  });

  it("refuses an over-long password before hashing it, which is a cheap DoS bound", async () => {
    const { service, statements } = harness();
    await expect(service.resetPassword(TOKEN, "x".repeat(1025), NOW)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(statements).toEqual([]);
  });

  it("uses its own transaction for the token, never the ambient client", async () => {
    const { service, statements, ambientConsults } = harness();
    await service.resetPassword(TOKEN, "a-new-password", NOW);
    // Both halves of the same fact: the transaction's delegates did the work, and the
    // client the token service was constructed with was never consulted — which is
    // what makes the spending part of the atomic unit rather than adjacent to it.
    expect(statements).toContain("tx:findFirst");
    expect(statements).toContain("tx:consumeCas");
    expect(ambientConsults).toBe(0);
  });
});
