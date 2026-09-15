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

vi.mock("next/server", async () => {
  return await vi.importActual("next/server");
});

import { GET, PUT } from "./route";

interface MockNextRequest {
  nextUrl: { pathname: string };
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function mockNextRequest(props: {
  pathname: string;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname },
    headers: { get: (name: string) => headers.get(name) },
    body: props.body ?? null,
    text: () => Promise.reject(new Error("request.text() must not be called")),
  };
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: ReadableStream<Uint8Array>;
  duplex?: "half";
}

function fetchInit(callIndex = 0): FetchInit {
  const call = fetchMock.mock.calls[callIndex] as unknown as [string, FetchInit];
  return call[1];
}

function upstreamOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("/api/settings proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue({
      get: (name: string) =>
        name === STAFF_SESSION_COOKIE ? { name, value: "token-123" } : undefined,
      // Present to prove the proxy never serializes the whole cookie jar.
      toString: () => `analytics=1; ${STAFF_SESSION_COOKIE}=token-123; theme=dark`,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the allowlisted scheduling namespace to the upstream settings route", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ settings: { conflictPolicy: "REJECT" } }));

    const request = mockNextRequest({
      pathname: "/api/settings/scheduling",
      headers: new Headers({ "x-request-id": "req-abc" }),
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;
    expect(await response.json()).toEqual({ settings: { conflictPolicy: "REJECT" } });

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/settings/scheduling");
    expect(call[1].headers).toMatchObject({
      cookie: `${STAFF_SESSION_COOKIE}=token-123`,
      "x-request-id": "req-abc",
    });
  });

  it("forwards only the allowlisted session cookie and x-request-id headers", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ settings: {} }));

    const request = mockNextRequest({
      pathname: "/api/settings/scheduling",
      headers: new Headers({
        "x-request-id": "req-abc",
        cookie: "browser=should-be-dropped",
        authorization: "Bearer browser-token",
      }),
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const init = fetchInit();
    expect(Object.keys(init.headers).sort()).toEqual(["cookie", "x-request-id"]);
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("forwards the PUT patch body as the caller's raw stream without buffering", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ settings: { conflictPolicy: "ALLOW" } }));

    const body = byteStream([JSON.stringify({ conflictPolicy: "ALLOW" })]);
    const request = mockNextRequest({
      pathname: "/api/settings/scheduling",
      body,
    });

    await PUT(request as unknown as Parameters<typeof PUT>[0]);

    const init = fetchInit();
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
    expect(init.headers).toEqual({
      cookie: `${STAFF_SESSION_COOKIE}=token-123`,
      "content-type": "application/json",
    });
  });

  it("rejects a namespace outside the allowlist with 404 and never calls upstream", async () => {
    const request = mockNextRequest({ pathname: "/api/settings/sales" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Settings namespace not found." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty or nested settings path", async () => {
    const empty = mockNextRequest({ pathname: "/api/settings" });
    expect(((await GET(empty as unknown as Parameters<typeof GET>[0])) as Response).status).toBe(
      400
    );

    const nested = mockNextRequest({ pathname: "/api/settings/scheduling/availability" });
    expect(((await GET(nested as unknown as Parameters<typeof GET>[0])) as Response).status).toBe(
      404
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects encoded or traversal segments before calling upstream", async () => {
    const encoded = mockNextRequest({ pathname: "/api/settings/%2e%2e" });
    const response = (await GET(encoded as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the upstream VALIDATION_FAILED error envelope for rejected patches", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "Invalid settings patch." },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    const request = mockNextRequest({
      pathname: "/api/settings/scheduling",
      body: byteStream([JSON.stringify({ conflictPolicy: "NOPE" })]),
    });

    const response = (await PUT(request as unknown as Parameters<typeof PUT>[0])) as Response;

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
