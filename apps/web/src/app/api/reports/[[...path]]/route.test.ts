/**
 * @vitest-environment node
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTAL_SESSION_COOKIE, STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

const cookiesMock = vi.fn();
const fetchMock = vi.fn();

(global as typeof globalThis & { fetch: typeof fetchMock }).fetch = fetchMock;

vi.mock("next/headers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- test mock factory returns dynamic stub
  cookies: () => cookiesMock(),
}));

vi.mock("next/server", async () => {
  return await vi.importActual("next/server");
});

import { GET } from "./route";

/**
 * The staff reports read proxy ([[REP-008]], [[DEC-062]]).
 *
 * What these cases pin, in order of what could go wrong:
 *
 * - an unknown code is refused HERE, before an upstream call and before a
 *   credential is even read — the proxy is not a tunnel into the reporting API;
 * - a query key the report does not accept is refused too, because the API's own
 *   `.strict()` schemas would otherwise turn it into a `400` that looks like a
 *   proxy bug, and because silently dropping `?tenantId=` would leave the caller
 *   believing a tenant was chosen;
 * - only the staff session cookie and `x-request-id` cross, never the whole jar;
 * - `/api/reports/<code>/export` is NOT served here: the dedicated export proxy
 *   owns it, and this route refuses a two-segment path rather than proxying a
 *   report read in place of a CSV download;
 * - the upstream status, `content-type` and JSON envelope reach the caller
 *   unchanged, so the workspace renders the API's own message.
 */

interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
}

function mockNextRequest(props: { search?: string; headers?: Headers } = {}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: {
      pathname: "/api/reports/unused-by-this-route",
      searchParams: new URLSearchParams(props.search ?? ""),
    },
    headers: {
      get: (name: string) => headers.get(name),
    },
  };
}

interface CookieValue {
  readonly name: string;
  readonly value: string;
}

/** Builds the `cookies()` double: only the listed cookies exist by name. */
function cookieStore(...entries: readonly CookieValue[]): {
  get: (name: string) => CookieValue | undefined;
  toString: () => string;
} {
  return {
    get: (name: string) => entries.find((entry) => entry.name === name),
    // Present to prove the proxy never serializes the whole jar.
    toString: () => entries.map((entry) => `${entry.name}=${entry.value}`).join("; "),
  };
}

/** Calls the catch-all handler for one browser path, as the framework would. */
async function callRoute(
  segments: readonly string[] | undefined,
  request: MockNextRequest = mockNextRequest()
): Promise<Response> {
  return GET(request as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ path: segments === undefined ? undefined : [...segments] }),
  });
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  cache?: string;
}

function fetchUrl(callIndex = 0): string {
  return (fetchMock.mock.calls[callIndex] as unknown as [string])[0];
}

function fetchInit(callIndex = 0): FetchInit {
  return (fetchMock.mock.calls[callIndex] as unknown as [string, FetchInit])[1];
}

/** The twelve codes the epic ships, the same list the export proxy accepts. */
const REPORT_CODES = [
  "sales-by-period",
  "payment-methods",
  "sales-by-product-service",
  "cash-sessions",
  "cash-movements",
  "purchases",
  "stock",
  "low-stock",
  "consultations",
  "new-patients",
  "vaccines-due",
  "deworming-due",
] as const;

const LOW_STOCK_BODY = {
  report: "low-stock",
  thresholdsConfigured: false,
  rows: [],
};

function upstreamJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "req-upstream" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  cookiesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the reports proxy · the closed allowlist", () => {
  it("refuses a code outside the allowlist locally, without an upstream call or a cookie read", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));

    for (const segments of [
      ["profit-and-loss"],
      ["../rbac/roles"],
      ["Sales-By-Period"],
      ["sales-by-period", "export"],
      ["sales-by-period", "extra"],
      [],
      undefined,
    ] as const) {
      const response = await callRoute(segments);

      expect(response.status, String(segments)).toBeGreaterThanOrEqual(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(["NOT_FOUND", "VALIDATION_FAILED"], String(segments)).toContain(body.error.code);
    }

    // No report was asked for, and no credential was touched on the way.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown single segment with its own validation envelope", async () => {
    const response = await callRoute(["profit-and-loss"]);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Invalid report code." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts every one of the twelve report codes", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(LOW_STOCK_BODY)));

    for (const code of REPORT_CODES) {
      const response = await callRoute([code]);

      expect(response.status, code).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(fetchUrl(0)).toBe("http://localhost:3001/reports/sales-by-period");
    expect(fetchUrl(11)).toBe("http://localhost:3001/reports/deworming-due");
  });
});

describe("the reports proxy · the query allowlist", () => {
  it("forwards only the keys the report accepts, verbatim and in order", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(LOW_STOCK_BODY)));

    await callRoute(
      ["sales-by-period"],
      mockNextRequest({ search: "from=2026-06-10&to=2026-06-11" })
    );
    expect(fetchUrl(0)).toBe(
      "http://localhost:3001/reports/sales-by-period?from=2026-06-10&to=2026-06-11"
    );

    await callRoute(["vaccines-due"], mockNextRequest({ search: "horizonDays=60" }));
    expect(fetchUrl(1)).toBe("http://localhost:3001/reports/vaccines-due?horizonDays=60");

    // A low-stock read carries NO query, so the upstream URL stays bare.
    await callRoute(["low-stock"]);
    expect(fetchUrl(2)).toBe("http://localhost:3001/reports/low-stock");
  });

  it("refuses a period key on a due report and a horizon on a period report", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));

    for (const [code, search] of [
      ["vaccines-due", "from=2026-06-10"],
      ["deworming-due", "preset=last7Days"],
      ["sales-by-period", "horizonDays=30"],
    ] as const) {
      const response = await callRoute([code], mockNextRequest({ search }));

      expect(response.status, `${code}?${search}`).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code, `${code}?${search}`).toBe("VALIDATION_FAILED");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a query on the current-state report instead of dropping it", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));

    const response = await callRoute(["low-stock"], mockNextRequest({ search: "preset=today" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "This report takes no query parameters." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a tenant id rather than forwarding it upstream", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));

    for (const search of [
      "tenantId=22222222-2222-4222-8222-222222222222",
      "tempunknown=1",
      "preset=last7Days&tenantId=22222222-2222-4222-8222-222222222222",
    ]) {
      const response = await callRoute(["sales-by-period"], mockNextRequest({ search }));

      expect(response.status, search).toBe(400);
    }

    // Tenant authority is the API's, resolved from the forwarded session alone.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the reports proxy · the upstream request", () => {
  it("forwards ONLY the staff cookie and the caller's request id, with no-store", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore(
        { name: STAFF_SESSION_COOKIE, value: "token-123" },
        { name: PORTAL_SESSION_COOKIE, value: "portal-token" }
      )
    );
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(LOW_STOCK_BODY)));

    await callRoute(
      ["sales-by-period"],
      mockNextRequest({
        search: "preset=last7Days",
        headers: new Headers({ "x-request-id": "req-123" }),
      })
    );

    expect(fetchUrl()).toBe("http://localhost:3001/reports/sales-by-period?preset=last7Days");
    const init = fetchInit();
    expect(init.method).toBe("GET");
    // The named staff cookie only: the portal cookie is not the staff credential.
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers["x-request-id"]).toBe("req-123");
    expect(init.cache).toBe("no-store");
  });

  it("omits x-request-id when the caller sends none", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(LOW_STOCK_BODY)));

    await callRoute(["stock"]);

    expect(fetchInit().headers).not.toHaveProperty("x-request-id");
  });

  it("refuses a request with no staff session, without an upstream call", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const response = await callRoute(["sales-by-period"]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the reports proxy · the upstream response", () => {
  it("passes the content-type, the status and the body through", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(LOW_STOCK_BODY)));

    const response = await callRoute(["low-stock"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    // Buffered as text and re-emitted byte for byte: no key is dropped, and no
    // decimal string is normalized on the way through.
    expect(await response.text()).toBe(JSON.stringify(LOW_STOCK_BODY));
  });

  it("forwards a 403 with its status and the API's own error envelope", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    const envelope = {
      error: {
        code: "FORBIDDEN",
        message: "Insufficient permissions for this operation.",
        requestId: "req-api",
      },
    };
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(envelope, 403)));

    const response = await callRoute(["sales-by-period"]);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(envelope);
  });

  it("forwards the API's own period refusal unchanged", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    const envelope = {
      error: {
        code: "VALIDATION_FAILED",
        message: "The report period spans more than 366 days.",
        requestId: "req-api",
      },
    };
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson(envelope, 400)));

    const response = await callRoute(
      ["sales-by-period"],
      mockNextRequest({ search: "from=1900-01-01&to=2026-06-11" })
    );

    expect(response.status).toBe(400);
    // The message reaches the caller verbatim: the proxy adds no divergence to
    // the rejection contract, and the workspace can show the API's sentence.
    expect(await response.json()).toEqual(envelope);
  });
});

describe("the reports proxy · the export route beside it", () => {
  it("leaves /api/reports/<code>/export to the dedicated export proxy", async () => {
    // Next.js resolves the more specific segment first, so `/api/reports/<code>/export`
    // is served by that route and never reaches this catch-all. The assertion is
    // structural — the file that owns the CSV download exists where the router
    // looks for it FIRST — plus behavioural: were the catch-all ever reached for
    // that path, it refuses rather than proxying a report read in place of a file.
    const exportRouteFile = fileURLToPath(
      new URL("../[reportCode]/export/route.ts", import.meta.url)
    );
    expect(existsSync(exportRouteFile)).toBe(true);

    const response = await callRoute(["sales-by-period", "export"]);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Report route not found." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
