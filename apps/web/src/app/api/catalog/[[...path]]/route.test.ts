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

import { GET, POST, PUT } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}

/** Encodes the given chunks as the byte stream a real request body would expose. */
function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function mockNextRequest(props: {
  pathname: string;
  search?: string;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: {
      pathname: props.pathname,
      searchParams: new URLSearchParams(props.search ?? ""),
    },
    headers: {
      get: (name: string) => headers.get(name),
    },
    body: props.body ?? null,
    // Buffering the request is the regression under test: any call is fatal.
    text: () => Promise.reject(new Error("request.text() must not be called")),
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

type Handler = (request: MockNextRequest) => Promise<Response>;

async function dispatch(
  method: "GET" | "POST" | "PUT",
  request: MockNextRequest
): Promise<Response> {
  const handlers: Record<typeof method, Handler> = {
    GET: (value) => GET(value as unknown as Parameters<typeof GET>[0]),
    POST: (value) => POST(value as unknown as Parameters<typeof POST>[0]),
    PUT: (value) => PUT(value as unknown as Parameters<typeof PUT>[0]),
  };
  return handlers[method](request);
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: ReadableStream<Uint8Array>;
  duplex?: "half";
}

function fetchUrl(callIndex = 0): string {
  return (fetchMock.mock.calls[callIndex] as unknown as [string])[0];
}

function fetchInit(callIndex = 0): FetchInit {
  return (fetchMock.mock.calls[callIndex] as unknown as [string, FetchInit])[1];
}

function upstreamOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Every `(method, web path)` pair WU2 actually serves, with its upstream path.
 * This table is the positive half of the allowlist contract: it is also the
 * exact set the negative cases below must stay outside of.
 */
const SERVED_ROUTES = [
  { method: "GET", pathname: "/api/catalog", upstream: "/catalog" },
  { method: "GET", pathname: `/api/catalog/${ITEM_ID}`, upstream: `/catalog/${ITEM_ID}` },
  { method: "GET", pathname: "/api/catalog/tax-rates", upstream: "/catalog/tax-rates" },
  { method: "POST", pathname: "/api/catalog", upstream: "/catalog" },
  {
    method: "POST",
    pathname: `/api/catalog/${ITEM_ID}/deactivate`,
    upstream: `/catalog/${ITEM_ID}/deactivate`,
  },
  { method: "PUT", pathname: `/api/catalog/${ITEM_ID}`, upstream: `/catalog/${ITEM_ID}` },
] as const;

describe("/api/catalog proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards every served (method, path-shape) pair with the staff session cookie", async () => {
    for (const route of SERVED_ROUTES) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(upstreamOk({ ok: true }));

      const request = mockNextRequest({
        pathname: route.pathname,
        body: route.method === "GET" ? null : byteStream(["{}"]),
      });

      await dispatch(route.method, request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchUrl()).toBe(`http://localhost:3001${route.upstream}`);
      expect(fetchInit().method).toBe(route.method);
      expect(fetchInit().headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    }
  });

  it("forwards the kind and isActive list filters in allowlist order", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({
      pathname: "/api/catalog",
      search: `?isActive=false&kind=SERVICE`,
    });

    await dispatch("GET", request);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/catalog?kind=SERVICE&isActive=false");
  });

  it("refuses an unknown query key and a query on a shape that takes none", async () => {
    // `.strict()` upstream would 400 on `admin`; this boundary refuses it first.
    const unknownKey = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/catalog", search: "?admin=true" })
    );
    expect(unknownKey.status).toBe(404);

    // The item read and the rate list accept no query at all.
    const itemQuery = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/catalog/${ITEM_ID}`, search: "?kind=SERVICE" })
    );
    expect(itemQuery.status).toBe(404);

    const ratesQuery = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/catalog/tax-rates", search: "?isActive=true" })
    );
    expect(ratesQuery.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a known path reached with a method the API does not expose", async () => {
    // PUT is not exposed on the collection root (list/create only).
    const putRoot = await dispatch(
      "PUT",
      mockNextRequest({ pathname: "/api/catalog", body: byteStream(["{}"]) })
    );
    expect(putRoot.status).toBe(405);
    expect(await putRoot.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Catalog route does not support this method.",
      },
    });

    // The global rate list is read-only.
    const postRates = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/catalog/tax-rates", body: byteStream(["{}"]) })
    );
    expect(postRates.status).toBe(405);

    // Deactivation is POST-only.
    const getDeactivate = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/catalog/${ITEM_ID}/deactivate` })
    );
    expect(getDeactivate.status).toBe(405);

    // An item is created through the collection root, not through `/:id`.
    const postItem = await dispatch(
      "POST",
      mockNextRequest({ pathname: `/api/catalog/${ITEM_ID}`, body: byteStream(["{}"]) })
    );
    expect(postItem.status).toBe(405);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or extra path with the not-found envelope", async () => {
    for (const pathname of [
      "/api/catalog/items",
      `/api/catalog/${ITEM_ID}/activate`,
      "/api/catalog/not-a-uuid",
      `/api/catalog/${ITEM_ID}/deactivate/extra`,
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Catalog route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, encoded separators and empty segments as malformed requests", async () => {
    for (const pathname of [
      "/api/catalog/../patients",
      "/api/catalog/tax-rates%2Fdeactivate",
      "/api/catalog//tax-rates",
      "/api/catalog/tax-rates/",
      "/api/catalog/",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid catalog request path." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose only credential is the portal session cookie", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal-token" })
    );

    const request = mockNextRequest({
      pathname: "/api/catalog",
      headers: new Headers({ cookie: `${PORTAL_SESSION_COOKIE}=portal-token` }),
    });

    const response = await dispatch("GET", request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no session cookie at all, without calling upstream", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const response = await dispatch("GET", mockNextRequest({ pathname: "/api/catalog" }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never forwards the portal cookie, even when the browser holds both sessions", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore(
        { name: STAFF_SESSION_COOKIE, value: "token-123" },
        { name: PORTAL_SESSION_COOKIE, value: "portal-token" }
      )
    );
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({
      pathname: "/api/catalog",
      headers: new Headers({
        cookie: `${PORTAL_SESSION_COOKIE}=portal-token; ${STAFF_SESSION_COOKIE}=token-123`,
      }),
    });

    await dispatch("GET", request);

    const init = fetchInit();
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers.cookie).not.toContain("portal-token");
  });

  it("forwards only the allowlisted cookie and x-request-id headers", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({
      pathname: "/api/catalog",
      headers: new Headers({
        "x-request-id": "req-abc",
        cookie: "browser=should-be-dropped",
        authorization: "Bearer browser-token",
        "x-forwarded-for": "203.0.113.7",
      }),
    });

    await dispatch("GET", request);

    const init = fetchInit();
    expect(Object.keys(init.headers).sort()).toEqual(["cookie", "x-request-id"]);
    expect(init.headers["x-request-id"]).toBe("req-abc");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("forwards the PUT body as the caller's raw stream without buffering", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: ITEM_ID }));

    const body = byteStream([JSON.stringify({ name: "Consultation" })]);
    const request = mockNextRequest({
      pathname: `/api/catalog/${ITEM_ID}`,
      body,
    });

    await dispatch("PUT", request);

    const init = fetchInit();
    expect(init.method).toBe("PUT");
    // Identity proves the raw ReadableStream was piped through, not decoded.
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
    expect(init.headers).toEqual({
      cookie: `${STAFF_SESSION_COOKIE}=token-123`,
      "content-type": "application/json",
    });
  });

  it("streams the upstream response body and preserves status and x-request-id", async () => {
    const upstreamStream = byteStream(["raw", "-bytes"]);
    fetchMock.mockResolvedValue(
      new Response(upstreamStream, {
        status: 409,
        headers: { "content-type": "application/json", "x-request-id": "req-upstream" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/catalog",
      body: byteStream(["{}"]),
    });

    const response = await dispatch("POST", request);

    expect(response.status).toBe(409);
    expect(response.body).toBe(upstreamStream);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
  });

  it("preserves the upstream 400 and 403 envelopes unchanged", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "Bad rate." } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    const invalid = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/catalog", body: byteStream(["{}"]) })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Bad rate." },
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Access denied." } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );

    const forbidden = await dispatch("GET", mockNextRequest({ pathname: "/api/catalog" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Access denied." },
    });
  });
});
