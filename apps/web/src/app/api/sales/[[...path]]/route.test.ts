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

const SALE_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

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

const CREATE_BODY = JSON.stringify({
  customerId: CUSTOMER_ID,
  lines: [{ catalogItemId: ITEM_ID, quantity: "2.000", unitPrice: "1500.00" }],
});
const COMPLETE_BODY = JSON.stringify({ payments: [{ method: "CASH", amount: "3000.00" }] });

/**
 * Every `(method, web path)` pair this proxy serves, with the upstream path and a
 * body that is inside the shape's contract. This table is the positive half of
 * the allowlist contract: it is also the exact set the negative cases below must
 * stay outside of. The sale API exposes six routes and nothing else — no `PATCH`,
 * no `DELETE`, and no close-style nested command.
 */
const SERVED_ROUTES = [
  { method: "GET", pathname: "/api/sales", upstream: "/sales", body: "" },
  {
    method: "GET",
    pathname: `/api/sales/${SALE_ID}`,
    upstream: `/sales/${SALE_ID}`,
    body: "",
  },
  { method: "POST", pathname: "/api/sales", upstream: "/sales", body: CREATE_BODY },
  {
    method: "PUT",
    pathname: `/api/sales/${SALE_ID}`,
    upstream: `/sales/${SALE_ID}`,
    body: CREATE_BODY,
  },
  {
    method: "POST",
    pathname: `/api/sales/${SALE_ID}/cancel`,
    upstream: `/sales/${SALE_ID}/cancel`,
    body: "{}",
  },
  {
    method: "POST",
    pathname: `/api/sales/${SALE_ID}/complete`,
    upstream: `/sales/${SALE_ID}/complete`,
    body: COMPLETE_BODY,
  },
] as const;

describe("/api/sales proxy", () => {
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
        body: route.body,
      });

      await dispatch(route.method, request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchUrl()).toBe(`http://localhost:3001${route.upstream}`);
      expect(fetchInit().method).toBe(route.method);
      expect(fetchInit().headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    }
  });

  it("forwards the status list filter from the allowlist", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({ pathname: "/api/sales", search: "?status=DRAFT" });

    await dispatch("GET", request);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/sales?status=DRAFT");
  });

  it("refuses an unknown query key and a query on a shape that takes none", async () => {
    // `.strict()` upstream would 400 on `tenantId`; this boundary refuses it first.
    const unknownKey = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/sales", search: "?tenantId=tenant-b" })
    );
    expect(unknownKey.status).toBe(404);
    expect(await unknownKey.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Sale route was not found." },
    });

    // The item read and the two transition commands accept no query at all.
    const itemQuery = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}`, search: "?status=DRAFT" })
    );
    expect(itemQuery.status).toBe(404);

    const cancelQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/sales/${SALE_ID}/cancel`,
        search: "?force=true",
        body: "{}",
      })
    );
    expect(cancelQuery.status).toBe(404);

    const completeQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/sales/${SALE_ID}/complete`,
        search: "?status=COMPLETED",
        body: COMPLETE_BODY,
      })
    );
    expect(completeQuery.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a known path reached with a method the API does not expose", async () => {
    // PUT is not exposed on the collection root (list/create only).
    const putRoot = await dispatch(
      "PUT",
      mockNextRequest({ pathname: "/api/sales", body: CREATE_BODY })
    );
    expect(putRoot.status).toBe(405);
    expect(await putRoot.json()).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Sale route does not support this method." },
    });

    // A sale is created through the collection root, not through `/:id`.
    const postItem = await dispatch(
      "POST",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}`, body: CREATE_BODY })
    );
    expect(postItem.status).toBe(405);

    // Both transition commands are POST-only.
    const getCancel = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}/cancel` })
    );
    expect(getCancel.status).toBe(405);

    const getComplete = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}/complete` })
    );
    expect(getComplete.status).toBe(405);

    const putComplete = await dispatch(
      "PUT",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}/complete`, body: COMPLETE_BODY })
    );
    expect(putComplete.status).toBe(405);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or extra path with the not-found envelope", async () => {
    for (const pathname of [
      "/api/sales/orders",
      `/api/sales/${SALE_ID}/approve`,
      "/api/sales/not-a-uuid",
      `/api/sales/${SALE_ID}/complete/extra`,
      "/api/sales/registers",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Sale route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, encoded separators and empty segments as malformed requests", async () => {
    for (const pathname of [
      "/api/sales/../patients",
      `/api/sales/${SALE_ID}%2Fcancel`,
      "/api/sales//cancel",
      "/api/sales/",
      `/api/sales/${SALE_ID}/`,
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid sale request path." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose only credential is the portal session cookie", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal-token" })
    );

    const request = mockNextRequest({
      pathname: "/api/sales",
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

    const response = await dispatch("GET", mockNextRequest({ pathname: "/api/sales" }));

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
      pathname: "/api/sales",
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
      pathname: "/api/sales",
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
      pathname: "/api/sales",
      headers: new Headers({
        "x-tenant-id": "tenant-b",
        "x-tenant-slug": "attacker-clinic",
        "x-permissions": "sales.complete",
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

  it("rejects a client-supplied tenantId in the body instead of treating it as authority", async () => {
    // The browser cannot re-scope a create, an update or a completion: the tenant
    // is resolved from the session alone, and the body key is refused here with
    // the API's own message (a wasted hop it would have answered identically).
    const cases = [
      {
        pathname: "/api/sales",
        method: "POST" as const,
        message: "Invalid sale create body.",
      },
      {
        pathname: `/api/sales/${SALE_ID}`,
        method: "PUT" as const,
        message: "Invalid sale update body.",
      },
      {
        pathname: `/api/sales/${SALE_ID}/complete`,
        method: "POST" as const,
        message: "Invalid sale completion body.",
      },
    ];

    for (const testCase of cases) {
      fetchMock.mockReset();
      const response = await dispatch(
        testCase.method,
        mockNextRequest({
          pathname: testCase.pathname,
          body: JSON.stringify({
            tenantId: "tenant-b",
            lines: [],
            payments: [],
          }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: testCase.message },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects every body key the shape's strict schema excludes", async () => {
    // Each key below is named by `sales.zod.ts` as server-owned or non-existent:
    // `status` (server lifecycle), `currency` (server-derived), `total`
    // (derived, no column), `number` (no numbering column, DEC-027), `id` (line
    // identity is `catalogItemId`) and the discount field DEC-028 does not define.
    for (const key of ["status", "currency", "total", "number", "discount"]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: "/api/sales",
          body: JSON.stringify({ lines: [], [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid sale create body." },
      });
    }

    // The update shape accepts `customerId` and `lines` only.
    for (const key of ["status", "currency", "total"]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "PUT",
        mockNextRequest({
          pathname: `/api/sales/${SALE_ID}`,
          body: JSON.stringify({ lines: [], [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid sale update body." },
      });
    }

    // The completion shape accepts `payments` only.
    for (const key of ["status", "tenantId", "replay"]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: `/api/sales/${SALE_ID}/complete`,
          body: JSON.stringify({ payments: [], [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid sale completion body." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a cancel body that carries a field, and accepts the empty object", async () => {
    // The cancel command declares no body, so a field is out of contract.
    const fielded = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/sales/${SALE_ID}/cancel`,
        body: JSON.stringify({ reason: "mistake" }),
      })
    );
    expect(fielded.status).toBe(400);
    expect(await fielded.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Invalid sale cancel body." },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // The client's `{}` and a body-less request both stay valid.
    fetchMock.mockResolvedValue(upstreamOk({ status: "CANCELLED" }, 201));
    const emptyObject = await dispatch(
      "POST",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}/cancel`, body: "{}" })
    );
    expect(emptyObject.status).toBe(201);

    const bodyless = await dispatch(
      "POST",
      mockNextRequest({ pathname: `/api/sales/${SALE_ID}/cancel` })
    );
    expect(bodyless.status).toBe(201);
  });

  it("rejects a body that is not a JSON object", async () => {
    for (const body of ["not json", "[]", '"a string"', "12", "null"]) {
      fetchMock.mockReset();
      const response = await dispatch("POST", mockNextRequest({ pathname: "/api/sales", body }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid sale create body." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the mutating body byte-for-byte, never re-encoded", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: SALE_ID }, 201));

    // A payload whose key order and whitespace would change under a re-encode.
    const body = `{ "lines" : [ { "catalogItemId" : "${ITEM_ID}", "quantity" : "2.000" } ] }`;

    const response = await dispatch("POST", mockNextRequest({ pathname: "/api/sales", body }));

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

  it("forwards the caller's Idempotency-Key on the completion command", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: SALE_ID, replay: false }, 201));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/sales/${SALE_ID}/complete`,
        body: COMPLETE_BODY,
        headers: new Headers({ "idempotency-key": "counter-1-abc" }),
      })
    );

    expect(fetchInit().headers["idempotency-key"]).toBe("counter-1-abc");
  });

  it("never invents an Idempotency-Key when the caller sent none", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: SALE_ID, replay: false }, 201));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/sales/${SALE_ID}/complete`,
        body: COMPLETE_BODY,
      })
    );

    const init = fetchInit();
    expect(init.headers).not.toHaveProperty("idempotency-key");
    expect(Object.keys(init.headers).sort()).toEqual(["content-type", "cookie"]);
  });

  it("drops an Idempotency-Key on every shape but the completion command", async () => {
    // The header is part of the completion contract alone; on any other shape it
    // is dropped exactly like every other non-allowlisted browser header.
    for (const route of [
      { method: "POST" as const, pathname: "/api/sales", body: CREATE_BODY },
      { method: "PUT" as const, pathname: `/api/sales/${SALE_ID}`, body: CREATE_BODY },
      { method: "POST" as const, pathname: `/api/sales/${SALE_ID}/cancel`, body: "{}" },
    ]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(upstreamOk({ ok: true }));

      await dispatch(
        route.method,
        mockNextRequest({
          pathname: route.pathname,
          body: route.body,
          headers: new Headers({ "idempotency-key": "counter-1-abc" }),
        })
      );

      expect(fetchInit().headers).not.toHaveProperty("idempotency-key");
    }
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
      mockNextRequest({
        pathname: `/api/sales/${SALE_ID}/complete`,
        body: COMPLETE_BODY,
      })
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
  });

  it("preserves the completion 201/200 distinction and the upstream envelopes unchanged", async () => {
    const envelopes = [
      {
        status: 201,
        body: { id: SALE_ID, status: "COMPLETED", replay: false, payments: [] },
      },
      {
        status: 200,
        body: { id: SALE_ID, status: "COMPLETED", replay: true, payments: [] },
      },
      {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_FAILED",
            message: "The payments must sum exactly to the sale total.",
          },
        },
      },
      {
        status: 403,
        body: {
          error: {
            code: "FEATURE_NOT_ENTITLED",
            message: "Sales features are not enabled for this tenant.",
          },
        },
      },
      {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Access denied." } },
      },
      {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Sale was not found.", requestId: "req-1" } },
      },
      {
        status: 409,
        body: {
          error: {
            code: "CONFLICT",
            message: "Only a draft sale can be changed.",
            requestId: "req-2",
          },
        },
      },
      {
        status: 409,
        body: {
          error: { code: "CONFLICT", message: "A cash payment requires an open cash session." },
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
        mockNextRequest({
          pathname: `/api/sales/${SALE_ID}/complete`,
          body: COMPLETE_BODY,
        })
      );

      expect(response.status).toBe(envelope.status);
      // Byte-equivalent: the proxy neither rewrites nor adds a field.
      expect(await response.json()).toEqual(envelope.body);
    }
  });
});
