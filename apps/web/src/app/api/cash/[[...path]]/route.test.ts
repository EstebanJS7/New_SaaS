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
const SESSION_ID = "77777777-7777-4777-8777-777777777777";
/** Every movement body key the command contract defines, in one payload. */
const MOVEMENT_BODY = JSON.stringify({
  sessionId: SESSION_ID,
  type: "ADJUSTMENT",
  amount: "1500.00",
  reason: "Drawer recount",
  direction: "INCREASE",
});
const CLOSE_BODY = JSON.stringify({ countedAmount: "1500.00" });

/**
 * Every `(method, web path)` pair this proxy serves, with the upstream path and a
 * body inside the shape's contract. The three sub-collections (registers,
 * sessions, movements) form a complete six-pair `GET`/`POST` product, and the
 * session-close command adds the seventh route as a `POST`-only shape.
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
  { method: "GET", pathname: "/api/cash/movements", upstream: "/cash/movements", body: "" },
  {
    method: "POST",
    pathname: "/api/cash/movements",
    upstream: "/cash/movements",
    body: MOVEMENT_BODY,
  },
  {
    method: "POST",
    pathname: `/api/cash/sessions/${SESSION_ID}/close`,
    upstream: `/cash/sessions/${SESSION_ID}/close`,
    body: CLOSE_BODY,
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

  it("forwards the movement session filter from the allowlist", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/cash/movements", search: `?sessionId=${SESSION_ID}` })
    );

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe(`http://localhost:3001/cash/movements?sessionId=${SESSION_ID}`);
  });

  it("forwards the movement body key set unchanged and the caller's Idempotency-Key verbatim", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: SESSION_ID }, 201));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/cash/movements",
        headers: new Headers({ "Idempotency-Key": "key-abc" }),
        body: MOVEMENT_BODY,
      })
    );

    const init = fetchInit();
    expect(fetchUrl()).toBe("http://localhost:3001/cash/movements");
    expect(init.method).toBe("POST");
    // The caller's bytes are forwarded unchanged and the key is never minted.
    expect(init.body).toBe(MOVEMENT_BODY);
    expect(init.headers["Idempotency-Key"]).toBe("key-abc");
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("carries no Idempotency-Key on a movement read", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/cash/movements",
        headers: new Headers({ "Idempotency-Key": "key-abc" }),
      })
    );

    // The key belongs to the movement command alone; the read path stays thin.
    expect(Object.keys(fetchInit().headers).sort()).toEqual(["cookie"]);
  });

  it("forwards the close command's opaque session segment without validating it here", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: "not-a-uuid" }));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/cash/sessions/not-a-uuid/close",
        body: CLOSE_BODY,
      })
    );

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    // The API owns value validation; the proxy only re-encodes the segment.
    expect(call[0]).toBe("http://localhost:3001/cash/sessions/not-a-uuid/close");
    expect(call[1].body).toBe(CLOSE_BODY);
  });

  it("refuses a GET on the single-verb close shape without calling upstream", async () => {
    const response = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/cash/sessions/${SESSION_ID}/close` })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Cash route was not found." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
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

    // An unknown key on the movement list is a `.strict()` 400 upstream; refused here.
    const movementUnknownKey = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/cash/movements", search: "?registerId=abc" })
    );
    expect(movementUnknownKey.status).toBe(404);

    // The movement create accepts no query either.
    const movementCreateQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/cash/movements",
        search: `?sessionId=${SESSION_ID}`,
        body: MOVEMENT_BODY,
      })
    );
    expect(movementCreateQuery.status).toBe(404);

    // The close command declares no query at all.
    const closeQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/cash/sessions/${SESSION_ID}/close`,
        search: "?countedAmount=1500.00",
        body: CLOSE_BODY,
      })
    );
    expect(closeQuery.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports no PATCH or DELETE handler, so no cash shape can be patched or deleted", async () => {
    // The module is the whole handler for `/api/cash/[[...path]]`: Next's router
    // only dispatches a verb the module exports, so an absent `PATCH`/`DELETE`
    // export means the framework refuses those verbs BEFORE this module runs —
    // and the new movement and close shapes are no exception.
    const routeModule = (await import("./route")) as Record<string, unknown>;
    expect(routeModule).not.toHaveProperty("PATCH");
    expect(routeModule).not.toHaveProperty("DELETE");
    expect(routeModule).not.toHaveProperty("PUT");

    const verbs = Object.keys(routeModule)
      .filter((key) => /^[A-Z]+$/.test(key))
      .sort();
    expect(verbs).toEqual(["GET", "POST"]);

    fetchMock.mockReset();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports only the two verbs the cash API exposes, so no verb is smuggled in", async () => {
    // The three cash sub-collections answer both GET and POST, and the close
    // command is POST-only: the module exports exactly those two verbs and the
    // framework's router refuses anything else BEFORE this module runs, so no
    // `PATCH`, `DELETE` or `PUT` handler can exist here (proven above).
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
      `/api/cash/movements/${REGISTER_ID}`,
      `/api/cash/sessions/${REGISTER_ID}/close/extra`,
      `/api/cash/sessions/${REGISTER_ID}/reopen`,
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
      `/api/cash/sessions%2F${SESSION_ID}/close`,
      "/api/cash//registers",
      "/api/cash/registers/",
      "/api/cash/sessions//close",
      `/api/cash/sessions/${SESSION_ID}/close/`,
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

  it("rejects a credential-less movement and close request too", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const requests = [
      { method: "GET" as const, pathname: "/api/cash/movements", body: "" },
      { method: "POST" as const, pathname: "/api/cash/movements", body: MOVEMENT_BODY },
      {
        method: "POST" as const,
        pathname: `/api/cash/sessions/${SESSION_ID}/close`,
        body: CLOSE_BODY,
      },
    ];

    for (const request of requests) {
      fetchMock.mockReset();
      const response = await dispatch(request.method, mockNextRequest(request));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "UNAUTHENTICATED", message: "Authentication required." },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
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

  it("forwards only the allowlisted cookie and x-request-id headers on a read", async () => {
    // The movement-create command is the single exception: it also forwards the
    // caller-owned `Idempotency-Key`, proven by its own case below.
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

  it("rejects every out-of-contract body key on the movement and close shapes with the API's exact message", async () => {
    const movementBase = {
      sessionId: SESSION_ID,
      type: "EXPENSE",
      amount: "1500.00",
      reason: "Supplies",
    };

    // `registerId` is derived from the resolved session, `tenantId` is
    // server-resolved, `status`/`isActive`/`createdAt`/`id` are server-owned and
    // `currency`/`branchId` do not exist (DEC-020).
    for (const key of [
      "registerId",
      "tenantId",
      "status",
      "isActive",
      "currency",
      "branchId",
      "openedByMembershipId",
      "id",
      "createdAt",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: "/api/cash/movements",
          body: JSON.stringify({ ...movementBase, [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid cash movement create body." },
      });
    }

    // The close command accepts `countedAmount` alone: the server computes the
    // expected amount and the difference, writes `CLOSED`, and takes no
    // idempotency key (a second close is the stable `409`, never a replay).
    for (const key of [
      "tenantId",
      "status",
      "expectedAmount",
      "differenceAmount",
      "idempotencyKey",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: `/api/cash/sessions/${SESSION_ID}/close`,
          body: JSON.stringify({ countedAmount: "1500.00", [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid cash session close body." },
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
