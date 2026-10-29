/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

interface MockNextRequest {
  nextUrl: { pathname: string };
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}

/** Encodes the given chunks as the byte stream a real request body would expose. */

/**
 * The text each stream was BUILT from (TD-050).
 *
 * The proxy consumes the caller's stream, so an assertion cannot read it afterwards — and the
 * value is what matters here, because a fix that re-serialized the JSON would still forward a
 * string. Remembering the bytes at construction is what lets the case compare against them.
 */
const streamText = new WeakMap<ReadableStream<Uint8Array>, string>();

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  streamText.set(stream, chunks.join(""));
  return stream;
}

function mockNextRequest(props: {
  pathname: string;
  method?: string;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname },
    headers: {
      get: (name: string) => headers.get(name),
    },
    body: props.body ?? null,
    // Read from the SAME body, the way the runtime does (TD-050): a mock that hands back only what
    // the code happens to want cannot find a defect in how the body crosses the boundary. Until
    // TD-050 this one REJECTED `text()` on purpose -- "buffering is the regression under test" --
    // which encoded a decision whose rationale was never recorded.
    text: async () => {
      const stream = props.body ?? null;
      if (stream === null) return "";
      let text = "";
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        text += new TextDecoder().decode(chunk);
      }
      return text;
    },
  };
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string | ReadableStream<Uint8Array>;
  duplex?: string;
}

function fetchInit(callIndex = 0): FetchInit {
  const call = fetchMock.mock.calls[callIndex] as unknown as [string, FetchInit];
  return call[1];
}

describe("/api/patients proxy", () => {
  it("forwards a bounded identity read as an unchanged POST body with private no-store response", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=lookup-session" });
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const payload = '{ "q": "Ana García" }';
    const request = mockNextRequest({
      pathname: "/api/patients/lookup",
      method: "POST",
      body: byteStream([payload]),
    });
    const response = await POST(request as unknown as Parameters<typeof POST>[0]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/patients/lookup",
      expect.objectContaining({
        method: "POST",
        body: payload,
        headers: { cookie: "session=lookup-session", "content-type": "application/json" },
        cache: "no-store",
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the session cookie and x-request-id to the upstream API", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: "patient-1", name: "Rex" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/patients",
      headers: new Headers({ "x-request-id": "req-abc" }),
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;
    const body = (await response.json()) as { id: string; name: string }[];

    expect(body).toEqual([{ id: "patient-1", name: "Rex" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/patients");
    expect(call[1].headers).toMatchObject({
      cookie: "session=token-123",
      "x-request-id": "req-abc",
    });
  });

  it("forwards only the allowlisted session cookie and x-request-id headers", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/patients",
      headers: new Headers({
        "x-request-id": "req-abc",
        cookie: "browser=should-be-dropped",
        authorization: "Bearer browser-token",
        "x-forwarded-for": "203.0.113.7",
      }),
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const init = fetchInit();
    // The server-resolved session replaces any browser-supplied cookie, and
    // every other browser header is dropped at the boundary.
    expect(Object.keys(init.headers).sort()).toEqual(["cookie", "x-request-id"]);
    expect(init.headers.cookie).toBe("session=token-123");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("rewrites a nested guardian path to the patients upstream route", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "guardian-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/patients/patient-1/guardians/guardian-1/primary",
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const call = fetchMock.mock.calls[0] as unknown as [string];
    expect(call[0]).toBe("http://localhost:3001/patients/patient-1/guardians/guardian-1/primary");
  });

  it("forwards the PUT body as text, so the API parses the caller's exact JSON", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "patient-1", name: "Rex" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const body = byteStream([JSON.stringify({ name: "Rex" })]);
    const request = mockNextRequest({
      pathname: "/api/patients/patient-1",
      method: "PUT",
      body,
    });

    await PUT(request as unknown as Parameters<typeof PUT>[0]);

    const init = fetchInit();
    expect(init.method).toBe("PUT");
    // Identity proves the raw ReadableStream was piped through, not decoded.
    // A STRING, and no `duplex` (TD-050): the body crosses as text, which is the same JSON the
    // caller sent -- a fix that re-serialized it would still be a string and would change what the
    // API's Zod sees, so the VALUE is asserted and not only its type.
    // The text of the very stream the caller sent: a re-serializing fix would still be a
    // string, which is why the VALUE is asserted and not only its type.
    expect(init.body).toBe(streamText.get(body));
    expect(typeof init.body).toBe("string");
    expect(init.duplex).toBeUndefined();
    expect(init.headers).toEqual({
      cookie: "session=token-123",
      "content-type": "application/json",
    });
  });

  it("streams the upstream response body instead of reading it into memory", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });

    const upstreamStream = byteStream(["raw", "-bytes"]);
    fetchMock.mockResolvedValue(
      new Response(upstreamStream, {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-upstream" },
      })
    );

    const textSpy = vi.spyOn(Response.prototype, "text");

    const request = mockNextRequest({ pathname: "/api/patients" });
    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    // The proxy must not call response.text(); the old buffering path did.
    expect(textSpy).not.toHaveBeenCalled();
    expect(response.body).toBe(upstreamStream);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
    // Only the test's own read above touches Response.prototype.text.
    expect(textSpy).toHaveBeenCalledTimes(1);
  });

  it("omits x-request-id when the incoming request does not carry one", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "patient-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/patients/patient-1/deactivate",
      method: "POST",
      body: byteStream([JSON.stringify({})]),
    });

    await POST(request as unknown as Parameters<typeof POST>[0]);

    const init = fetchInit();
    expect(init.headers).toHaveProperty("cookie");
    expect(init.headers).not.toHaveProperty("x-request-id");
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("preserves the upstream error status and envelope for permission denials", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "FEATURE_NOT_ENTITLED", message: "Feature not entitled" },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    const request = mockNextRequest({ pathname: "/api/patients" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });
  it("forwards paged search as a private read-only POST without putting names in the URL", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=synthetic" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })
    );
    const text = JSON.stringify({
      q: "Synthetic guardian",
      page: 2,
      status: "all",
      sort: "recent",
    });
    const request = mockNextRequest({
      pathname: "/api/patients/search",
      method: "POST",
      body: byteStream([text]),
    });
    const response = await POST(request as unknown as Parameters<typeof POST>[0]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3001/patients/search");
    expect(fetchInit()).toMatchObject({ method: "POST", body: text, cache: "no-store" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
