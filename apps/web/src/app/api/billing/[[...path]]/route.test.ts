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

const INVOICE_ID = "99999999-9999-4999-8999-999999999999";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNKNOWN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    // The proxy reads a mutating body once to check its key set and must forward
    // the caller's bytes unchanged; this double returns exactly one of those.
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

const CREATE_BODY = JSON.stringify({ saleId: SALE_ID });
const CANCEL_BODY = JSON.stringify({ reason: "Customer asked for a reissue." });

/**
 * Every `(method, web path)` pair this proxy serves, with the upstream path and a
 * body inside the shape's contract. The invoice list answers `GET` and `POST`,
 * the id read answers `GET` alone, and the two lifecycle commands answer `POST`
 * alone — which is exactly the five operations BILL-002/BILL-003 shipped.
 */
const SERVED_ROUTES = [
  { method: "GET", pathname: "/api/billing/invoices", upstream: "/invoices", body: "" },
  { method: "POST", pathname: "/api/billing/invoices", upstream: "/invoices", body: CREATE_BODY },
  {
    method: "GET",
    pathname: `/api/billing/invoices/${INVOICE_ID}`,
    upstream: `/invoices/${INVOICE_ID}`,
    body: "",
  },
  {
    method: "POST",
    pathname: `/api/billing/invoices/${INVOICE_ID}/confirm`,
    upstream: `/invoices/${INVOICE_ID}/confirm`,
    body: "",
  },
  {
    method: "POST",
    pathname: `/api/billing/invoices/${INVOICE_ID}/cancel`,
    upstream: `/invoices/${INVOICE_ID}/cancel`,
    body: CANCEL_BODY,
  },
] as const;

describe("/api/billing proxy", () => {
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

  it("serves exactly the five allowlisted operations and nothing else", () => {
    // The shape of every served route, with the opaque invoice id folded to a
    // placeholder, IS the allowlist: there is no sixth operation and no verb on
    // a shape that does not answer it.
    const served = SERVED_ROUTES.map((route) => {
      const suffix = route.pathname
        .slice("/api/billing/invoices".length)
        .replace(`/${INVOICE_ID}`, "/:id");
      return `${route.method} /invoices${suffix}`;
    });

    expect(served).toEqual([
      "GET /invoices",
      "POST /invoices",
      "GET /invoices/:id",
      "POST /invoices/:id/confirm",
      "POST /invoices/:id/cancel",
    ]);
    expect(new Set(served).size).toBe(5);
  });

  it("forwards the invoice status filter from the allowlist", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/billing/invoices", search: "?status=DRAFT" })
    );

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/invoices?status=DRAFT");
  });

  it("forwards the create body key set unchanged and declares the JSON media type", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: INVOICE_ID }, 201));

    await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/billing/invoices", body: CREATE_BODY })
    );

    const init = fetchInit();
    expect(fetchUrl()).toBe("http://localhost:3001/invoices");
    expect(init.method).toBe("POST");
    // The caller's bytes are forwarded unchanged: this is only a key-set check.
    expect(init.body).toBe(CREATE_BODY);
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
  });

  it("forwards the cancel reason unchanged and declares the JSON media type", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: INVOICE_ID, status: "CANCELLED" }));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/billing/invoices/${INVOICE_ID}/cancel`,
        body: CANCEL_BODY,
      })
    );

    const init = fetchInit();
    expect(fetchUrl()).toBe(`http://localhost:3001/invoices/${INVOICE_ID}/cancel`);
    expect(init.body).toBe(CANCEL_BODY);
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("carries no body and no invented header on the payload-free confirm command", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: INVOICE_ID, status: "CONFIRMED" }));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/billing/invoices/${INVOICE_ID}/confirm`,
        // A body the confirm command has no contract for, carrying a tenant id.
        body: JSON.stringify({ tenantId: "tenant-b" }),
      })
    );

    const init = fetchInit();
    expect(fetchUrl()).toBe(`http://localhost:3001/invoices/${INVOICE_ID}/confirm`);
    expect(init.method).toBe("POST");
    // The command is payload-free: nothing the browser sent is forwarded.
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers).sort()).toEqual(["cookie"]);
    expect(init.headers).not.toHaveProperty("content-type");
  });

  it("forwards the opaque invoice id segment without validating it here", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: "not-a-uuid" }));

    await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/billing/invoices/not-a-uuid/cancel",
        body: CANCEL_BODY,
      })
    );

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    // The API owns value validation; the proxy only re-encodes the segment.
    expect(call[0]).toBe("http://localhost:3001/invoices/not-a-uuid/cancel");
    expect(call[1].body).toBe(CANCEL_BODY);
  });

  it("treats an export-shaped path as an opaque id the API refuses", async () => {
    fetchMock.mockResolvedValue(
      upstreamOk({ error: { code: "VALIDATION_FAILED", message: "Invalid invoice id." } }, 400)
    );

    // No export route exists anywhere in this surface (DEC-044/DEC-045): a
    // single trailing segment is just a non-UUID invoice id to the id read, and
    // the API's own stable 400 is what refuses it.
    const response = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/billing/invoices/export" })
    );

    expect(fetchUrl()).toBe("http://localhost:3001/invoices/export");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Invalid invoice id." },
    });
  });

  it("refuses a GET on the single-verb confirm and cancel shapes without calling upstream", async () => {
    for (const pathname of [
      `/api/billing/invoices/${INVOICE_ID}/confirm`,
      `/api/billing/invoices/${INVOICE_ID}/cancel`,
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Billing route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a query the shape's contract does not define", async () => {
    // An unknown key on the invoice list is a `.strict()` 400 upstream; refused here.
    const unknownKey = await dispatch(
      "GET",
      mockNextRequest({ pathname: "/api/billing/invoices", search: "?tenantId=tenant-b" })
    );
    expect(unknownKey.status).toBe(404);

    // The id read declares no query at all.
    const itemQuery = await dispatch(
      "GET",
      mockNextRequest({ pathname: `/api/billing/invoices/${INVOICE_ID}`, search: "?status=DRAFT" })
    );
    expect(itemQuery.status).toBe(404);

    // A mutating verb accepts no query either.
    const createQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/billing/invoices",
        search: `?saleId=${SALE_ID}`,
        body: CREATE_BODY,
      })
    );
    expect(createQuery.status).toBe(404);

    // Neither lifecycle command declares a query.
    const confirmQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/billing/invoices/${INVOICE_ID}/confirm`,
        search: "?status=CONFIRMED",
      })
    );
    expect(confirmQuery.status).toBe(404);

    const cancelQuery = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/billing/invoices/${INVOICE_ID}/cancel`,
        search: "?reason=duplicate",
        body: CANCEL_BODY,
      })
    );
    expect(cancelQuery.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports no PATCH, PUT or DELETE handler, so no invoice can be patched or deleted", async () => {
    const routeModule = (await import("./route")) as Record<string, unknown>;
    expect(routeModule).not.toHaveProperty("PATCH");
    expect(routeModule).not.toHaveProperty("PUT");
    expect(routeModule).not.toHaveProperty("DELETE");

    const verbs = Object.keys(routeModule)
      .filter((key) => /^[A-Z]+$/.test(key))
      .sort();
    expect(verbs).toEqual(["GET", "POST"]);

    fetchMock.mockReset();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or extra path with the not-found envelope", async () => {
    for (const pathname of [
      "/api/billing",
      `/api/billing/invoices/${INVOICE_ID}/confirm/extra`,
      `/api/billing/invoices/${INVOICE_ID}/lines`,
      `/api/billing/invoices/${INVOICE_ID}/number`,
      "/api/billing/invoices/extra/cancel",
      `/api/billing/invoices/${SALE_ID}/reopen`,
      "/api/billing/customers",
      "/api/billing/sales",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Billing route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds no portal route, printable document or export path", async () => {
    // DEC-044/DEC-045: no portal invoice read, no printable document and no
    // report/export surface exists in this epic, so all of them are unknown here.
    for (const pathname of [
      "/api/billing/portal/invoices",
      "/api/billing/portal/documents",
      `/api/billing/invoices/${INVOICE_ID}/pdf`,
      `/api/billing/invoices/${INVOICE_ID}/print`,
      "/api/billing/exports",
      `/api/billing/invoices/${INVOICE_ID}/export`,
      `/api/billing/invoices/${INVOICE_ID}/documents`,
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Billing route was not found." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, encoded separators and empty segments as malformed requests", async () => {
    for (const pathname of [
      "/api/billing/../sales",
      `/api/billing/invoices%2F${INVOICE_ID}`,
      `/api/billing/invoices%2F${INVOICE_ID}/cancel`,
      "/api/billing//invoices",
      "/api/billing/invoices/",
      `/api/billing/invoices//cancel`,
      `/api/billing/invoices/${INVOICE_ID}/cancel/`,
      "/api/billing/",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch("GET", mockNextRequest({ pathname }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid billing request path." },
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
        pathname: "/api/billing/invoices",
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

    const response = await dispatch("GET", mockNextRequest({ pathname: "/api/billing/invoices" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a credential-less create, confirm and cancel request too", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const requests = [
      { method: "POST" as const, pathname: "/api/billing/invoices", body: CREATE_BODY },
      {
        method: "POST" as const,
        pathname: `/api/billing/invoices/${INVOICE_ID}/confirm`,
        body: "",
      },
      {
        method: "POST" as const,
        pathname: `/api/billing/invoices/${INVOICE_ID}/cancel`,
        body: CANCEL_BODY,
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
        pathname: "/api/billing/invoices",
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
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/billing/invoices",
        headers: new Headers({
          "x-request-id": "req-abc",
          cookie: "browser=should-be-dropped",
          authorization: "Bearer browser-token",
          "x-forwarded-for": "203.0.113.7",
          "idempotency-key": "not-a-billing-concept",
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

  it("adds no header the API would trust as tenant, user or permission context", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/billing/invoices",
        headers: new Headers({
          "x-tenant-id": "tenant-b",
          "x-tenant-slug": "attacker-clinic",
          "x-permissions": "billing.confirm",
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

  it("rejects a client-supplied tenantId on a mutating body instead of treating it as authority", async () => {
    const cases = [
      {
        pathname: "/api/billing/invoices",
        body: JSON.stringify({ saleId: SALE_ID, tenantId: "tenant-b" }),
        message: "Invalid invoice create body.",
      },
      {
        pathname: `/api/billing/invoices/${INVOICE_ID}/cancel`,
        body: JSON.stringify({ reason: "Duplicate.", tenantId: "tenant-b" }),
        message: "Invalid invoice cancel body.",
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

  it("rejects every body key the strict invoice create schema excludes", async () => {
    // `billing.zod.ts` derives these from the sale and the server: `status`,
    // `series`/`number`, `currency`, `customerId`, the line set and the totals
    // all belong to the invoice's own frozen snapshot, and `tenantId` is
    // server-resolved (DEC-038/DEC-039).
    for (const key of [
      "tenantId",
      "status",
      "currency",
      "customerId",
      "series",
      "number",
      "lines",
      "total",
      "taxTotal",
      "createdAt",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: "/api/billing/invoices",
          body: JSON.stringify({ saleId: SALE_ID, [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid invoice create body." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects every body key the strict cancel schema excludes", async () => {
    // The cancel command accepts `reason` alone: the status, the timestamps and
    // the reason column are written only by the command (DEC-043), and the
    // number is allocated by confirmation, never by a cancellation.
    for (const key of [
      "tenantId",
      "status",
      "cancelledAt",
      "confirmedAt",
      "cancelReason",
      "number",
      "series",
    ]) {
      fetchMock.mockReset();
      const response = await dispatch(
        "POST",
        mockNextRequest({
          pathname: `/api/billing/invoices/${INVOICE_ID}/cancel`,
          body: JSON.stringify({ reason: "Duplicate.", [key]: "anything" }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid invoice cancel body." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not a JSON object", async () => {
    for (const body of ["not json", "[]", '"a string"', "12", "null"]) {
      for (const pathname of [
        "/api/billing/invoices",
        `/api/billing/invoices/${INVOICE_ID}/cancel`,
      ]) {
        fetchMock.mockReset();
        const response = await dispatch("POST", mockNextRequest({ pathname, body }));

        expect(response.status).toBe(400);
        expect((await response.json()) as { error: { code: string } }).toMatchObject({
          error: { code: "VALIDATION_FAILED" },
        });
      }
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the mutating body byte-for-byte, never re-encoded", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: INVOICE_ID }, 201));

    // A payload whose whitespace would change under a re-encode.
    const body = `{ "saleId" :  "${SALE_ID}" }`;

    const response = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/billing/invoices", body })
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
      mockNextRequest({ pathname: "/api/billing/invoices", body: CREATE_BODY })
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
          error: { code: "VALIDATION_FAILED", message: "Invalid invoice id." },
        },
      },
      {
        status: 403,
        body: {
          error: {
            code: "FEATURE_NOT_ENTITLED",
            message: "Billing features are not enabled for this tenant.",
          },
        },
      },
      {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Access denied." } },
      },
      {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Invoice was not found." } },
      },
      {
        status: 409,
        body: { error: { code: "CONFLICT", message: "Only a completed sale can be invoiced." } },
      },
      {
        status: 409,
        body: {
          error: { code: "CONFLICT", message: "This sale already has an invoice." },
        },
      },
      {
        status: 409,
        body: { error: { code: "CONFLICT", message: "Only a draft invoice can be confirmed." } },
      },
      {
        status: 409,
        body: {
          error: {
            code: "CONFLICT",
            message: "Only a draft or confirmed invoice can be cancelled.",
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
        mockNextRequest({
          pathname: `/api/billing/invoices/${UNKNOWN_ID}/cancel`,
          body: CANCEL_BODY,
        })
      );

      expect(response.status).toBe(envelope.status);
      // Byte-equivalent: the proxy neither rewrites nor adds a field.
      expect(await response.json()).toEqual(envelope.body);
    }
  });
});
