/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
import { POST } from "./route";

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "demo-session" }) } as never);
});
const request = (origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/session/logout", {
    method: "POST",
    headers: { origin },
  });

describe("private sign-out BFF", () => {
  it("forwards only the staff credential to the existing revoke command", async () => {
    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/logout$/),
      expect.objectContaining({
        method: "POST",
        headers: { cookie: `${STAFF_SESSION_COOKIE}=demo-session` },
      })
    );
    const cleared = response.headers.get("set-cookie")?.toLowerCase();
    expect(cleared).toContain("max-age=0");
    expect(cleared).toContain("httponly");
    expect(cleared).toContain("samesite=lax");
  });
  it("rejects a foreign origin before reading or forwarding a credential", async () => {
    const response = await POST(request("https://foreign.example"));
    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("keeps the session cookie when server revocation cannot be confirmed", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("connection failure"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain("demo-session");
  });
  it("clears an expired session without sending unrelated cookies", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    expect((await POST(request())).status).toBe(204);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
