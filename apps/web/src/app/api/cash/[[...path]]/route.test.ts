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

import { GET, POST } from "./route";

const REGISTER_ID = "55555555-5555-4555-8555-555555555555";

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
    nextUrl: {
      pathname: props.pathname,
      searchParams: new URLSearchParams(props.search ?? ""),
    },
    headers: {
      get: (name: string) => headers.get(name),
    },
    // The proxy reads the body once to check its key set and must forward the
    // caller's bytes unchanged; this double returns exactly one of those.
    text: () => Promise.resolve(props.body ?? ""),
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

const REGISTER_BODY = JSON.stringify({ name: "Front desk" });
const SESSION_BODY = JSON.stringify({ registerId: REGISTER_ID, openingAmount: "0.00" });

/**
 * Every `(method, web path)` pair this proxy serves, with the upstream path and a
 * body inside the shape's contract. The cash API exposes exactly these four
 * routes and nothing else — no `PATCH`, no `DELETE` and no close command
 * (EPIC-13).
 */
const SERVED_ROUTES = [
  { method: "GET", pathname: "/api/cash/registers", upstream: "/cash/registers", body: "" },
  {
    method: "POST",
    pathname: "/api/cash/registers",
    upstream: "/cash/registers",
    body: REGISTER_BODY,
  },
  { method: "GET", pathname: "/api/cash/sessions", upstream: "/cash/sessions", body: "" },
  {
    method: "POST",
    pathname: "/api/cash/sessions",
    upstream: "/cash/sessions",
    body: SESSION_BODY,
  },
] as const;

describe("/api/cash proxy", () => {
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

      await dispatch(route.method, mockNextRequest({ pathname: route.pathname, body: route.body }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchUrl()).toBe(`http://localhost:3001${route.upstream}`);
      expect(fetchInit().method).toBe(route.method);
      expect(fetchInit().headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    }
  });

  it("forwards the session status filter from the allowlist", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/cash/sessions", search: "?status=OPEN" })
    );

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/cash/sessions?status=OPEN");
  });

  it("refuses a query the shape's contract does not define", async () => {
    // The register list declares no query at all.
    const registerQuery = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/cash/registers", search: "?status=OPEN" })
    );
    expect(registerQuery.status).toBe(404);
    expect(await registerQuery.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Cash route was not found." },
    });

    // An unknown key on the session list is a `.strict()` 400 upstream; refused here.
    const unknownKey = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/cash/sessions", search: "?tenantId=tenant-b" })
    );
    expect(unknownKey.status).toBe(404);

    // A mutating verb accepts no query either.
    const openQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/cash/sessions",
        search: "?status=OPEN",
        body: SESSION_BODY,
      })
    );
    expect(openQuery.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports only the two verbs the cash API exposes, so no verb is smuggled in", async () => {
    // Every cash shape answers both GET and POST, so the four reachable pairs are
    // the complete method×shape product: the module exports exactly those two
    // verbs and the framework's router refuses anything else BEFORE this module
    // runs. There is therefore no method-mismatch envelope to keep in sync.
    const routeModule = await import("./route");
    const verbs = Object.keys(routeModule)
      .filter((key) => /^[A-Z]+$/.test(key))
      .sort();
    expect(verbs).toEqual(["GET", "POST"]);

    fetchMock.mockReset();
    const unknownShape = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/cash/registers/movements" })
    );
    expect(unknownShape.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or extra path with the not-found envelope", async () => {
    for (const pathname of [
      "/api/cash",
      `/api/cash/registers/${REGISTER_ID}`,
      `/api/cash/sessions/${REGISTER_ID}/close`,
      "/api/cash/movements",
      "/api/cash/registers/extra",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Cash route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, encoded separators and empty segments as malformed requests", async () => {
    for (const pathname of [
      "/api/cash/../sales",
      `/api/cash/registers%2F${REGISTER_ID}`,
      "/api/cash//registers",
      "/api/cash/registers/",
      "/api/cash/",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid cash request path." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose only credential is the portal session cookie", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal-token" })
    );

    const response = await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/cash/registers",
        headers: new Headers({ cookie: `${PORTAL_SESSION_COOKIE}=portal-token` }),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no session cookie at all, without calling upstream", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const response = await dispatch("GET", mockNextRequest({ pathname: "/api/cash/registers" }));

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

    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/cash/registers",
        headers: new Headers({
          cookie: `${PORTAL_SESSION_COOKIE}=portal-token; ${STAFF_SESSION_COOKIE}=token-123`,
        }),
      })
    );

    const init = fetchInit();
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers.cookie).not.toContain("portal-token");
  });

  it("forwards only the allowlisted cookie and x-request-id headers", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/cash/sessions",
        headers: new Headers({
          "x-request-id": "req-abc",
          cookie: "browser=should-be-dropped",
          authorization: "Bearer browser-token",
          "x-forwarded-for": "203.0.113.7",
          "idempotency-key": "not-a-cash-concept",
        }),
      })
    );

    const init = fetchInit();
    expect(Object.keys(init.headers).sort()).toEqual(["cookie", "x-request-id"]);
    expect(init.headers["x-request-id"]).toBe("req-abc");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.headers).not.toHaveProperty("x-forwarded-for");
    expect(init.headers).not.toHaveProperty("idempotency-key");
  });

  it("adds no header the API would trust as tenant, opener or permission context", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/cash/registers",
        headers: new Headers({
          "x-tenant-id": "tenant-b",
          "x-tenant-slug": "attacker-clinic",
          "x-permissions": "cash.session.open",
          "x-user-role": "OWNER",
          "x-membership-id": "membership-b",
        }),
      })
    );

    const init = fetchInit();
    expect(Object.keys(init.headers)).toEqual(["cookie"]);
    for (const forbidden of [
      "x-tenant-id",
      "x-tenant-slug",
      "x-permissions",
      "x-user-role",
      "x-membership-id",
      "x-forwarded-host",
    ]) {
      expect(init.headers).not.toHaveProperty(forbidden);
    }
  });

  it("rejects a client-supplied tenantId instead of treating it as authority", async () => {
    const cases = [
      {
        pathname: "/api/cash/registers",
        body: JSON.stringify({ name: "Front desk", tenantId: "tenant-b" }),
        message: "Invalid cash register create body.",
      },
      {
        pathname: "/api/cash/sessions",
        body: JSON.stringify({
          registerId: REGISTER_ID,
          openingAmount: "0.00",
          tenantId: "tenant-b",
        }),
        message: "Invalid cash session open body.",
      },
    ];

    for (const testCase of cases) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({ pathname: testCase.pathname, body: testCase.body })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: testCase.message },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects every body key the shape's strict schema excludes", async () => {
    // `cash.zod.ts` names each of these: `isActive` and `status` are server-owned,
    // `branchId` and `currency` do not exist (DEC-020), and
    // `openedByMembershipId` is resolved from the authenticated context.
    for (const key of ["isActive", "branchId", "status", "tenantId"]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: "/api/cash/registers",
          body: JSON.stringify({ name: "Front desk", [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid cash register create body." },
      });
    }

    for (const key of [
      "status",
      "openedByMembershipId",
      "currency",
      "branchId",
      "tenantId",
      "openedAt",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: "/api/cash/sessions",
          body: JSON.stringify({
            registerId: REGISTER_ID,
            openingAmount: "0.00",
            [key]: "anything",
          }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid cash session open body." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not a JSON object", async () => {
    for (const body of ["not json", "[]", '"a string"', "12", "null"]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({ pathname: "/api/cash/registers", body })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid cash register create body." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the mutating body byte-for-byte, never re-encoded", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: REGISTER_ID }, 201));

    // A payload whose whitespace would change under a re-encode.
    const body = `{ "name" :  "Front desk" }`;

    const response = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/cash/registers", body })
    );

    expect(response.status).toBe(201);
    const init = fetchInit();
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(init.headers).toEqual({
      cookie: `${STAFF_SESSION_COOKIE}=token-123`,
      "content-type": "application/json",
    });
    expect(init.cache).toBe("no-store");
  });

  it("streams the upstream response body and preserves status and x-request-id", async () => {
    const upstreamStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("raw-bytes"));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(upstreamStream, {
        status: 201,
        headers: { "content-type": "application/json", "x-request-id": "req-upstream" },
      })
    );

    const response = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/cash/sessions", body: SESSION_BODY })
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
  });

  it("preserves the upstream 400, 403, 404 and 409 envelopes unchanged", async () => {
    const envelopes = [
      {
        status: 400,
        body: {
          error: { code: "VALIDATION_FAILED", message: "Invalid cash session open body." },
        },
      },
      {
        status: 403,
        body: {
          error: {
            code: "FEATURE_NOT_ENTITLED",
            message: "Cash features are not enabled for this tenant.",
          },
        },
      },
      {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Access denied." } },
      },
      {
        status: 404,
        body: {
          error: { code: "NOT_FOUND", message: "Cash register was not found.", requestId: "req-1" },
        },
      },
      {
        status: 409,
        body: {
          error: {
            code: "CONFLICT",
            message: "A cash register with this name already exists in this tenant.",
          },
        },
      },
      {
        status: 409,
        body: {
          error: { code: "CONFLICT", message: "This cash register already has an open session." },
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
        mockNextRequest({ pathname: "/api/cash/sessions", body: SESSION_BODY })
      );

      expect(response.status).toBe(envelope.status);
      // Byte-equivalent: the proxy neither rewrites nor adds a field.
      expect(await response.json()).toEqual(envelope.body);
    }
  });
});
