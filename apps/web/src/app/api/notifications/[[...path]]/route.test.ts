/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

const cookiesMock = vi.fn();
const fetchMock = vi.fn();

(global as typeof globalThis & { fetch: typeof fetchMock }).fetch = fetchMock;

vi.mock("next/headers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- test mock factory returns dynamic stub
  cookies: () => cookiesMock(),
}));

import { GET } from "./route";

const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";

interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
}

function mockNextRequest(props: { pathname: string; search?: string }): MockNextRequest {
  const url = new URL(`http://localhost:3000${props.pathname}${props.search ?? ""}`);
  return {
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
    headers: { get: () => null },
  };
}

async function readBody(response: Response): Promise<unknown> {
  return await response.json();
}

beforeEach(() => {
  cookiesMock.mockReset();
  fetchMock.mockReset();
  cookiesMock.mockResolvedValue({
    get: (name: string) =>
      name === STAFF_SESSION_COOKIE ? { name, value: "session-token" } : undefined,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("notification delivery BFF — GET only", () => {
  it("forwards an allowlisted list query and carries the session cookie", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ deliveries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const response = await GET(
      mockNextRequest({
        pathname: "/api/notifications/deliveries",
        search: "?status=FAILED&channel=EMAIL",
      }) as never
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/notifications/deliveries?status=FAILED&channel=EMAIL");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).cookie).toContain("session-token");
  });

  it("forwards one delivery by id", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await GET(
      mockNextRequest({ pathname: `/api/notifications/deliveries/${DELIVERY_ID}` }) as never
    );
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      `http://localhost:3001/notifications/deliveries/${DELIVERY_ID}`
    );
  });

  it("forwards the source reference, which is an allowlisted key", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ deliveries: [] }), { status: 200 }));
    const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await GET(
      mockNextRequest({
        pathname: "/api/notifications/deliveries",
        search: `?sourceType=APPOINTMENT&sourceId=${sourceId}`,
      }) as never
    );
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      `http://localhost:3001/notifications/deliveries?sourceType=APPOINTMENT&sourceId=${sourceId}`
    );
  });

  it("refuses an unlisted query key instead of forwarding it", async () => {
    const response = await GET(
      mockNextRequest({
        pathname: "/api/notifications/deliveries",
        search: "?tenantId=other",
      }) as never
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a path that is not a delivery read", async () => {
    const response = await GET(mockNextRequest({ pathname: "/api/notifications/send" }) as never);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers unauthenticated before it calls the API", async () => {
    cookiesMock.mockResolvedValue({ get: () => undefined });
    const response = await GET(
      mockNextRequest({ pathname: "/api/notifications/deliveries" }) as never
    );
    expect(response.status).toBe(401);
    expect(await readBody(response)).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the API's status through unchanged, including a denial", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    const response = await GET(
      mockNextRequest({ pathname: "/api/notifications/deliveries" }) as never
    );
    expect(response.status).toBe(403);
  });
});
