/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";

interface MockNextRequest {
  nextUrl: { pathname: string };
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}

/** Encodes the given chunks as the byte stream a real request body would expose. */
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
    // Buffering the request is the regression under test: any call is fatal.
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

async function rejectionBody(response: Response): Promise<{ error: { code: string } }> {
  return (await response.json()) as { error: { code: string } };
}

describe("/api/clinical proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the session cookie, x-request-id and patient-anchored upstream path", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: "enc-1", status: "DRAFT" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters`,
      headers: new Headers({ "x-request-id": "req-abc" }),
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;
    const body = (await response.json()) as { id: string }[];

    expect(body).toEqual([{ id: "enc-1", status: "DRAFT" }]);
    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe(`http://localhost:3001/patients/${PATIENT_ID}/clinical/encounters`);
    expect(call[1].headers).toMatchObject({
      cookie: "session=token-123",
      "x-request-id": "req-abc",
    });
  });

  it("forwards only the allowlisted session cookie and x-request-id headers", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters`,
      headers: new Headers({
        "x-request-id": "req-abc",
        cookie: "browser=should-be-dropped",
        authorization: "Bearer browser-token",
        "x-forwarded-for": "203.0.113.7",
      }),
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const init = fetchInit();
    expect(Object.keys(init.headers).sort()).toEqual(["cookie", "x-request-id"]);
    expect(init.headers.cookie).toBe("session=token-123");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("rewrites a nested encounter command path to the upstream clinical route", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: ENCOUNTER_ID }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/close`,
      method: "POST",
      body: byteStream([JSON.stringify({ version: 1 })]),
    });

    await POST(request as unknown as Parameters<typeof POST>[0]);

    const call = fetchMock.mock.calls[0] as unknown as [string];
    expect(call[0]).toBe(
      `http://localhost:3001/patients/${PATIENT_ID}/clinical/encounters/${ENCOUNTER_ID}/close`
    );
  });

  it("forwards the PUT body as the caller's raw stream without buffering", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: ENCOUNTER_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const body = byteStream([JSON.stringify({ version: 1, diagnosis: "Otitis" })]);
    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`,
      method: "PUT",
      body,
    });

    await PUT(request as unknown as Parameters<typeof PUT>[0]);

    const init = fetchInit();
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
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

    const request = mockNextRequest({ pathname: `/api/clinical/${PATIENT_ID}/encounters` });
    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(textSpy).not.toHaveBeenCalled();
    expect(response.body).toBe(upstreamStream);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
    expect(textSpy).toHaveBeenCalledTimes(1);
  });

  it("omits x-request-id when the incoming request does not carry one", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters`,
      method: "POST",
      body: byteStream([JSON.stringify({})]),
    });

    await POST(request as unknown as Parameters<typeof POST>[0]);

    const init = fetchInit();
    expect(init.headers).toHaveProperty("cookie");
    expect(init.headers).not.toHaveProperty("x-request-id");
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("preserves the upstream 409 conflict status and envelope for a stale autosave", async () => {
    cookiesMock.mockResolvedValue({ toString: () => "session=token-123" });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      )
    );

    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`,
      method: "PUT",
      body: byteStream([JSON.stringify({ version: 1 })]),
    });

    const response = (await PUT(request as unknown as Parameters<typeof PUT>[0])) as Response;

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("rejects an empty patient anchor instead of mapping to an unanchored upstream path", async () => {
    const request = mockNextRequest({ pathname: "/api/clinical" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(400);
    expect((await rejectionBody(response)).error.code).toBe("VALIDATION_FAILED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed patient anchor without calling upstream", async () => {
    const request = mockNextRequest({ pathname: "/api/clinical/not-a-uuid/encounters" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(400);
    expect((await rejectionBody(response)).error.code).toBe("VALIDATION_FAILED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a traversal patient anchor without calling upstream", async () => {
    const request = mockNextRequest({ pathname: "/api/clinical/../patients" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a traversal segment after a valid anchor without calling upstream", async () => {
    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters/../close`,
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(404);
    expect((await rejectionBody(response)).error.code).toBe("NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an encoded separator inside a segment without calling upstream", async () => {
    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters%2F..%2Fclose`,
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown clinical route shape without calling upstream", async () => {
    const request = mockNextRequest({ pathname: `/api/clinical/${PATIENT_ID}/admin` });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(404);
    expect((await rejectionBody(response)).error.code).toBe("NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a sub-route-less patient anchor without calling upstream", async () => {
    const request = mockNextRequest({ pathname: `/api/clinical/${PATIENT_ID}` });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a method the upstream route does not expose without calling upstream", async () => {
    const request = mockNextRequest({
      pathname: `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/close`,
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
