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

import { GET, POST, PUT } from "./route";

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const PATIENT_ID = "33333333-3333-4333-8333-333333333333";

interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
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
  search?: string;
  method?: string;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: {
      pathname: props.pathname,
      searchParams: new URLSearchParams(props.search ?? ""),
    },
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

function upstreamOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("/api/scheduling proxy", () => {
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

  it("maps the appointments root to the upstream /appointments route", async () => {
    fetchMock.mockResolvedValue(upstreamOk([{ id: APPOINTMENT_ID }]));

    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments",
      headers: new Headers({ "x-request-id": "req-abc" }),
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;
    expect(await response.json()).toEqual([{ id: APPOINTMENT_ID }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/appointments");
    expect(call[1].headers).toMatchObject({
      cookie: `${STAFF_SESSION_COOKIE}=token-123`,
      "x-request-id": "req-abc",
    });
  });

  it("forwards only the allowlisted query parameters and drops the rest", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments",
      search: `?branchId=${BRANCH_ID}&status=CONFIRMED&patientId=${PATIENT_ID}&admin=true&status=ALLOW`,
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe(
      `http://localhost:3001/appointments?branchId=${BRANCH_ID}&patientId=${PATIENT_ID}&status=CONFIRMED`
    );
  });

  it("percent-encodes a forwarded query value so it cannot reshape the upstream URL", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments",
      search: "?status=..%2F..%2Fpatients",
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe("http://localhost:3001/appointments?status=..%2F..%2Fpatients");
  });

  it("maps the options and named-command routes to their upstream shapes", async () => {
    fetchMock.mockResolvedValue(upstreamOk({}));

    await GET(
      mockNextRequest({
        pathname: "/api/scheduling/appointments/options",
      }) as unknown as Parameters<typeof GET>[0]
    );
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "http://localhost:3001/appointments/options"
    );

    fetchMock.mockClear();
    await POST(
      mockNextRequest({
        pathname: `/api/scheduling/appointments/${APPOINTMENT_ID}/no-show`,
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://localhost:3001/appointments/${APPOINTMENT_ID}/no-show`
    );
  });

  it("maps the booking-request list and decision routes to their upstream shapes", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    await GET(
      mockNextRequest({
        pathname: "/api/scheduling/booking-requests",
      }) as unknown as Parameters<typeof GET>[0]
    );
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "http://localhost:3001/booking-requests"
    );

    fetchMock.mockClear();
    await POST(
      mockNextRequest({
        pathname: `/api/scheduling/booking-requests/${APPOINTMENT_ID}/approve`,
        body: byteStream([JSON.stringify({ branchId: BRANCH_ID })]),
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://localhost:3001/booking-requests/${APPOINTMENT_ID}/approve`
    );

    fetchMock.mockClear();
    await POST(
      mockNextRequest({
        pathname: `/api/scheduling/booking-requests/${APPOINTMENT_ID}/reject`,
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    );
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://localhost:3001/booking-requests/${APPOINTMENT_ID}/reject`
    );
  });

  it("forwards the availability query to the upstream availability route", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ slots: [] }));

    // Query keys are emitted in the allowlist order, so the expected URL below
    // is the contract of that list, not of the caller's ordering.
    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments/availability",
      search: `?date=2026-06-26&durationMinutes=30&stepMinutes=15&branchId=${BRANCH_ID}&professionalMembershipId=${APPOINTMENT_ID}`,
    });

    await GET(request as unknown as Parameters<typeof GET>[0]);

    const call = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(call[0]).toBe(
      `http://localhost:3001/appointments/availability?branchId=${BRANCH_ID}&professionalMembershipId=${APPOINTMENT_ID}&date=2026-06-26&durationMinutes=30&stepMinutes=15`
    );
  });

  it("rejects availability near misses: method and path depth", async () => {
    // The shape is read-only: neither write verb can reach it.
    const postAvailability = (await POST(
      mockNextRequest({
        pathname: "/api/scheduling/appointments/availability",
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    )) as Response;
    expect(postAvailability.status).toBe(404);

    const putAvailability = (await PUT(
      mockNextRequest({
        pathname: "/api/scheduling/appointments/availability",
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof PUT>[0]
    )) as Response;
    expect(putAvailability.status).toBe(404);

    // A deeper path is not a shape at all, even with an otherwise valid prefix.
    const deeper = (await GET(
      mockNextRequest({
        pathname: "/api/scheduling/appointments/availability/anything",
      }) as unknown as Parameters<typeof GET>[0]
    )) as Response;
    expect(deeper.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty path segment instead of normalizing it away", async () => {
    // `//` would otherwise collapse onto the allowlisted shape, so the matched
    // route would not be the path that was actually requested.
    const doubled = (await GET(
      mockNextRequest({
        pathname: "/api/scheduling/appointments//availability",
      }) as unknown as Parameters<typeof GET>[0]
    )) as Response;
    expect(doubled.status).toBe(400);

    const trailing = (await GET(
      mockNextRequest({
        pathname: "/api/scheduling/appointments/availability/",
      }) as unknown as Parameters<typeof GET>[0]
    )) as Response;
    expect(trailing.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects booking-request near misses: method, action, id shape and encoding", async () => {
    // GET is not exposed on the approve/reject shape.
    const getApprove = (await GET(
      mockNextRequest({
        pathname: `/api/scheduling/booking-requests/${APPOINTMENT_ID}/approve`,
      }) as unknown as Parameters<typeof GET>[0]
    )) as Response;
    expect(getApprove.status).toBe(404);

    // POST is not exposed on the list shape.
    const postList = (await POST(
      mockNextRequest({
        pathname: "/api/scheduling/booking-requests",
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    )) as Response;
    expect(postList.status).toBe(404);

    // An unknown action segment is not allowlisted.
    const unknownAction = (await POST(
      mockNextRequest({
        pathname: `/api/scheduling/booking-requests/${APPOINTMENT_ID}/escalate`,
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    )) as Response;
    expect(unknownAction.status).toBe(404);

    // A malformed id can never fill the UUID slot.
    const malformed = (await POST(
      mockNextRequest({
        pathname: "/api/scheduling/booking-requests/not-a-uuid/approve",
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    )) as Response;
    expect(malformed.status).toBe(404);

    // A percent-encoded request path is rejected before any upstream call.
    const encoded = (await POST(
      mockNextRequest({
        pathname: `/api/scheduling/booking-requests/${APPOINTMENT_ID}%2Fescalate/reject`,
        body: byteStream([JSON.stringify({})]),
      }) as unknown as Parameters<typeof POST>[0]
    )) as Response;
    expect(encoded.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the allowlisted session cookie and x-request-id headers", async () => {
    fetchMock.mockResolvedValue(upstreamOk([]));

    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments",
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
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.headers).not.toHaveProperty("x-forwarded-for");
  });

  it("forwards the PUT body as the caller's raw stream without buffering", async () => {
    fetchMock.mockResolvedValue(upstreamOk({ id: APPOINTMENT_ID }));

    const body = byteStream([JSON.stringify({ startAt: "a", endAt: "b", version: 1 })]);
    const request = mockNextRequest({
      pathname: `/api/scheduling/appointments/${APPOINTMENT_ID}`,
      method: "PUT",
      body,
    });

    await PUT(request as unknown as Parameters<typeof PUT>[0]);

    const init = fetchInit();
    expect(init.method).toBe("PUT");
    // Identity proves the raw ReadableStream was piped through, not decoded.
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
    expect(init.headers).toEqual({
      cookie: `${STAFF_SESSION_COOKIE}=token-123`,
      "content-type": "application/json",
    });
  });

  it("rejects an unknown route with 404 and never calls upstream", async () => {
    const request = mockNextRequest({ pathname: "/api/scheduling/patients" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Scheduling route not found." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a method the upstream contract does not expose", async () => {
    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments/options",
      method: "PUT",
      body: byteStream(["{}"]),
    });

    const response = (await PUT(request as unknown as Parameters<typeof PUT>[0])) as Response;

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed appointment id and traversal or encoded segments", async () => {
    const malformed = mockNextRequest({
      pathname: "/api/scheduling/appointments/not-a-uuid/confirm",
    });
    const malformedResponse = (await POST(
      malformed as unknown as Parameters<typeof POST>[0]
    )) as Response;
    expect(malformedResponse.status).toBe(404);

    const traversal = mockNextRequest({
      pathname: "/api/scheduling/appointments/..%2F..%2Fpatients",
    });
    const traversalResponse = (await GET(
      traversal as unknown as Parameters<typeof GET>[0]
    )) as Response;
    expect(traversalResponse.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no scheduling path with 400", async () => {
    const request = mockNextRequest({ pathname: "/api/scheduling" });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Invalid scheduling request path." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams the upstream response body and preserves error envelopes", async () => {
    const upstreamStream = byteStream(["raw", "-bytes"]);
    fetchMock.mockResolvedValue(
      new Response(upstreamStream, {
        status: 409,
        headers: { "content-type": "application/json", "x-request-id": "req-upstream" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/scheduling/appointments",
      method: "POST",
      body: byteStream(["{}"]),
    });

    const response = (await POST(request as unknown as Parameters<typeof POST>[0])) as Response;

    expect(response.status).toBe(409);
    expect(response.body).toBe(upstreamStream);
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    expect(await response.text()).toBe("raw-bytes");
  });

  it("preserves the 403 permission-denied envelope", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Access denied" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({ pathname: "/api/scheduling/appointments" });
    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
