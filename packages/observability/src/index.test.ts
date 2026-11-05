import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import {
  captureError,
  initErrorTracking,
  isErrorTrackingEnabled,
  redactText,
  scrubEvent,
} from "./index.js";

describe("error tracking is off by default (DEC-093)", () => {
  it("does not initialise without a DSN, and capture is then a no-op", () => {
    expect(initErrorTracking({ service: "api" })).toBe(false);
    expect(initErrorTracking({ service: "api", dsn: "  " })).toBe(false);
    expect(isErrorTrackingEnabled()).toBe(false);
    expect(() => captureError(new Error("boom"), { requestId: "r-1" })).not.toThrow();
  });
});

describe("redactText", () => {
  it("keeps only the first line: a Prisma error dumps its arguments after it", () => {
    const prisma =
      "\nInvalid `prisma.customer.create()` invocation:\n\n{\n  data: { email: 'ana@example.com', documentNumber: '4567890' }\n}";
    expect(redactText(prisma)).toBe("Invalid `prisma.customer.create()` invocation:");
  });

  it("masks e-mail addresses and long digit runs", () => {
    expect(redactText("No se pudo enviar a ana.perez@clinica.com.py (RUC 80012345-6)")).toBe(
      "No se pudo enviar a [email] (RUC [número])"
    );
    expect(redactText("monto 1.500.000 y teléfono 0981 123 456")).toContain("[número]");
  });

  it("caps the length", () => {
    expect(redactText("x".repeat(500))).toHaveLength(200);
  });
});

describe("scrubEvent", () => {
  it("removes request, user, extra, breadcrumbs, frame variables and unknown tags and contexts", () => {
    const event = {
      type: undefined,
      message: "fallo para ana@example.com",
      request: {
        url: "https://app/x?token=1",
        headers: { cookie: "nsaas_session=abc" },
        data: "{}",
      },
      user: { email: "ana@example.com", ip_address: "1.2.3.4" },
      extra: { body: { password: "x" } },
      breadcrumbs: [{ message: "GET /patients/123" }],
      server_name: "host",
      tags: { service: "api", requestId: "r-1", url: "/patients/1" },
      contexts: { os: { name: "linux" }, runtime: { name: "node" }, state: { tenant: "x" } },
      exception: {
        values: [
          {
            type: "Error",
            value: "Invalid `prisma.x.update()` invocation:\n{ data: { phone: '0981123456' } }",
            stacktrace: { frames: [{ filename: "a.js", lineno: 1, vars: { password: "x" } }] },
          },
        ],
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    const serialized = JSON.stringify(scrubbed);

    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.tags).toEqual({ service: "api", requestId: "r-1" });
    expect(Object.keys(scrubbed.contexts ?? {}).sort()).toEqual(["os", "runtime"]);
    expect(scrubbed.exception?.values?.[0]?.value).toBe("Invalid `prisma.x.update()` invocation:");
    for (const secret of ["ana@example.com", "nsaas_session", "password", "0981123456", "token"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
