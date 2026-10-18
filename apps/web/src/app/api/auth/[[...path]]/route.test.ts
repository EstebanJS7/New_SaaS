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

const SET_COOKIE = `${STAFF_SESSION_COOKIE}=opaque-value; Path=/; HttpOnly; SameSite=Lax`;

beforeEach(() => {
  cookiesMock.mockReset();
  fetchMock.mockReset();
  cookiesMock.mockResolvedValue({ get: () => undefined });
});
afterEach(() => vi.restoreAllMocks());

describe("the auth BFF — the sign-in hop", () => {
  it("RELAYS the API's Set-Cookie with its attributes intact", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": SET_COOKIE },
      })
    );

    const response = await POST(
      mockNextRequest({
        pathname: "/api/auth/login",
        body: JSON.stringify({ email: "staff@clinic.test", password: "a-password" }),
      }) as never
    );

    // VERBATIM: the attributes are the API's hardening decisions, and a proxy that rebuilt
    // the header could quietly drop HttpOnly.
    expect(response.headers.get("set-cookie")).toBe(SET_COOKIE);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.status).toBe(200);
  });

  it("never puts the cookie in the BODY", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": SET_COOKIE },
      })
    );
    const response = await POST(
      mockNextRequest({
        pathname: "/api/auth/login",
        body: JSON.stringify({ email: "staff@clinic.test", password: "a-password" }),
      }) as never
    );

    // The session is a bearer token: a body that echoed it would make every log, cache and
    // error reporter a place it leaks.
    expect(await response.text()).not.toContain("opaque-value");
  });

  it("forwards NO session on the sign-in hop, inbound", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) => (name === STAFF_SESSION_COOKIE ? { name, value: "stale" } : undefined),
    });
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(
      mockNextRequest({
        pathname: "/api/auth/login",
        body: JSON.stringify({ email: "staff@clinic.test", password: "a-password" }),
      }) as never
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The browser is asking FOR a session; whatever cookie it happens to hold has no business
    // travelling to the route that issues one.
    expect(JSON.stringify(init.headers)).not.toContain("stale");
  });

  it("passes the API's 401 and 429 through, because those answers ARE the form's job", async () => {
    for (const status of [401, 429]) {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "X", message: "no" } }), {
          status,
          headers: { "content-type": "application/json" },
        })
      );
      const response = await POST(
        mockNextRequest({
          pathname: "/api/auth/login",
          body: JSON.stringify({ email: "staff@clinic.test", password: "a-password" }),
        }) as never
      );
      expect(response.status).toBe(status);
    }
  });

  it("refuses logout, so a credential-less proxy cannot revoke a session", async () => {
    const response = await POST(
      mockNextRequest({ pathname: "/api/auth/logout", body: "{}" }) as never
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the auth BFF — the recovery hops", () => {
  it("forwards the recovery body with no session, and relays no cookie", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 })
    );
    await POST(
      mockNextRequest({
        pathname: "/api/auth/forgot-password",
        body: JSON.stringify({ email: "staff@clinic.test" }),
      }) as never
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/auth/forgot-password");
    expect(init.body).toBe(JSON.stringify({ email: "staff@clinic.test" }));
  });

  it("still serves password-reset, with its own body contract", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(
      mockNextRequest({
        pathname: "/api/auth/password-reset",
        body: JSON.stringify({ token: "t", password: "a-password" }),
      }) as never
    );
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://localhost:3001/auth/password-reset"
    );
  });

  it("refuses a body key the route does not take", async () => {
    for (const [pathname, body] of [
      ["/api/auth/login", { email: "a@b.test", password: "x", tenantId: "t" }],
      ["/api/auth/forgot-password", { email: "a@b.test", role: "OWNER" }],
    ] as const) {
      const response = await POST(
        mockNextRequest({ pathname, body: JSON.stringify(body) }) as never
      );
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a path this proxy does not serve", async () => {
    const response = await POST(mockNextRequest({ pathname: "/api/auth/me", body: "{}" }) as never);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an object", async () => {
    for (const body of ["", "[]", "null", "not json"]) {
      const response = await POST(mockNextRequest({ pathname: "/api/auth/login", body }) as never);
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
