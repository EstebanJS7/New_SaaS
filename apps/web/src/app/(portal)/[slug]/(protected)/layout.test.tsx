import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const redirect = vi.fn((path: string) => {
  // `redirect` works by throwing a sentinel the framework catches, so a mock that only
  // recorded would let the layout render and the test would assert the wrong thing.
  throw new Error(`NEXT_REDIRECT:${path}`);
});
const fetchMock = vi.fn();

(global as typeof globalThis & { fetch: typeof fetchMock }).fetch = fetchMock;
vi.mock("next/headers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- test mock factory returns dynamic stub
  cookies: () => cookiesMock(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

import { PORTAL_SESSION_COOKIE } from "@/lib/session-cookie";
import PortalProtectedLayout from "./layout";

function portalCookie(value: string | undefined): { get: (name: string) => unknown } {
  return {
    get: (name: string) =>
      name === PORTAL_SESSION_COOKIE && value !== undefined ? { name, value } : undefined,
  };
}

const render = (slug = "acme") =>
  PortalProtectedLayout({ children: null, params: Promise.resolve({ slug }) });

beforeEach(() => {
  cookiesMock.mockReset();
  fetchMock.mockReset();
  redirect.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("the portal's gate", () => {
  it("sends a visitor with NO cookie to that clinic's sign-in page", async () => {
    cookiesMock.mockResolvedValue(portalCookie(undefined));

    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/acme/login");
    expect(redirect).toHaveBeenCalledWith("/acme/login");
    // No cookie is a settled answer: there is nothing to verify, so no request is made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("VERIFIES the session rather than trusting the cookie's presence", async () => {
    cookiesMock.mockResolvedValue(portalCookie("a-revoked-or-invented-token"));
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    // A cookie that exists is not a session that is live: it may have been revoked, expired,
    // or never real. The probe is what tells them apart.
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/acme/login");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/portal/me");
    expect(String((init.headers as Record<string, string>).cookie)).toContain(
      "a-revoked-or-invented-token"
    );
  });

  it("renders for a live session, passing the children through", async () => {
    cookiesMock.mockResolvedValue(portalCookie("a-live-token"));
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(render()).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does NOT send a signed-in customer away when the probe merely fails", async () => {
    cookiesMock.mockResolvedValue(portalCookie("a-live-token"));
    // A 500 or an unreachable API is an OUTAGE. Treating it as "signed out" would log every
    // customer out the moment the portal has a bad minute.
    fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(render()).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to the sign-in page of the clinic in the PATH, not a shared one", async () => {
    cookiesMock.mockResolvedValue(portalCookie(undefined));
    await expect(render("otra-clinica")).rejects.toThrow("NEXT_REDIRECT:/otra-clinica/login");
  });
});
