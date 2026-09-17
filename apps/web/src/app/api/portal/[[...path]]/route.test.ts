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

import { GET } from "./route";

const PET_ID = "2f1c9b0e-6a4d-4c3b-8f2e-1d5a7c9e0b31";
const STAFF_COOKIE_HEADER = "ns_staff_session=staff-token";

interface MockNextRequest {
  nextUrl: { pathname: string; search: string };
  headers: { get: (name: string) => string | null };
}

function mockNextRequest(props: {
  pathname: string;
  search?: string;
  headers?: Headers;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname, search: props.search ?? "" },
    headers: { get: (name: string) => headers.get(name) },
  };
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
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

  it.each([
    "/api/portal",
    "/api/portal/",
    "/api/portal/invoices",
    "/api/portal/profile",
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
