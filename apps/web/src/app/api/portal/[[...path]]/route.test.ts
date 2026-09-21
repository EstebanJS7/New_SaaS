/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTAL_SESSION_COOKIE } from "@/lib/session-cookie";

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

const PET_ID = "2f1c9b0e-6a4d-4c3b-8f2e-1d5a7c9e0b31";
const STAFF_COOKIE_HEADER = "ns_staff_session=staff-token";

interface MockNextRequest {
  nextUrl: { pathname: string; search: string };
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
}

function mockNextRequest(props: {
  pathname: string;
  search?: string;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname, search: props.search ?? "" },
    headers: { get: (name: string) => headers.get(name) },
    body: props.body ?? null,
  };
}

/** Single-chunk JSON request body, mirroring a browser `fetch` body stream. */
function jsonBody(value: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      controller.close();
    },
  });
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: ReadableStream<Uint8Array> | undefined;
  cache?: string;
  duplex?: string;
}

function fetchInit(callIndex = 0): FetchInit {
  const call = fetchMock.mock.calls[callIndex] as unknown as [string, FetchInit];
  return call[1];
}

function fetchUrl(callIndex = 0): string {
  const call = fetchMock.mock.calls[callIndex] as unknown as [string];
  return call[0];
}

/** Cookie store stub that only resolves the portal cookie (or nothing). */
function portalCookieStore(value: string | undefined): { get: (name: string) => unknown } {
  return {
    get: (name: string) =>
      name === PORTAL_SESSION_COOKIE && value !== undefined ? { name, value } : undefined,
  };
}

async function callGet(request: MockNextRequest): Promise<Response> {
  return GET(request as unknown as Parameters<typeof GET>[0]);
}

async function callPost(request: MockNextRequest): Promise<Response> {
  return POST(request as unknown as Parameters<typeof POST>[0]);
}

async function callPut(request: MockNextRequest): Promise<Response> {
  return PUT(request as unknown as Parameters<typeof PUT>[0]);
}

describe("/api/portal proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the portal cookie and rewrites the path to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: PET_ID, name: "Rex" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/portal/pets",
      headers: new Headers({ "x-request-id": "req-abc" }),
    });

    const response = await callGet(request);

    expect(await response.json()).toEqual([{ id: PET_ID, name: "Rex" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchUrl()).toBe("http://localhost:3001/portal/pets");
    expect(fetchInit().headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "x-request-id": "req-abc",
    });
    // A GET carries no body, so it keeps the exact request initialization it had
    // before this boundary widened: widening a proxy must not change reads.
    expect(fetchInit().body).toBeUndefined();
    expect(fetchInit().duplex).toBeUndefined();
  });

  it("rewrites a nested holder-owned resource path", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: PET_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await callGet(mockNextRequest({ pathname: `/api/portal/appointments/${PET_ID}` }));

    expect(fetchUrl()).toBe(`http://localhost:3001/portal/appointments/${PET_ID}`);
  });

  it("forwards the holder's own booking-request read to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ timeZone: "America/Asuncion", bookings: [{ id: PET_ID }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/portal/bookings",
      headers: new Headers({ "x-request-id": "req-bookings" }),
    });

    const response = await callGet(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchUrl()).toBe("http://localhost:3001/portal/bookings");
    // Query-free read: no body, no rewritten query.
    expect(fetchInit().headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "x-request-id": "req-bookings",
    });
    expect(fetchInit().body).toBeUndefined();
    expect(fetchInit().duplex).toBeUndefined();
  });

  it("forwards ONLY the portal cookie — a staff cookie never crosses the boundary", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/portal/pets",
      headers: new Headers({
        "x-request-id": "req-abc",
        cookie: STAFF_COOKIE_HEADER,
        authorization: "Bearer browser-token",
        "x-forwarded-for": "203.0.113.7",
      }),
    });

    await callGet(request);

    const init = fetchInit();
    expect(Object.keys(init.headers).sort()).toEqual(["cookie", "x-request-id"]);
    expect(init.headers.cookie).toBe(`${PORTAL_SESSION_COOKIE}=portal-token`);
    expect(init.headers.cookie).not.toContain("staff-token");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("still proxies without a portal cookie so the API can answer 401", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore(undefined));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );

    const response = await callGet(mockNextRequest({ pathname: "/api/portal/me" }));

    expect(response.status).toBe(401);
    expect(fetchInit().headers).not.toHaveProperty("cookie");
  });

  it("forwards a POST booking body and the portal cookie to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "booking-1", status: "PENDING" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    const body = jsonBody({
      startAt: "2026-09-20T10:00:00.000Z",
      endAt: "2026-09-20T10:30:00.000Z",
    });
    const request = mockNextRequest({
      pathname: `/api/portal/pets/${PET_ID}/bookings`,
      headers: new Headers({ "x-request-id": "req-booking" }),
      body,
    });

    const response = await callPost(request);

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchUrl()).toBe(`http://localhost:3001/portal/pets/${PET_ID}/bookings`);
    const init = fetchInit();
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "x-request-id": "req-booking",
      "content-type": "application/json",
    });
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
    expect(init.cache).toBe("no-store");
  });

  it("forwards a PUT profile body and the portal cookie to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ phone: "+595981000000" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const body = jsonBody({ phone: "+595981000000" });
    const request = mockNextRequest({ pathname: "/api/portal/profile", body });

    const response = await callPut(request);

    expect(response.status).toBe(200);
    expect(fetchUrl()).toBe("http://localhost:3001/portal/profile");
    const init = fetchInit();
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "content-type": "application/json",
    });
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
  });

  it("forwards only the portal cookie on a write — a staff cookie never crosses", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/portal/profile",
      headers: new Headers({ cookie: STAFF_COOKIE_HEADER }),
      body: jsonBody({ phone: "+595981000000" }),
    });

    await callPut(request);

    const init = fetchInit();
    expect(init.headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "content-type": "application/json",
    });
    expect(init.headers.cookie).not.toContain("staff-token");
  });

  it.each([
    "/api/portal",
    "/api/portal/",
    "/api/portal/invoices",
    "/api/portal/login",
    "/api/portal/pets/not-a-uuid",
    `/api/portal/pets/${PET_ID}/clinical`,
    "/api/portal/pets/%2e%2e/admin",
  ])("rejects %s with 404 and never calls the API", async (pathname) => {
    const response = await callGet(mockNextRequest({ pathname }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects any query string before reaching the API", async () => {
    const response = await callGet(
      mockNextRequest({ pathname: "/api/portal/pets", search: "?customerId=other" })
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the scoped availability query to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ date: "2026-06-15", slots: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/portal/availability",
      search: "?date=2026-06-15&durationMinutes=30&stepMinutes=15",
    });

    const response = await callGet(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchUrl()).toBe(
      "http://localhost:3001/portal/availability?date=2026-06-15&durationMinutes=30&stepMinutes=15"
    );
    // A read still carries no body.
    expect(fetchInit().body).toBeUndefined();
    expect(fetchInit().duplex).toBeUndefined();
  });

  it("rebuilds the availability query from the allowlist, dropping duplicate values", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ date: "2026-06-15", slots: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await callGet(
      mockNextRequest({
        pathname: "/api/portal/availability",
        search: "?date=2026-06-15&date=2026-06-16&durationMinutes=30",
      })
    );

    expect(fetchUrl()).toBe(
      "http://localhost:3001/portal/availability?date=2026-06-15&durationMinutes=30"
    );
  });

  it("refuses an unknown availability query key instead of dropping it", async () => {
    const response = await callGet(
      mockNextRequest({
        pathname: "/api/portal/availability",
        search: "?date=2026-06-15&durationMinutes=30&tenantId=other",
      })
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a query on a query-free shape (availability is the only exception)", async () => {
    for (const pathname of [
      "/api/portal/me",
      "/api/portal/profile",
      "/api/portal/bookings",
      `/api/portal/pets/${PET_ID}`,
      "/api/portal/appointments",
    ]) {
      const response = await callGet(
        mockNextRequest({ pathname, search: "?date=2026-06-15&durationMinutes=30" })
      );
      expect(response.status, pathname).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses POST and PUT on the read-only availability shape with 405", async () => {
    const postResponse = await callPost(
      mockNextRequest({
        pathname: "/api/portal/availability",
        search: "?date=2026-06-15&durationMinutes=30",
      })
    );
    expect(postResponse.status).toBe(405);

    const putResponse = await callPut(
      mockNextRequest({
        pathname: "/api/portal/availability",
        search: "?date=2026-06-15&durationMinutes=30",
      })
    );
    expect(putResponse.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a known path reached with a disallowed method with a 405 envelope", async () => {
    const response = await callPut(mockNextRequest({ pathname: "/api/portal/me" }));

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Portal route does not support this method." },
    });
    // No `Allow` header: the refusal must not enumerate other methods.
    expect(response.headers.get("allow")).toBeNull();
  });

  it("refuses POST on a read-only collection shape", async () => {
    const response = await callPost(mockNextRequest({ pathname: "/api/portal/pets" }));

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("refuses POST on the read-only booking-request shape", async () => {
    const response = await callPost(mockNextRequest({ pathname: "/api/portal/bookings" }));

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("refuses a deeper path under the booking-request collection", async () => {
    const response = await callGet(mockNextRequest({ pathname: `/api/portal/bookings/${PET_ID}` }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a percent-encoded booking-request path before reaching the API", async () => {
    const response = await callGet(mockNextRequest({ pathname: "/api/portal/%62ookings" }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses POST on the read-only profile shape", async () => {
    const response = await callPost(mockNextRequest({ pathname: "/api/portal/profile" }));

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a percent-encoded write path before reaching the API", async () => {
    const response = await callPost(
      mockNextRequest({ pathname: `/api/portal/pets/${PET_ID}/%62ookings` })
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a three-segment path other than pets/:uuid/bookings or a cancel shape", async () => {
    const response = await callPost(
      mockNextRequest({ pathname: `/api/portal/pets/${PET_ID}/cancel` })
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a POST booking-request cancel to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: PET_ID, status: "CANCELLED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: `/api/portal/bookings/${PET_ID}/cancel`,
      headers: new Headers({ "x-request-id": "req-cancel-booking" }),
    });

    const response = await callPost(request);

    expect(response.status).toBe(200);
    expect(fetchUrl()).toBe(`http://localhost:3001/portal/bookings/${PET_ID}/cancel`);
    const init = fetchInit();
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "x-request-id": "req-cancel-booking",
      "content-type": "application/json",
    });
  });

  it("forwards a POST appointment cancel to the private API", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: PET_ID, status: "CANCELLED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const response = await callPost(
      mockNextRequest({ pathname: `/api/portal/appointments/${PET_ID}/cancel` })
    );

    expect(response.status).toBe(200);
    expect(fetchUrl()).toBe(`http://localhost:3001/portal/appointments/${PET_ID}/cancel`);
  });

  it("forwards a PUT appointment reschedule body and the portal cookie", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: PET_ID, version: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const body = jsonBody({
      startAt: "2026-09-20T10:00:00.000Z",
      endAt: "2026-09-20T10:30:00.000Z",
      version: 1,
    });
    const request = mockNextRequest({
      pathname: `/api/portal/appointments/${PET_ID}`,
      headers: new Headers({ "x-request-id": "req-reschedule" }),
      body,
    });

    const response = await callPut(request);

    expect(response.status).toBe(200);
    expect(fetchUrl()).toBe(`http://localhost:3001/portal/appointments/${PET_ID}`);
    const init = fetchInit();
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({
      cookie: `${PORTAL_SESSION_COOKIE}=portal-token`,
      "x-request-id": "req-reschedule",
      "content-type": "application/json",
    });
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
  });

  it("refuses a query on each new write shape", async () => {
    for (const [call, pathname] of [
      [callPost, `/api/portal/bookings/${PET_ID}/cancel`],
      [callPost, `/api/portal/appointments/${PET_ID}/cancel`],
      [callPut, `/api/portal/appointments/${PET_ID}`],
    ] as const) {
      const response = await call(
        mockNextRequest({ pathname, search: "?date=2026-06-15&durationMinutes=30" })
      );
      expect(response.status, pathname).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the wrong verb on each new write shape", async () => {
    const wrongVerbCases = [
      [callGet, `/api/portal/bookings/${PET_ID}/cancel`],
      [callGet, `/api/portal/appointments/${PET_ID}/cancel`],
      [callPost, `/api/portal/appointments/${PET_ID}`],
      [callPut, `/api/portal/pets/${PET_ID}`],
    ] as const;
    for (const [call, pathname] of wrongVerbCases) {
      const response = await call(mockNextRequest({ pathname }));
      expect(response.status, pathname).toBe(405);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    `/api/portal/bookings/${PET_ID}/cancel/extra`,
    `/api/portal/appointments/${PET_ID}/cancel/extra`,
    `/api/portal/bookings/not-a-uuid/cancel`,
    `/api/portal/appointments/not-a-uuid/cancel`,
    `/api/portal/appointments/%2e%2e/cancel`,
  ])("refuses the near-miss write path %s with 404", async (pathname) => {
    const response = await callPost(mockNextRequest({ pathname }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a PUT reschedule with a malformed id and a percent-encoded id", async () => {
    for (const pathname of [
      "/api/portal/appointments/not-a-uuid",
      `/api/portal/appointments/%32f1c9b0e-6a4d-4c3b-8f2e-1d5a7c9e0b31`,
    ]) {
      const response = await callPut(mockNextRequest({ pathname, body: jsonBody({}) }));
      expect(response.status, pathname).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the upstream error status and envelope", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "FEATURE_NOT_ENTITLED", message: "no portal" } }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    const response = await callGet(mockNextRequest({ pathname: "/api/portal/pets" }));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("streams the upstream response body instead of buffering it", async () => {
    cookiesMock.mockResolvedValue(portalCookieStore("portal-token"));
    const upstreamStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("portal-bytes"));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(upstreamStream, {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-upstream" },
      })
    );

    const textSpy = vi.spyOn(Response.prototype, "text");

    const response = await callGet(mockNextRequest({ pathname: "/api/portal/me" }));

    expect(textSpy).not.toHaveBeenCalled();
    expect(response.body).toBe(upstreamStream);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
  });
});
