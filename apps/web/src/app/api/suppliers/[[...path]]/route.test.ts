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

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";

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
 * Every `(method, web path)` pair this proxy serves, with its upstream path.
 * This table is the positive half of the allowlist contract: it is also the
 * exact set the negative cases below must stay outside of. The supplier API
 * exposes five unprefixed routes and nothing else — no `PATCH`, no `DELETE`.
 */
const SERVED_ROUTES = [
  { method: "GET", pathname: "/api/suppliers", upstream: "/suppliers" },
  {
    method: "GET",
    pathname: `/api/suppliers/${SUPPLIER_ID}`,
    upstream: `/suppliers/${SUPPLIER_ID}`,
  },
  { method: "POST", pathname: "/api/suppliers", upstream: "/suppliers" },
  {
    method: "PUT",
    pathname: `/api/suppliers/${SUPPLIER_ID}`,
    upstream: `/suppliers/${SUPPLIER_ID}`,
  },
  {
    method: "POST",
    pathname: `/api/suppliers/${SUPPLIER_ID}/deactivate`,
    upstream: `/suppliers/${SUPPLIER_ID}/deactivate`,
  },
] as const;

describe("/api/suppliers proxy", () => {
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

  it("forwards the isActive list filter from the allowlist", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({ pathname: "/api/suppliers", search: "?isActive=false" });

    await dispatch("GET", request);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/suppliers?isActive=false");
  });

  it("refuses an unknown query key and a query on a shape that takes none", async () => {
    // `.strict()` upstream would 400 on `tenantId`; this boundary refuses it first.
    const unknownKey = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/suppliers", search: "?tenantId=tenant-b" })
    );
    expect(unknownKey.status).toBe(404);

    // The item read and the deactivate command accept no query at all.
    const itemQuery = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/suppliers/${SUPPLIER_ID}`, search: "?isActive=true" })
    );
    expect(itemQuery.status).toBe(404);

    const deactivateQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/suppliers/${SUPPLIER_ID}/deactivate`,
        search: "?force=true",
        body: byteStream(["{}"]),
      })
    );
    expect(deactivateQuery.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a known path reached with a method the API does not expose", async () => {
    // PUT is not exposed on the collection root (list/create only).
    const putRoot = await dispatch(
      "PUT",
      mockNextRequest({ pathname: "/api/suppliers", body: byteStream(["{}"]) })
    );
    expect(putRoot.status).toBe(405);
    expect(await putRoot.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Supplier route does not support this method.",
      },
    });

    // An item is created through the collection root, not through `/:id`.
    const postItem = await dispatch(
      "POST",
      mockNextRequest({ pathname: `/api/suppliers/${SUPPLIER_ID}`, body: byteStream(["{}"]) })
    );
    expect(postItem.status).toBe(405);

    // Deactivation is POST-only.
    const getDeactivate = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/suppliers/${SUPPLIER_ID}/deactivate` })
    );
    expect(getDeactivate.status).toBe(405);

    const putDeactivate = await dispatch(
      "PUT",
      mockNextRequest({
        pathname: `/api/suppliers/${SUPPLIER_ID}/deactivate`,
        body: byteStream(["{}"]),
      })
    );
    expect(putDeactivate.status).toBe(405);

    // There is no delete and no patch command anywhere on this surface.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or extra path with the not-found envelope", async () => {
    for (const pathname of [
      "/api/suppliers/vendors",
      `/api/suppliers/${SUPPLIER_ID}/activate`,
      "/api/suppliers/not-a-uuid",
      `/api/suppliers/${SUPPLIER_ID}/deactivate/extra`,
      "/api/suppliers/purchases",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Supplier route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, encoded separators and empty segments as malformed requests", async () => {
    for (const pathname of [
      "/api/suppliers/../patients",
      `/api/suppliers/${SUPPLIER_ID}%2Fdeactivate`,
      "/api/suppliers//deactivate",
      "/api/suppliers/",
      `/api/suppliers/${SUPPLIER_ID}/`,
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid supplier request path." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose only credential is the portal session cookie", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal-token" })
    );

    const request = mockNextRequest({
      pathname: "/api/suppliers",
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

    const response = await dispatch("GET", mockNextRequest({ pathname: "/api/suppliers" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
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
      pathname: "/api/suppliers",
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
      pathname: "/api/suppliers",
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

  it("adds no header the API would trust as tenant or permission context", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    // Even when the browser claims a tenant and a permission, nothing but the
    // session cookie crosses: the API resolves the tenant server-side.
    const request = mockNextRequest({
      pathname: "/api/suppliers",
      headers: new Headers({
        "x-tenant-id": "tenant-b",
        "x-tenant-slug": "attacker-clinic",
        "x-permissions": "suppliers.deactivate",
        "x-user-role": "OWNER",
      }),
    });

    await dispatch("GET", request);

    const init = fetchInit();
    expect(Object.keys(init.headers)).toEqual(["cookie"]);
    for (const forbidden of [
      "x-tenant-id",
      "x-tenant-slug",
      "x-permissions",
      "x-user-role",
      "x-forwarded-host",
    ]) {
      expect(init.headers).not.toHaveProperty(forbidden);
    }
  });

  it("forwards the PUT body as the caller's raw stream without buffering", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: SUPPLIER_ID }));

    const body = byteStream([JSON.stringify({ name: "Distribuidora Central" })]);
    const request = mockNextRequest({
      pathname: `/api/suppliers/${SUPPLIER_ID}`,
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
        status: 201,
        headers: { "content-type": "application/json", "x-request-id": "req-upstream" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/suppliers",
      body: byteStream(["{}"]),
    });

    const response = await dispatch("POST", request);

    expect(response.status).toBe(201);
    expect(response.body).toBe(upstreamStream);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
  });

  it("preserves the upstream 400, 403, 404 and 409 envelopes unchanged", async () => {
    const envelopes = [
      {
        status: 400,
        body: { error: { code: "VALIDATION_FAILED", message: "Invalid supplier create body." } },
      },
      {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Access denied." } },
      },
      {
        status: 404,
        body: {
          error: { code: "NOT_FOUND", message: "Supplier was not found.", requestId: "req-1" },
        },
      },
      {
        status: 409,
        body: {
          error: {
            code: "CONFLICT",
            message: "A supplier with this tax identifier already exists in this tenant.",
            requestId: "req-2",
          },
        },
      },
    ] as const;

    for (const envelope of envelopes) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(envelope.body), {
          status: envelope.status,
          headers: { "content-type": "application/json" },
        })
      );

      const response = await dispatch(
        "POST",
        mockNextRequest({ pathname: "/api/suppliers", body: byteStream(["{}"]) })
      );

      expect(response.status).toBe(envelope.status);
      // Byte-equivalent: the proxy neither rewrites nor adds a field.
      expect(await response.json()).toEqual(envelope.body);
    }
  });
});
