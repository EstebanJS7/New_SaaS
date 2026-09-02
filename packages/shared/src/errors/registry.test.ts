import { describe, expect, it } from "vitest";
import { DomainError } from "./domain-error.js";
import { ERROR_CODES, getStatusForCode } from "./registry.js";

describe("ERROR_CODES registry", () => {
  it("pins every registered code to its contracted HTTP status", () => {
    // Snapshot contract: existing codes must never change status. Evolution
    // is additive-only (spec: registry snapshot stability).
    expect(ERROR_CODES).toEqual({
      VALIDATION_FAILED: { status: 400 },
      BRAND_OVERRIDE_UNKNOWN_KEY: { status: 400 },
      BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION: { status: 400 },
      BRAND_OVERRIDE_INVALID_VALUE: { status: 400 },
      UNAUTHENTICATED: { status: 401 },
      FORBIDDEN: { status: 403 },
      FEATURE_NOT_ENTITLED: { status: 403 },
      NOT_FOUND: { status: 404 },
      CONFLICT: { status: 409 },
      RATE_LIMITED: { status: 429 },
      INTERNAL: { status: 500 },
    });
  });

  it("is deeply frozen so entries cannot be mutated at runtime", () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    for (const entry of Object.values(ERROR_CODES)) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
    const mutableEscape = ERROR_CODES as {
      INTERNAL: { status: number };
      NEW_CODE?: unknown;
    };
    expect(() => {
      mutableEscape.INTERNAL = { status: 501 };
    }).toThrow(TypeError);
    expect(() => {
      mutableEscape.NEW_CODE = { status: 418 };
    }).toThrow(TypeError);
  });

  it("exposes exactly the eleven baseline codes with SCREAMING_SNAKE keys", () => {
    const codes = Object.keys(ERROR_CODES);
    expect(codes).toHaveLength(11);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("maps each code deterministically through getStatusForCode", () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(getStatusForCode(code as keyof typeof ERROR_CODES)).toBe(entry.status);
    }
  });
});

describe("DomainError", () => {
  it("carries code, message and behaves as a native Error", () => {
    const error = new DomainError("NOT_FOUND", "Resource was not found");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource was not found");
    expect(error.name).toBe("DomainError");
    expect(typeof error.stack).toBe("string");
  });

  it("keeps optional details and cause without exposing them by default", () => {
    const plain = new DomainError("FORBIDDEN", "No access");
    expect(plain.details).toBeUndefined();
    expect(plain.requestId).toBeUndefined();

    const cause = new Error("underlying");
    const rich = new DomainError("CONFLICT", "Duplicate slug", {
      details: { field: "slug" },
      cause,
    });
    expect(rich.details).toEqual({ field: "slug" });
    expect(rich.cause).toBe(cause);
  });

  it("provides a mutable requestId slot for background contexts", () => {
    const error = new DomainError("RATE_LIMITED", "Too many attempts");
    error.requestId = "req-abc-123";
    expect(error.requestId).toBe("req-abc-123");

    const preset = new DomainError("UNAUTHENTICATED", "Session expired", {
      requestId: "req-xyz",
    });
    expect(preset.requestId).toBe("req-xyz");
  });
});
