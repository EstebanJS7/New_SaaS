import { describe, expect, it } from "vitest";
import {
  PROVIDER_SNAPSHOT_ALLOWED_KEYS,
  PROVIDER_SNAPSHOT_DEFAULT_MAX_DEPTH,
  PROVIDER_SNAPSHOT_DEFAULT_MAX_STRING_LENGTH,
  PROVIDER_SNAPSHOT_SECRET_KEY_PATTERNS,
  sanitizeProviderSnapshot,
} from "./fiscal-snapshot.sanitizer.js";

describe("provider snapshot sanitizer (DEC-050, PRD §41)", () => {
  it("preserves allowlisted scalar values", () => {
    expect(PROVIDER_SNAPSHOT_ALLOWED_KEYS).toEqual([
      "provider",
      "externalId",
      "cdc",
      "state",
      "status",
      "statusCode",
      "reasonCode",
      "message",
      "timestamp",
      "service",
      "xmlBytes",
    ]);
    const value = Object.fromEntries(PROVIDER_SNAPSHOT_ALLOWED_KEYS.map((key) => [key, "value"]));
    expect(sanitizeProviderSnapshot(value).snapshot).toEqual(value);
  });

  it("keeps the SIFEN descriptor keys ADR-009 adds, and redacts a document instead", () => {
    // ADR-009: the provider's snapshot is a descriptor — the service, the CDC
    // and the byte count — so the two descriptor-only keys survive, while the
    // document's own bytes (any unlisted key) are redacted.
    expect(
      sanitizeProviderSnapshot({
        provider: "SIFEN_DIRECT",
        service: "receiveBatch",
        cdc: "cdc-1",
        xmlBytes: 1_024,
        signedXml: "<rDE>",
      })
    ).toEqual({
      snapshot: {
        provider: "SIFEN_DIRECT",
        service: "receiveBatch",
        cdc: "cdc-1",
        xmlBytes: 1_024,
        signedXml: "[redacted]",
      },
      redactedPaths: ["signedXml"],
    });
  });

  it("redacts non-allowlisted keys and records the path", () => {
    expect(sanitizeProviderSnapshot({ provider: "p", payload: "sensitive" })).toEqual({
      snapshot: { provider: "p", payload: "[redacted]" },
      redactedPaths: ["payload"],
    });
  });

  it("redacts secret-shaped keys nested inside an allowlisted value", () => {
    expect(sanitizeProviderSnapshot({ message: { text: "ok", token: "hidden" } })).toEqual({
      snapshot: { message: { text: "[redacted]", token: "[redacted]" } },
      redactedPaths: ["message.text", "message.token"],
    });
    expect(PROVIDER_SNAPSHOT_SECRET_KEY_PATTERNS).toHaveLength(8);
  });

  it("records array indices in secret paths", () => {
    expect(sanitizeProviderSnapshot({ message: [{ token: "hidden" }] })).toEqual({
      snapshot: { message: [{ token: "[redacted]" }] },
      redactedPaths: ["message.0.token"],
    });
  });

  it("redacts a subtree at the depth bound", () => {
    expect(
      sanitizeProviderSnapshot({ message: { state: { status: "deep" } } }, { maxDepth: 2 })
    ).toEqual({
      snapshot: { message: { state: "[redacted]" } },
      redactedPaths: ["message.state"],
    });
  });

  it("truncates long strings and records the truncation path", () => {
    expect(sanitizeProviderSnapshot({ message: "abcdef" }, { maxStringLength: 3 })).toEqual({
      snapshot: { message: "abc…" },
      redactedPaths: ["message#truncated"],
    });
  });

  it("pins the default bounds", () => {
    expect(PROVIDER_SNAPSHOT_DEFAULT_MAX_DEPTH).toBe(4);
    expect(PROVIDER_SNAPSHOT_DEFAULT_MAX_STRING_LENGTH).toBe(512);
    expect(
      sanitizeProviderSnapshot({ message: { state: { status: { reasonCode: { cdc: "deep" } } } } })
        .redactedPaths
    ).toContain("message.state.status.reasonCode");
    expect(
      (sanitizeProviderSnapshot({ message: "x".repeat(513) }).snapshot as { message: string })
        .message
    ).toBe(`${"x".repeat(512)}…`);
  });

  it("redacts non-plain values rather than serializing them", () => {
    class Example {
      readonly value = "hidden";
    }
    const value = {
      message: new Date(),
      state: new Map(),
      status: new Example(),
      provider: () => "x",
      cdc: 1n,
    };
    expect(sanitizeProviderSnapshot(value)).toEqual({
      snapshot: {
        message: "[redacted]",
        state: "[redacted]",
        status: "[redacted]",
        provider: "[redacted]",
        cdc: "[redacted]",
      },
      redactedPaths: ["message", "state", "status", "provider", "cdc"],
    });
  });

  it("does not mutate a deeply frozen input", () => {
    const input = Object.freeze({
      provider: "p",
      message: Object.freeze({ status: "ok", token: "hidden" }),
    });
    const before = structuredClone(input);
    expect(sanitizeProviderSnapshot(input).snapshot).toEqual({
      provider: "p",
      message: { status: "ok", token: "[redacted]" },
    });
    expect(input).toEqual(before);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 7],
    ["boolean", true],
    ["array", ["value"]],
  ] as const)("handles top-level %s without throwing", (_name, value) => {
    expect(() => sanitizeProviderSnapshot(value)).not.toThrow();
  });
});
