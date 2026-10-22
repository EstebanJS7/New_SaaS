/**
 * @vitest-environment node
 */
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
 * The staff CSV export proxy ([[REP-007]], [[DEC-066]]).
 *
 * What these cases pin, in order of what could go wrong:
 *
 * - an unknown report code is refused HERE, before an upstream call and before a
 *   credential is even read — the proxy is not a tunnel;
 * - only the staff session cookie and `x-request-id` cross, never the whole jar;
 * - `content-type` AND `content-disposition` survive, with the CSV body byte for
 *   byte, because a browser that loses the second header invents a filename and
 *   one that loses the first saves a text file as `download`;
 * - a non-200 reaches the caller with its status and the API's own envelope.
 */

interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
}

function mockNextRequest(props: { search?: string; headers?: Headers } = {}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: {
      pathname: "/api/reports/sales-by-period/export",
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

/** Calls the route handler for one code, as the framework would. */
async function callExport(
  reportCode: string,
  request: MockNextRequest = mockNextRequest()
): Promise<Response> {
  return GET(request as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ reportCode }),
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

/** The exact document the API answers with, quoted field and all. */
const CSV_BODY = 'bucketDate,saleCount,net,tax,gross\n2026-06-10,2,"1,234.50",0.00,1234.50\n';

const DISPOSITION = 'attachment; filename="sales-by-period-2026-06-10-2026-06-11.csv"';

function upstreamCsv(): Response {
  return new Response(CSV_BODY, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": DISPOSITION,
      "x-request-id": "req-upstream",
    },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  cookiesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the export proxy · the closed allowlist", () => {
  it("refuses a code outside the allowlist locally, without an upstream call or a cookie read", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));

    for (const reportCode of [
      "profit-and-loss",
      "sales-by-period/export",
      "../rbac/roles",
      "Sales-By-Period",
      "",
    ]) {
      const response = await callExport(reportCode);

      expect(response.status, reportCode).toBe(400);
      expect(await response.json(), reportCode).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid report export code." },
      });
    }

    // No report was asked for, and no credential was touched on the way.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("accepts every code the API exports", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamCsv()));

    for (const reportCode of [
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
    ]) {
      const response = await callExport(reportCode);

      expect(response.status, reportCode).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(fetchUrl(11)).toBe("http://localhost:3001/reports/deworming-due/export");
  });
});

describe("the export proxy · the upstream request", () => {
  it("forwards ONLY the staff cookie and the caller's request id, with no-store", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore(
        { name: STAFF_SESSION_COOKIE, value: "token-123" },
        { name: PORTAL_SESSION_COOKIE, value: "portal-token" }
      )
    );
    fetchMock.mockImplementation(() => Promise.resolve(upstreamCsv()));

    await callExport(
      "sales-by-period",
      mockNextRequest({
        search: "from=2026-06-10&to=2026-06-11",
        headers: new Headers({ "x-request-id": "req-123" }),
      })
    );

    expect(fetchUrl()).toBe(
      "http://localhost:3001/reports/sales-by-period/export?from=2026-06-10&to=2026-06-11"
    );
    const init = fetchInit();
    expect(init.method).toBe("GET");
    // The named staff cookie only: the portal cookie is not the staff credential.
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers["x-request-id"]).toBe("req-123");
    expect(init.cache).toBe("no-store");
  });

  it("omits x-request-id when the caller sends none", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamCsv()));

    await callExport("stock");

    // The bare path is forwarded as-is: this boundary never interprets a range,
    // so a missing or malformed one is the API's own `400`, not a proxy guess.
    expect(fetchUrl()).toBe("http://localhost:3001/reports/stock/export");
    expect(fetchInit().headers).not.toHaveProperty("x-request-id");
  });

  it("refuses a request with no staff session, without an upstream call", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const response = await callExport("sales-by-period");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the export proxy · the upstream response", () => {
  it("passes content-type AND content-disposition through, with the CSV intact", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamCsv()));

    const response = await callExport("sales-by-period");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    // Without this header the browser invents its own filename.
    expect(response.headers.get("content-disposition")).toBe(DISPOSITION);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    // Byte for byte, including the quoted field that carries a comma: the proxy
    // buffers the text, it never re-encodes or re-parses it.
    expect(await response.text()).toBe(CSV_BODY);
  });

  it("forwards a 403 upstream with its status and its own error envelope", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    const envelope = {
      error: {
        code: "FORBIDDEN",
        message: "Insufficient permissions for this operation.",
        requestId: "req-api",
      },
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(envelope), {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        })
      )
    );

    const response = await callExport("sales-by-period");

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // A refusal carries no attachment: there is no file to name.
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual(envelope);
  });

  it("forwards a 400 from the API's own validation, unchanged", async () => {
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
    const envelope = {
      error: {
        code: "VALIDATION_FAILED",
        message: "A custom report period requires both from and to.",
        requestId: "req-api",
      },
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(envelope), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        })
      )
    );

    const response = await callExport(
      "sales-by-period",
      mockNextRequest({ search: "from=2026-06-10" })
    );

    expect(response.status).toBe(400);
    // The API's own period message reaches the caller: the proxy adds no
    // divergence to the rejection contract.
    expect(await response.json()).toEqual(envelope);
  });
});
