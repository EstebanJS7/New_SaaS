import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DomainError } from "@newsaas/shared";
import { mapExceptionToError, type MappedError } from "./global-exception.filter.js";

describe("mapExceptionToError", () => {
  it("maps every registered DomainError code to its registry status", () => {
    const cases: [DomainError, MappedError][] = [
      [
        new DomainError("VALIDATION_FAILED", "invalid"),
        { status: 400, code: "VALIDATION_FAILED", message: "invalid" },
      ],
      [
        new DomainError("UNAUTHENTICATED", "expired"),
        { status: 401, code: "UNAUTHENTICATED", message: "expired" },
      ],
      [
        new DomainError("FORBIDDEN", "no access"),
        { status: 403, code: "FORBIDDEN", message: "no access" },
      ],
      [
        new DomainError("NOT_FOUND", "missing"),
        { status: 404, code: "NOT_FOUND", message: "missing" },
      ],
      [new DomainError("CONFLICT", "dup"), { status: 409, code: "CONFLICT", message: "dup" }],
      [
        new DomainError("RATE_LIMITED", "slow down"),
        { status: 429, code: "RATE_LIMITED", message: "slow down" },
      ],
    ];

    for (const [error, expected] of cases) {
      expect(mapExceptionToError(error)).toEqual(expected);
    }
  });

  it("maps a directly thrown ZodError to VALIDATION_FAILED with flattened issues", () => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
    });
    const result = schema.safeParse({ email: "nope", password: "short" });
    if (result.success) throw new Error("expected parse failure");

    const mapped = mapExceptionToError(result.error);

    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.status).toBe(400);
    expect(mapped.message).toContain("email:");
    expect(mapped.message).toContain("password:");
    // Values are never echoed — only field paths and validator text.
    expect(mapped.message).not.toContain("nope");
    expect(mapped.message.split("; ").length).toBeGreaterThanOrEqual(2);
  });

  it("maps an HttpException wrapping a ZodError to VALIDATION_FAILED", () => {
    const schema = z.object({ age: z.number() });
    const result = schema.safeParse({ age: "old" });
    if (result.success) throw new Error("expected parse failure");

    const exception = new BadRequestException();
    Object.defineProperty(exception, "getResponse", {
      value: () => ({ statusCode: 400, issues: result.error.issues }),
    });

    const mapped = mapExceptionToError(exception);
    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.status).toBe(400);
    expect(mapped.message).toContain("age:");
  });

  it("maps BadRequest-style string-array messages to a joined validation message", () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ["a is bad", "b is worse"],
    });

    const mapped = mapExceptionToError(exception);
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.message).toBe("a is bad; b is worse");
  });

  it("routes known HTTP statuses through the frozen registry table", () => {
    // Developer-authored HttpException copy is safe to surface verbatim.
    expect(mapExceptionToError(new NotFoundException())).toEqual({
      status: 404,
      code: "NOT_FOUND",
      message: "Not Found",
    });
    const rateLimited = new HttpException("limit", 429);
    const mapped = mapExceptionToError(rateLimited);
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.status).toBe(429);
    expect(mapped.message).toBe("limit");
  });

  it("falls back to INTERNAL with fixed copy for unknown statuses", () => {
    const unavailable = new HttpException("unavailable", 503);
    const mapped = mapExceptionToError(unavailable);
    expect(mapped).toEqual({
      status: 500,
      code: "INTERNAL",
      message: "Internal server error.",
    });
  });

  it("never leaks unknown error internals to the client-facing mapping", () => {
    const leaky = new Error("SECRET-DB-CONNECTION-STRING postgres://...");
    const mapped = mapExceptionToError(leaky);

    expect(mapped).toEqual({
      status: 500,
      code: "INTERNAL",
      message: "Internal server error.",
    });
    expect(JSON.stringify(mapped)).not.toContain("SECRET-DB-CONNECTION-STRING");
  });

  it("handles non-Error thrown values without throwing", () => {
    for (const weird of ["string", 42, null, undefined, Symbol("x")]) {
      const mapped = mapExceptionToError(weird);
      expect(mapped.code).toBe("INTERNAL");
      expect(mapped.status).toBe(500);
    }
  });

  it("truncates oversized validation messages defensively", () => {
    const issues = Array.from({ length: 200 }, (_, index) => ({
      path: [`field${index}`],
      message: `issue ${index}`,
    }));
    const mapped = mapExceptionToError({ name: "ZodError", issues });
    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.message.length).toBeLessThanOrEqual(513);
  });
});
