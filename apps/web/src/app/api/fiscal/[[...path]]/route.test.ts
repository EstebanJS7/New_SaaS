/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTAL_SESSION_COOKIE, STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

const cookiesMock = vi.fn();
const fetchMock = vi.fn();
(global as typeof globalThis & { fetch: typeof fetchMock }).fetch = fetchMock;
vi.mock("next/headers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- test mock factory returns a dynamic stub
  cookies: () => cookiesMock(),
}));
import { GET, POST } from "./route";

const ID = "99999999-9999-4999-8999-999999999999";
interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}
function mockNextRequest(props: {
  pathname: string;
  search?: string;
  headers?: Headers;
  body?: string;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname, searchParams: new URLSearchParams(props.search ?? "") },
    headers: { get: (name) => headers.get(name) },
    text: () => Promise.resolve(props.body ?? ""),
  };
}
interface CookieValue {
  readonly name: string;
  readonly value: string;
}
function cookieStore(...entries: readonly CookieValue[]) {
  return {
    get: (name: string) => entries.find((entry) => entry.name === name),
    toString: () => entries.map((entry) => `${entry.name}=${entry.value}`).join("; "),
  };
}
type Handler = (request: MockNextRequest) => Promise<Response>;
async function dispatch(method: "GET" | "POST", request: MockNextRequest): Promise<Response> {
  const handlers: Record<typeof method, Handler> = {
    GET: (value) => GET(value as unknown as Parameters<typeof GET>[0]),
    POST: (value) => POST(value as unknown as Parameters<typeof POST>[0]),
  };
  return handlers[method](request);
}
interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  cache?: string;
}
function fetchInit(index = 0): FetchInit {
  return (fetchMock.mock.calls[index] as unknown as [string, FetchInit])[1];
}
function upstreamOk(status = 202): Response {
  return new Response("upstream-bytes", {
    status,
    headers: { "content-type": "application/fiscal+json", "x-request-id": "upstream-id" },
  });
}
const ISSUE_BODY = '{ "invoiceId" : "' + ID + '" }';
const CANCEL_BODY = '{ "reason" : "duplicate" }';
const SERVED_ROUTES = [
  {
    method: "GET",
    pathname: "/api/fiscal/fiscal-documents",
    upstream: "/fiscal-documents",
    body: "",
  },
  {
    method: "GET",
    pathname: `/api/fiscal/fiscal-documents/${ID}`,
    upstream: `/fiscal-documents/${ID}`,
    body: "",
  },
  {
    method: "POST",
    pathname: "/api/fiscal/fiscal-documents",
    upstream: "/fiscal-documents",
    body: ISSUE_BODY,
  },
  {
    method: "POST",
    pathname: `/api/fiscal/fiscal-documents/${ID}/cancel`,
    upstream: `/fiscal-documents/${ID}/cancel`,
    body: CANCEL_BODY,
  },
] as const;
interface ErrorEnvelope {
  error: { code: string; message: string };
}
async function expectError(
  response: Response,
  status: number,
  code: string,
  message: string
): Promise<void> {
  expect(response.status).toBe(status);
  expect((await response.json()) as ErrorEnvelope).toEqual({ error: { code, message } });
}
const missing = (method: "GET" | "POST", pathname: string, search?: string, body?: string) =>
  dispatch(method, mockNextRequest({ pathname, search, body }));

describe("/api/fiscal proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards every served pair, exact bodies, allowlisted headers, and streamed response metadata", async () => {
    for (const route of SERVED_ROUTES) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(upstreamOk());
      const requestId = "client-id";
      const response = await dispatch(
        route.method,
        mockNextRequest({
          pathname: route.pathname,
          body: route.body,
          headers: new Headers({
            "x-request-id": requestId,
            authorization: "drop",
            "x-tenant-id": "drop",
          }),
        })
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
      expect(url).toBe(`http://localhost:3001${route.upstream}`);
      expect(init.method).toBe(route.method);
      expect(init.cache).toBe("no-store");
      expect(init.body).toBe(route.body || undefined);
      expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
      expect(init.headers["x-request-id"]).toBe(requestId);
      expect(Object.keys(init.headers).sort()).toEqual(
        route.body ? ["content-type", "cookie", "x-request-id"] : ["cookie", "x-request-id"]
      );
      if (route.body) expect(init.headers["content-type"]).toBe("application/json");
      expect(response.status).toBe(202);
      expect(response.headers.get("content-type")).toBe("application/fiscal+json");
      expect(response.headers.get("x-request-id")).toBe("upstream-id");
      expect(await response.text()).toBe("upstream-bytes");
    }
  });

  it("forwards the allowlisted list status and rejects unsupported query parameters", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    await missing("GET", "/api/fiscal/fiscal-documents", "?status=QUEUED");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "http://localhost:3001/fiscal-documents?status=QUEUED"
    );
    for (const [method, path, search] of [
      ["GET", "/api/fiscal/fiscal-documents", "?tenantId=x"],
      ["GET", `/api/fiscal/fiscal-documents/${ID}`, "?status=QUEUED"],
      ["POST", "/api/fiscal/fiscal-documents", "?status=QUEUED"],
      ["POST", `/api/fiscal/fiscal-documents/${ID}/cancel`, "?status=QUEUED"],
    ] as const) {
      fetchMock.mockReset();
      await expectError(
        await missing(method, path, search),
        404,
        "NOT_FOUND",
        "Fiscal route was not found."
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("rejects unknown paths and unsupported verbs with the uniform not-found envelope", async () => {
    for (const [method, path] of [
      ["GET", "/api/fiscal/unknown"],
      ["GET", "/api/fiscal/fiscal-documents/one/extra"],
      ["POST", `/api/fiscal/fiscal-documents/${ID}`],
      ["GET", `/api/fiscal/fiscal-documents/${ID}/cancel`],
    ] as const) {
      await expectError(
        await missing(method, path),
        404,
        "NOT_FOUND",
        "Fiscal route was not found."
      );
    }
    const module = (await import("./route")) as Record<string, unknown>;
    for (const verb of ["PATCH", "PUT", "DELETE"]) expect(module).not.toHaveProperty(verb);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed paths containing percent escapes or empty and dot segments", async () => {
    for (const pathname of [
      "/api/fiscal/fiscal-documents/%",
      "/api/fiscal/fiscal-documents//x",
      "/api/fiscal/fiscal-documents/.",
      "/api/fiscal/fiscal-documents/..",
      "/api/fiscal/fiscal-documents/",
    ]) {
      await expectError(
        await missing("GET", pathname),
        400,
        "VALIDATION_FAILED",
        "Invalid fiscal request path."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only contracted body keys and never reads bodies on shapes without contracts", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    await missing("POST", "/api/fiscal/fiscal-documents", undefined, ISSUE_BODY);
    expect(fetchInit().body).toBe(ISSUE_BODY);
    await missing("POST", `/api/fiscal/fiscal-documents/${ID}/cancel`, undefined, CANCEL_BODY);
    expect(fetchInit(1).body).toBe(CANCEL_BODY);
    // An absent or empty body is forwarded as ABSENT, never invented: the API's
    // Zod owns value validation, so a missing body is the API's 400, not this
    // proxy's. Only a PRESENT body that is not a contracted object is a local 400.
    await missing("POST", "/api/fiscal/fiscal-documents");
    expect(fetchInit(fetchMock.mock.calls.length - 1).body).toBeUndefined();
    await missing("POST", `/api/fiscal/fiscal-documents/${ID}/cancel`);
    expect(fetchInit(fetchMock.mock.calls.length - 1).body).toBeUndefined();
    const invalid = ["[]", '"text"', "12", "null", JSON.stringify({ invoiceId: ID, extra: true })];
    for (const body of invalid) {
      await expectError(
        await missing("POST", "/api/fiscal/fiscal-documents", undefined, body),
        400,
        "VALIDATION_FAILED",
        "Invalid fiscal document create body."
      );
    }
    await expectError(
      await missing(
        "POST",
        `/api/fiscal/fiscal-documents/${ID}/cancel`,
        undefined,
        JSON.stringify({ reason: "x", extra: true })
      ),
      400,
      "VALIDATION_FAILED",
      "Invalid fiscal document cancel body."
    );
    let reads = 0;
    const request = mockNextRequest({ pathname: "/api/fiscal/fiscal-documents" });
    request.text = () => {
      reads += 1;
      return Promise.resolve("unexpected");
    };
    // A GET carries no body contract, so the proxy must never read the stream;
    // it is still forwarded, with no body attached.
    await dispatch("GET", request);
    expect(reads).toBe(0);
    expect(fetchInit(fetchMock.mock.calls.length - 1).body).toBeUndefined();
  });

  it("rejects missing or empty staff sessions and never reads portal credentials", async () => {
    for (const value of [undefined, ""]) {
      const entries = value === undefined ? [] : [{ name: STAFF_SESSION_COOKIE, value }];
      cookiesMock.mockResolvedValue(cookieStore(...entries));
      await expectError(
        await missing("GET", "/api/fiscal/fiscal-documents"),
        401,
        "UNAUTHENTICATED",
        "Authentication required."
      );
    }
    cookiesMock.mockResolvedValue(cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal" }));
    await expectError(
      await missing("GET", "/api/fiscal/fiscal-documents"),
      401,
      "UNAUTHENTICATED",
      "Authentication required."
    );
    expect(cookiesMock).toHaveBeenCalledTimes(3);
    expect(
      cookiesMock.mock.results.every(
        (result) => !String(result.value).includes(PORTAL_SESSION_COOKIE)
      )
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never forwards synthesized tenant, role, permission, or user headers", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({
          "x-tenant-id": "t",
          "x-tenant-slug": "s",
          "x-user-role": "OWNER",
          "x-user-id": "u",
          "x-permissions": "all",
          "x-membership-id": "m",
        }),
      })
    );
    expect(Object.keys(fetchInit().headers)).toEqual(["cookie"]);
  });
});
