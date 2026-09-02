/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

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
  text: () => Promise<string>;
}

function mockNextRequest(props: {
  pathname: string;
  method?: string;
  headers?: Headers;
  bodyText?: string;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname },
    headers: {
      get: (name: string) => headers.get(name),
    },
    text: () => Promise.resolve(props.bodyText ?? ""),
  };
}

describe("/api/customers proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
  });

  it("forwards the session cookie and x-request-id to the upstream API", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: "cust-1", displayName: "Ana" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/customers",
      headers: new Headers({ "x-request-id": "req-abc" }),
    });

    const response = (await GET(request as unknown as Parameters<typeof GET>[0])) as Response;
    const body = (await response.json()) as { id: string; displayName: string }[];

    expect(body).toEqual([{ id: "cust-1", displayName: "Ana" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body?: string },
    ];
    const url = call[0];
    const init = call[1];
    expect(url).toBe("http://localhost:3001/customers");
    expect(init.headers).toMatchObject({
      cookie: "session=token-123",
      "x-request-id": "req-abc",
    });
  });

  it("streams PUT bodies verbatim", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "cust-1", displayName: "Ana María" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/customers/cust-1",
      method: "PUT",
      headers: new Headers({ "content-type": "application/json" }),
      bodyText: JSON.stringify({ displayName: "Ana María" }),
    });

    await PUT(request as unknown as Parameters<typeof PUT>[0]);

    const putCall = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body?: string },
    ];
    const init = putCall[1];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ displayName: "Ana María" }));
    expect(init.headers).toMatchObject({
      cookie: "session=token-123",
      "content-type": "application/json",
    });
  });

  it("omits x-request-id when the incoming request does not carry one", async () => {
    cookiesMock.mockResolvedValue({
      toString: () => "session=token-123",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "cust-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const request = mockNextRequest({
      pathname: "/api/customers/cust-1/deactivate",
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      bodyText: JSON.stringify({}),
    });

    await POST(request as unknown as Parameters<typeof POST>[0]);

    const postCall = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body?: string },
    ];
    const postInit = postCall[1];
    expect(postInit.headers).toHaveProperty("cookie");
    expect(postInit.headers).not.toHaveProperty("x-request-id");
  });
});
