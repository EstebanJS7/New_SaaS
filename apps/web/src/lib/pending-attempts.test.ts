import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetAttempt, pendingAttempts, rememberAttempt } from "./pending-attempts";

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("pending attempts (UX-035)", () => {
  it("remembers an attempt by kind and forgets it once its outcome is known", () => {
    rememberAttempt("sale.create", KEY_A);
    rememberAttempt("cash.movement.create", KEY_B);

    expect(pendingAttempts("sale.create").map((attempt) => attempt.key)).toEqual([KEY_A]);
    forgetAttempt(KEY_A);
    expect(pendingAttempts("sale.create")).toEqual([]);
    expect(pendingAttempts("cash.movement.create")).toHaveLength(1);
  });

  it("stores only the kind, the key and the instant — never commercial content", () => {
    rememberAttempt("sale.create", KEY_A);
    const stored = JSON.parse(
      window.sessionStorage.getItem("newsaas.pending-attempts.v1") ?? "[]"
    ) as Record<string, unknown>[];
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(["key", "kind", "startedAt"]);
  });

  it("drops attempts older than a day and anything malformed", () => {
    rememberAttempt("sale.create", KEY_A, new Date("2026-11-01T00:00:00Z"));
    window.sessionStorage.setItem(
      "newsaas.pending-attempts.v1",
      JSON.stringify([
        ...(JSON.parse(
          window.sessionStorage.getItem("newsaas.pending-attempts.v1") ?? "[]"
        ) as unknown[]),
        { kind: "sale.create", key: "not-a-uuid", startedAt: "2026-11-02T00:00:00Z" },
        { kind: "evil", key: KEY_B, startedAt: "2026-11-02T00:00:00Z" },
      ])
    );
    expect(pendingAttempts("sale.create", new Date("2026-11-02T12:00:00Z"))).toEqual([]);
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberAttempt("sale.create", KEY_A)).not.toThrow();
    expect(pendingAttempts("sale.create")).toEqual([]);
  });
});
