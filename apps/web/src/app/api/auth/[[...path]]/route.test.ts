/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

(global as typeof globalThis & { fetch: typeof fetchMock }).fetch = fetchMock;

import { POST } from "./route";

interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  text: () => Promise<string>;
}

function mockNextRequest(props: { pathname: string; body?: string }): MockNextRequest {
  const url = new URL(`http://localhost:3000${props.pathname}`);
  return {
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
    text: () => Promise.resolve(props.body ?? ""),
  };
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("the public auth BFF", () => {
  it("forwards the reset body WITHOUT a session cookie", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(
      mockNextRequest({
        pathname: "/api/auth/password-reset",
        body: JSON.stringify({ token: "t", password: "a-password" }),
      }) as never
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/auth/password-reset");
    // The route is public by necessity: the caller is locked out, so there is no session
    // to send -- and sending one would hand an unrelated session's authority to a route
    // with no use for it.
    expect(JSON.stringify(init.headers)).not.toContain("cookie");
    expect(init.body).toBe(JSON.stringify({ token: "t", password: "a-password" }));
  });

  it("passes the API's 401 through unchanged, because that refusal IS the answer", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "no" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const response = await POST(
      mockNextRequest({
        pathname: "/api/auth/password-reset",
        body: JSON.stringify({ token: "t", password: "a-password" }),
      }) as never
    );
    expect(response.status).toBe(401);
  });

  it("refuses any other auth route, so login and logout stay unreachable here", async () => {
    for (const pathname of ["/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password"]) {
      const response = await POST(mockNextRequest({ pathname, body: "{}" }) as never);
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unlisted body key rather than forwarding it", async () => {
    const response = await POST(
      mockNextRequest({
        pathname: "/api/auth/password-reset",
        body: JSON.stringify({ token: "t", password: "a-password", tenantId: "x" }),
      }) as never
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an object", async () => {
    for (const body of ["", "[]", "null", "not json"]) {
      const response = await POST(
        mockNextRequest({ pathname: "/api/auth/password-reset", body }) as never
      );
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
