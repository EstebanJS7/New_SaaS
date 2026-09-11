/**
 * @vitest-environment node
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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

interface MockNextRequest {
  nextUrl: { searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
}

function mockNextRequest(url: string, headers?: Headers): MockNextRequest {
  const parsed = new URL(url);
  return {
    nextUrl: { searchParams: parsed.searchParams },
    headers: { get: (name: string) => headers?.get(name) ?? null },
  };
}

describe("/branding/assets/[kind]/content staff proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue({ toString: () => "session=staff-token" });
  });

  it("forwards the staff cookie and token to the protected content route and streams bytes", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "content-type": "image/png", "cache-control": "private, no-cache" },
      })
    );

    const request = mockNextRequest(
      "http://localhost:3000/branding/assets/logoLight/content?token=signed-token"
    );

    const response = (await GET(request as never, {
      params: Promise.resolve({ kind: "logoLight" }),
    })) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect((await response.arrayBuffer()).byteLength).toBe(4);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(url).toBe("http://localhost:3001/branding/assets/logoLight/content?token=signed-token");
    expect(init.method).toBe("GET");
    expect(init.headers.cookie).toBe("session=staff-token");
  });

  it("forwards x-request-id when present", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const request = mockNextRequest(
      "http://localhost:3000/branding/assets/favicon/content?token=abc",
      new Headers({ "x-request-id": "req-1" })
    );

    await GET(request as never, { params: Promise.resolve({ kind: "favicon" }) });

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers["x-request-id"]).toBe("req-1");
  });

  it("rejects an unknown asset kind with 400 and never calls upstream", async () => {
    const request = mockNextRequest(
      "http://localhost:3000/branding/assets/secrets/content?token=abc"
    );

    const response = (await GET(request as never, {
      params: Promise.resolve({ kind: "secrets" }),
    })) as Response;

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing token with 400 and never calls upstream", async () => {
    const request = mockNextRequest("http://localhost:3000/branding/assets/logoLight/content");

    const response = (await GET(request as never, {
      params: Promise.resolve({ kind: "logoLight" }),
    })) as Response;

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates an upstream failure status and envelope", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "Branding asset not found." } }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        }
      )
    );

    const request = mockNextRequest(
      "http://localhost:3000/branding/assets/logoLight/content?token=stale"
    );

    const response = (await GET(request as never, {
      params: Promise.resolve({ kind: "logoLight" }),
    })) as Response;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Branding asset not found." },
    });
  });
});
