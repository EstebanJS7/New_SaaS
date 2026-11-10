/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTAL_SESSION_COOKIE, STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

const cookiesMock = vi.fn();
const fetchMock = vi.fn();
(global as typeof globalThis & { fetch: typeof fetchMock }).fetch = fetchMock;
vi.mock("next/headers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- test mock factory returns a dynamic stub
  cookies: () => cookiesMock(),
}));
import { GET, POST, PUT } from "./route";

describe("FISC-019/020 restricted setup proxy additions", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "staff" }));
    fetchMock.mockImplementation(() => Promise.resolve(upstreamOk(200)));
  });
  it("streams the certificate multipart without reading the file or password", async () => {
    const text = vi.fn();
    const formData = vi.fn();
    const body = new ReadableStream<Uint8Array>();
    const request = {
      ...mockNextRequest({
        pathname: "/api/fiscal/signing-material",
        headers: new Headers({ "content-type": "multipart/form-data; boundary=opaque" }),
      }),
      text,
      formData,
      body,
    };
    expect((await POST(request as never)).status).toBe(200);
    expect(text).not.toHaveBeenCalled();
    expect(formData).not.toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { duplex: string };
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "multipart/form-data; boundary=opaque"
    );
    expect(new Headers(init.headers).get("cookie")).toBe(`${STAFF_SESSION_COOKIE}=staff`);
  });
  it("forwards only the explicit metadata/CSC/retirement/classification pairs", async () => {
    for (const [method, path, body] of [
      ["GET", "/api/fiscal/signing-material", ""],
      ["GET", "/api/fiscal/csc", ""],
      [
        "POST",
        "/api/fiscal/csc",
        JSON.stringify({ environment: "TEST", idCsc: "0001", value: "Aa12".repeat(8) }),
      ],
      ["POST", `/api/fiscal/signing-material/${ID}/retire`, RETIRE_BODY],
      ["POST", `/api/fiscal/csc/${ID}/retire`, RETIRE_BODY],
      ["GET", "/api/fiscal/tax-classifications", ""],
      [
        "PUT",
        "/api/fiscal/tax-classifications/IVA_10",
        JSON.stringify({ affectation: "GRAVADO_IVA", proportionality: null }),
      ],
    ] as const)
      expect((await missing(method, path, undefined, body)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
  it("rejects non-UUID secret ids, unexpected methods/body keys and malformed multipart", async () => {
    for (const [method, path, body] of [
      ["POST", "/api/fiscal/csc/no-id/retire", RETIRE_BODY],
      ["POST", "/api/fiscal/signing-material/no-id/retire", RETIRE_BODY],
      ["PUT", "/api/fiscal/csc", "{}"],
      ["POST", "/api/fiscal/csc", '{"tenantId":"spoof"}'],
      ["PUT", "/api/fiscal/tax-classifications/IVA_10", '{"tenantId":"spoof"}'],
      ["POST", "/api/fiscal/signing-material", "{}"],
    ] as const)
      expect((await missing(method, path, undefined, body)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const ID = "99999999-9999-4999-8999-999999999999";
interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  body: ReadableStream<Uint8Array> | null;
}
/**
 * A request mock carries BOTH a stream and `text()` so the same cases can be
 * read by a buffering and a streaming implementation; the bound is proven by
 * the stream, and `text()` stays observable for the tests that assert it is
 * never called.
 */
function mockNextRequest(props: {
  pathname: string;
  search?: string;
  headers?: Headers;
  body?: string;
  bodyStream?: ReadableStream<Uint8Array> | null;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname, searchParams: new URLSearchParams(props.search ?? "") },
    headers: { get: (name) => headers.get(name) },
    text: () => Promise.resolve(props.body ?? ""),
    body:
      props.bodyStream !== undefined
        ? props.bodyStream
        : props.body === undefined
          ? null
          : streamOf([utf8(props.body)]),
  };
}
function streamOf(
  chunks: readonly Uint8Array[],
  onCancel?: () => void
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel?.();
    },
  });
}
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
function utf8Chunks(text: string, size: number): Uint8Array[] {
  const bytes = utf8(text);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size)
    chunks.push(bytes.slice(offset, offset + size));
  return chunks;
}
/** A stream that never ends: any unbounded read hangs instead of passing. */
function endlessStream(chunk: Uint8Array, onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk.slice());
    },
    cancel() {
      onCancel();
    },
  });
}
interface CookieValue {
  readonly name: string;
  readonly value: string;
}
function cookieStore(...entries: readonly CookieValue[]) {
  return {
    get: (name: string) => entries.find((entry) => entry.name === name),
    toString: () => entries.map((entry) => `${entry.name}=${entry.value}`).join("; "),
  };
}
type Handler = (request: MockNextRequest) => Promise<Response>;
type Method = "GET" | "POST" | "PUT";
async function dispatch(method: Method, request: MockNextRequest): Promise<Response> {
  const handlers: Record<Method, Handler> = {
    GET: (value) => GET(value as unknown as Parameters<typeof GET>[0]),
    POST: (value) => POST(value as unknown as Parameters<typeof POST>[0]),
    PUT: (value) => PUT(value as unknown as Parameters<typeof PUT>[0]),
  };
  return handlers[method](request);
}
interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  cache?: string;
}
function fetchInit(index = 0): FetchInit {
  return (fetchMock.mock.calls[index] as unknown as [string, FetchInit])[1];
}
function upstreamOk(status = 202): Response {
  return new Response("upstream-bytes", {
    status,
    headers: { "content-type": "application/fiscal+json", "x-request-id": "upstream-id" },
  });
}
const ISSUE_BODY = '{ "invoiceId" : "' + ID + '" }';
const CANCEL_BODY = '{ "reason" : "duplicate" }';
const SERVED_ROUTES = [
  {
    method: "GET",
    pathname: "/api/fiscal/fiscal-documents",
    upstream: "/fiscal-documents",
    body: "",
  },
  {
    method: "GET",
    pathname: `/api/fiscal/fiscal-documents/${ID}`,
    upstream: `/fiscal-documents/${ID}`,
    body: "",
  },
  {
    method: "POST",
    pathname: "/api/fiscal/fiscal-documents",
    upstream: "/fiscal-documents",
    body: ISSUE_BODY,
  },
  {
    method: "POST",
    pathname: `/api/fiscal/fiscal-documents/${ID}/cancel`,
    upstream: `/fiscal-documents/${ID}/cancel`,
    body: CANCEL_BODY,
  },
] as const;
interface ErrorEnvelope {
  error: { code: string; message: string };
}
async function expectError(
  response: Response,
  status: number,
  code: string,
  message: string
): Promise<void> {
  expect(response.status).toBe(status);
  expect((await response.json()) as ErrorEnvelope).toEqual({ error: { code, message } });
}
const missing = (method: Method, pathname: string, search?: string, body?: string) =>
  dispatch(method, mockNextRequest({ pathname, search, body }));

describe("/api/fiscal proxy", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards every served pair, exact bodies, allowlisted headers, and streamed response metadata", async () => {
    for (const route of SERVED_ROUTES) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(upstreamOk());
      const requestId = "client-id";
      const response = await dispatch(
        route.method,
        mockNextRequest({
          pathname: route.pathname,
          body: route.body,
          headers: new Headers({
            "x-request-id": requestId,
            authorization: "drop",
            "x-tenant-id": "drop",
          }),
        })
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
      expect(url).toBe(`http://localhost:3001${route.upstream}`);
      expect(init.method).toBe(route.method);
      expect(init.cache).toBe("no-store");
      expect(init.body).toBe(route.body || undefined);
      expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
      expect(init.headers["x-request-id"]).toBe(requestId);
      expect(Object.keys(init.headers).sort()).toEqual(
        route.body ? ["content-type", "cookie", "x-request-id"] : ["cookie", "x-request-id"]
      );
      if (route.body) expect(init.headers["content-type"]).toBe("application/json");
      expect(response.status).toBe(202);
      expect(response.headers.get("content-type")).toBe("application/fiscal+json");
      expect(response.headers.get("x-request-id")).toBe("upstream-id");
      expect(await response.text()).toBe("upstream-bytes");
    }
  });

  it("forwards the allowlisted list status and rejects unsupported query parameters", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    await missing("GET", "/api/fiscal/fiscal-documents", "?status=QUEUED");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "http://localhost:3001/fiscal-documents?status=QUEUED"
    );
    for (const [method, path, search] of [
      ["GET", "/api/fiscal/fiscal-documents", "?tenantId=x"],
      ["GET", `/api/fiscal/fiscal-documents/${ID}`, "?status=QUEUED"],
      ["POST", "/api/fiscal/fiscal-documents", "?status=QUEUED"],
      ["POST", `/api/fiscal/fiscal-documents/${ID}/cancel`, "?status=QUEUED"],
    ] as const) {
      fetchMock.mockReset();
      await expectError(
        await missing(method, path, search),
        404,
        "NOT_FOUND",
        "Fiscal route was not found."
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("rejects unknown paths and unsupported verbs with the uniform not-found envelope", async () => {
    for (const [method, path] of [
      ["GET", "/api/fiscal/unknown"],
      ["GET", "/api/fiscal/fiscal-documents/one/extra"],
      ["POST", `/api/fiscal/fiscal-documents/${ID}`],
      ["GET", `/api/fiscal/fiscal-documents/${ID}/cancel`],
    ] as const) {
      await expectError(
        await missing(method, path),
        404,
        "NOT_FOUND",
        "Fiscal route was not found."
      );
    }
    const module = (await import("./route")) as Record<string, unknown>;
    for (const verb of ["PATCH", "DELETE"]) expect(module).not.toHaveProperty(verb);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed paths containing percent escapes or empty and dot segments", async () => {
    for (const pathname of [
      "/api/fiscal/fiscal-documents/%",
      "/api/fiscal/fiscal-documents//x",
      "/api/fiscal/fiscal-documents/.",
      "/api/fiscal/fiscal-documents/..",
      "/api/fiscal/fiscal-documents/",
    ]) {
      await expectError(
        await missing("GET", pathname),
        400,
        "VALIDATION_FAILED",
        "Invalid fiscal request path."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only contracted body keys and never reads bodies on shapes without contracts", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    await missing("POST", "/api/fiscal/fiscal-documents", undefined, ISSUE_BODY);
    expect(fetchInit().body).toBe(ISSUE_BODY);
    await missing("POST", `/api/fiscal/fiscal-documents/${ID}/cancel`, undefined, CANCEL_BODY);
    expect(fetchInit(1).body).toBe(CANCEL_BODY);
    // An absent or empty body is forwarded as ABSENT, never invented: the API's
    // Zod owns value validation, so a missing body is the API's 400, not this
    // proxy's. Only a PRESENT body that is not a contracted object is a local 400.
    await missing("POST", "/api/fiscal/fiscal-documents");
    expect(fetchInit(fetchMock.mock.calls.length - 1).body).toBeUndefined();
    await missing("POST", `/api/fiscal/fiscal-documents/${ID}/cancel`);
    expect(fetchInit(fetchMock.mock.calls.length - 1).body).toBeUndefined();
    const invalid = ["[]", '"text"', "12", "null", JSON.stringify({ invoiceId: ID, extra: true })];
    for (const body of invalid) {
      await expectError(
        await missing("POST", "/api/fiscal/fiscal-documents", undefined, body),
        400,
        "VALIDATION_FAILED",
        "Invalid fiscal document create body."
      );
    }
    await expectError(
      await missing(
        "POST",
        `/api/fiscal/fiscal-documents/${ID}/cancel`,
        undefined,
        JSON.stringify({ reason: "x", extra: true })
      ),
      400,
      "VALIDATION_FAILED",
      "Invalid fiscal document cancel body."
    );
    let reads = 0;
    const request = mockNextRequest({ pathname: "/api/fiscal/fiscal-documents" });
    request.text = () => {
      reads += 1;
      return Promise.resolve("unexpected");
    };
    // A GET carries no body contract, so the proxy must never read the stream;
    // it is still forwarded, with no body attached.
    await dispatch("GET", request);
    expect(reads).toBe(0);
    expect(fetchInit(fetchMock.mock.calls.length - 1).body).toBeUndefined();
  });

  it("rejects missing or empty staff sessions and never reads portal credentials", async () => {
    for (const value of [undefined, ""]) {
      const entries = value === undefined ? [] : [{ name: STAFF_SESSION_COOKIE, value }];
      cookiesMock.mockResolvedValue(cookieStore(...entries));
      await expectError(
        await missing("GET", "/api/fiscal/fiscal-documents"),
        401,
        "UNAUTHENTICATED",
        "Authentication required."
      );
    }
    cookiesMock.mockResolvedValue(cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal" }));
    await expectError(
      await missing("GET", "/api/fiscal/fiscal-documents"),
      401,
      "UNAUTHENTICATED",
      "Authentication required."
    );
    expect(cookiesMock).toHaveBeenCalledTimes(3);
    expect(
      cookiesMock.mock.results.every(
        (result) => !String(result.value).includes(PORTAL_SESSION_COOKIE)
      )
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never forwards synthesized tenant, role, permission, or user headers", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    await dispatch(
      "GET",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({
          "x-tenant-id": "t",
          "x-tenant-slug": "s",
          "x-user-role": "OWNER",
          "x-user-id": "u",
          "x-permissions": "all",
          "x-membership-id": "m",
        }),
      })
    );
    expect(Object.keys(fetchInit().headers)).toEqual(["cookie"]);
  });
});

const PROFILE_BODY = JSON.stringify({
  ruc: "80012345",
  checkDigit: "6",
  taxpayerType: 2,
  regimeCode: null,
  legalName: "Clínica Demo S.A.",
  tradeName: null,
  responsibleIssuer: null,
  transactionType: 2,
  taxType: 1,
  emissionType: 1,
  activities: [{ code: "75000", description: "Actividades veterinarias" }],
});
const POINT_BODY = JSON.stringify({ establishmentId: ID, expeditionPoint: "001", documentType: 1 });
const ESTABLISHMENT_BODY = JSON.stringify({
  code: "001",
  addressLine: "Av. España",
  houseNumber: 1234,
  addressComplement1: null,
  addressComplement2: null,
  departmentCode: 1,
  district: null,
  cityCode: 1,
  cityName: "Asunción",
  phone: "021600000",
  email: "fiscal@demo.test",
  branchName: null,
});
const RANGE_BODY = JSON.stringify({
  establishmentId: ID,
  expeditionPoint: "001",
  documentType: 5,
  series: null,
  timbradoNumber: "12345678",
  rangeFrom: 1,
  rangeTo: 1000,
  validityStart: "2026-01-01",
});
const RETIRE_BODY = JSON.stringify({ reason: "Timbrado vencido" });

/** FISC-018: the settings screen's routes, each with its method and upstream path. */
const SETTINGS_ROUTES = [
  ["GET", "emitter-profile", "/fiscal/emitter-profile", ""],
  ["PUT", "emitter-profile", "/fiscal/emitter-profile", PROFILE_BODY],
  ["PUT", "emitter-profile/issuance-point", "/fiscal/emitter-profile/issuance-point", POINT_BODY],
  ["GET", "establishments", "/fiscal/establishments", ""],
  ["POST", "establishments", "/fiscal/establishments", ESTABLISHMENT_BODY],
  ["PUT", `establishments/${ID}`, `/fiscal/establishments/${ID}`, ESTABLISHMENT_BODY],
  ["GET", "timbrado-ranges", "/fiscal/timbrado-ranges", ""],
  ["POST", "timbrado-ranges", "/fiscal/timbrado-ranges", RANGE_BODY],
  ["POST", `timbrado-ranges/${ID}/retire`, `/fiscal/timbrado-ranges/${ID}/retire`, RETIRE_BODY],
] as const;

describe("/api/fiscal proxy — FISC-018 settings routes", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(SETTINGS_ROUTES)(
    "forwards %s %s to the API's %s with the exact body",
    async (method, path, upstream, body) => {
      fetchMock.mockResolvedValue(upstreamOk(200));
      const response = await missing(method, `/api/fiscal/${path}`, undefined, body);
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
      expect(url).toBe(`http://localhost:3001${upstream}`);
      expect(init.method).toBe(method);
      expect(init.body).toBe(body || undefined);
      expect(Object.keys(init.headers).sort()).toEqual(
        body ? ["content-type", "cookie"] : ["cookie"]
      );
      expect(await response.text()).toBe("upstream-bytes");
    }
  );

  it("keeps the void and every other unapproved method or path out of the proxy", async () => {
    for (const [method, path, body] of [
      ["POST", `/api/fiscal/timbrado-ranges/${ID}/void`, RETIRE_BODY],
      ["POST", "/api/fiscal/emitter-profile", PROFILE_BODY],
      ["GET", "/api/fiscal/emitter-profile/issuance-point", ""],
      ["POST", "/api/fiscal/emitter-profile/issuance-point", POINT_BODY],
      ["PUT", "/api/fiscal/establishments", ESTABLISHMENT_BODY],
      ["GET", `/api/fiscal/establishments/${ID}`, ""],
      ["POST", `/api/fiscal/establishments/${ID}`, ESTABLISHMENT_BODY],
      ["PUT", "/api/fiscal/timbrado-ranges", RANGE_BODY],
      ["GET", `/api/fiscal/timbrado-ranges/${ID}`, ""],
      ["PUT", `/api/fiscal/timbrado-ranges/${ID}/retire`, RETIRE_BODY],
      ["GET", `/api/fiscal/timbrado-ranges/${ID}/retire`, ""],
      ["PUT", "/api/fiscal/unknown", "{}"],
      ["PUT", `/api/fiscal/fiscal-documents/${ID}/extra`, "{}"],
      ["GET", "/api/fiscal/fiscal/emitter-profile", ""],
    ] as const) {
      await expectError(
        await missing(method, path, undefined, body),
        404,
        "NOT_FOUND",
        "Fiscal route was not found."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Before FISC-018 exported PUT, Next.js answered 405 to a PUT on the documents
  // routes; the proxy keeps that answer, with the methods each shape accepts.
  it("answers PUT on a fiscal-documents shape with 405 and its Allow header", async () => {
    for (const [path, body, allow] of [
      ["/api/fiscal/fiscal-documents", ISSUE_BODY, "GET, POST"],
      [`/api/fiscal/fiscal-documents/${ID}`, "{}", "GET"],
      [`/api/fiscal/fiscal-documents/${ID}/cancel`, CANCEL_BODY, "POST"],
    ] as const) {
      const response = await missing("PUT", path, undefined, body);
      expect(response.headers.get("allow")).toBe(allow);
      await expectError(
        response,
        405,
        "METHOD_NOT_ALLOWED",
        "Fiscal route does not accept this method."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a trailing slash and an encoded slash in an id slot", async () => {
    for (const [method, path, body] of [
      ["GET", "/api/fiscal/establishments/", ""],
      ["PUT", `/api/fiscal/establishments/${ID}/`, ESTABLISHMENT_BODY],
      ["POST", `/api/fiscal/timbrado-ranges/${ID}/retire/`, RETIRE_BODY],
      ["PUT", "/api/fiscal/establishments/abc%2Fdef", ESTABLISHMENT_BODY],
      ["PUT", `/api/fiscal/establishments/${ID}%2F..`, ESTABLISHMENT_BODY],
    ] as const) {
      await expectError(
        await missing(method, path, undefined, body),
        400,
        "VALIDATION_FAILED",
        "Invalid fiscal request path."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an uppercase UUID, which the API's uuid() accepts too", async () => {
    fetchMock.mockResolvedValue(upstreamOk(200));
    const upper = "ABCDEF12-3456-4789-8ABC-DEF012345678";
    const response = await missing(
      "PUT",
      `/api/fiscal/establishments/${upper}`,
      undefined,
      ESTABLISHMENT_BODY
    );
    expect(response.status).toBe(200);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://localhost:3001/fiscal/establishments/${upper}`
    );
  });

  it("forwards ids only as UUIDs", async () => {
    for (const [method, path, body] of [
      ["PUT", "/api/fiscal/establishments/not-a-uuid", ESTABLISHMENT_BODY],
      ["PUT", "/api/fiscal/establishments/1", ESTABLISHMENT_BODY],
      ["POST", "/api/fiscal/timbrado-ranges/abc/retire", RETIRE_BODY],
      ["GET", "/api/fiscal/fiscal-documents/abc", ""],
      ["POST", "/api/fiscal/fiscal-documents/abc/cancel", CANCEL_BODY],
    ] as const) {
      await expectError(
        await missing(method, path, undefined, body),
        400,
        "VALIDATION_FAILED",
        "Invalid fiscal request path."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects query strings on the settings routes", async () => {
    for (const [method, path] of [
      ["GET", "/api/fiscal/emitter-profile"],
      ["GET", "/api/fiscal/establishments"],
      ["GET", "/api/fiscal/timbrado-ranges"],
      ["PUT", "/api/fiscal/emitter-profile/issuance-point"],
    ] as const) {
      await expectError(
        await missing(method, path, "?tenantId=x"),
        404,
        "NOT_FOUND",
        "Fiscal route was not found."
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses bodies with keys outside each route's contract", async () => {
    for (const [method, path, body, message] of [
      [
        "PUT",
        "/api/fiscal/emitter-profile",
        JSON.stringify({ ruc: "80012345", tenantId: ID }),
        "Invalid emitter fiscal profile body.",
      ],
      [
        "PUT",
        "/api/fiscal/emitter-profile/issuance-point",
        JSON.stringify({ establishmentId: ID, expeditionPoint: "001", documentType: 1, x: 1 }),
        "Invalid issuance point declaration body.",
      ],
      [
        "POST",
        "/api/fiscal/establishments",
        JSON.stringify({ code: "001", id: ID }),
        "Invalid establishment body.",
      ],
      ["PUT", `/api/fiscal/establishments/${ID}`, "[]", "Invalid establishment body."],
      [
        "POST",
        "/api/fiscal/timbrado-ranges",
        JSON.stringify({ status: "ACTIVE" }),
        "Invalid timbrado range body.",
      ],
      [
        "POST",
        `/api/fiscal/timbrado-ranges/${ID}/retire`,
        JSON.stringify({ reason: "x", from: 1 }),
        "Invalid retirement body.",
      ],
    ] as const) {
      await expectError(
        await missing(method, path, undefined, body),
        400,
        "VALIDATION_FAILED",
        message
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * S6: the proxy reads a contracted JSON body itself and refuses anything above
 * 64 KiB with a stable 413, before any upstream request. The byte count is the
 * UTF-8 body actually streamed, never the declared `content-length` alone.
 */
const MAX_JSON_BODY_BYTES = 64 * 1024;
const BODY_LIMIT_MESSAGE = "Fiscal request body exceeds 65536 bytes.";
function padWithSpaces(text: string, bytes: number): string {
  return text + " ".repeat(bytes - utf8(text).byteLength);
}

describe("/api/fiscal proxy — bounded JSON bodies (S6)", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("accepts a whitespace-padded body exactly at the 65536-byte limit", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    const body = padWithSpaces(ISSUE_BODY, MAX_JSON_BODY_BYTES);
    expect(utf8(body).byteLength).toBe(MAX_JSON_BODY_BYTES);
    const response = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({ "content-length": String(MAX_JSON_BODY_BYTES) }),
        bodyStream: streamOf(utf8Chunks(body, 8192)),
      })
    );
    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchInit().body).toBe(body);
    expect(fetchInit().headers["content-type"]).toBe("application/json");
  });

  it("assembles a chunked body in order and forwards it unchanged", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    const response = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/fiscal/fiscal-documents/${ID}/cancel`,
        bodyStream: streamOf(utf8Chunks(CANCEL_BODY, 5)),
      })
    );
    expect(response.status).toBe(202);
    expect(fetchInit().body).toBe(CANCEL_BODY);
  });

  it("rejects a chunked body one byte over the limit, cancelling the reader", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    let cancelled = false;
    // Trailing bytes keep the stream open past the overflow, so the proxy must
    // cancel it rather than drain the rest of the upload.
    const body = padWithSpaces(ISSUE_BODY, MAX_JSON_BODY_BYTES + 1) + " ".repeat(8192);
    const response = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        bodyStream: streamOf(utf8Chunks(body, 8192), () => {
          cancelled = true;
        }),
      })
    );
    await expectError(response, 413, "PAYLOAD_TOO_LARGE", BODY_LIMIT_MESSAGE);
    expect(cancelled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared content-length without reading the body", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    const bodyStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(utf8("{}"));
      },
    });
    const response = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({ "content-length": String(MAX_JSON_BODY_BYTES + 1) }),
        bodyStream,
      })
    );
    await expectError(response, 413, "PAYLOAD_TOO_LARGE", BODY_LIMIT_MESSAGE);
    // The declared length alone rejects it: the body is never locked or read.
    expect(bodyStream.locked).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the bytes actually streamed, not the declared length", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    // A length that under-declares the body is a hint only: the body still passes.
    const accepted = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({ "content-length": "10" }),
        bodyStream: streamOf([utf8(ISSUE_BODY)]),
      })
    );
    expect(accepted.status).toBe(202);
    expect(fetchInit().body).toBe(ISSUE_BODY);
    // A length that lies low cannot hide an endless body: the cap stops the read.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstreamOk());
    let cancelled = false;
    const rejected = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({ "content-length": "10" }),
        bodyStream: endlessStream(utf8("x".repeat(1024)), () => {
          cancelled = true;
        }),
      })
    );
    await expectError(rejected, 413, "PAYLOAD_TOO_LARGE", BODY_LIMIT_MESSAGE);
    expect(cancelled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes: exactly 65536 accepted, two more rejected", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    const atLimit = `{"reason":"x${"é".repeat(32761)}"}`;
    const overLimit = `{"reason":"x${"é".repeat(32762)}"}`;
    expect(utf8(atLimit).byteLength).toBe(MAX_JSON_BODY_BYTES);
    expect(overLimit.length).toBeLessThan(MAX_JSON_BODY_BYTES);
    expect(utf8(overLimit).byteLength).toBe(MAX_JSON_BODY_BYTES + 2);
    const accepted = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/fiscal/fiscal-documents/${ID}/cancel`,
        bodyStream: streamOf(utf8Chunks(atLimit, 4096)),
      })
    );
    expect(accepted.status).toBe(202);
    expect(fetchInit().body).toBe(atLimit);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstreamOk());
    const rejected = await dispatch(
      "POST",
      mockNextRequest({
        pathname: `/api/fiscal/fiscal-documents/${ID}/cancel`,
        bodyStream: streamOf(utf8Chunks(overLimit, 4096)),
      })
    );
    await expectError(rejected, 413, "PAYLOAD_TOO_LARGE", BODY_LIMIT_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never echoes the rejected body or the secret it carried", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    const secret = "Aa12".repeat(17000);
    const body = JSON.stringify({ environment: "TEST", idCsc: "0001", value: secret });
    expect(utf8(body).byteLength).toBeGreaterThan(MAX_JSON_BODY_BYTES);
    const response = await dispatch("POST", mockNextRequest({ pathname: "/api/fiscal/csc", body }));
    expect(response.status).toBe(413);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: BODY_LIMIT_MESSAGE },
    });
    expect(text).not.toContain("Aa12");
    expect(text).not.toContain(secret.slice(0, 32));
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers 413 when the client's stream refuses to cancel", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    let reads = 0;
    const bodyStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(utf8("x".repeat(8192)));
      },
      cancel() {
        throw new Error("socket already gone");
      },
    });
    const response = await dispatch(
      "POST",
      mockNextRequest({ pathname: "/api/fiscal/fiscal-documents", bodyStream })
    );
    await expectError(response, 413, "PAYLOAD_TOO_LARGE", BODY_LIMIT_MESSAGE);
    expect(reads).toBeGreaterThan(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves GET and the streamed certificate upload outside the JSON limit", async () => {
    fetchMock.mockResolvedValue(upstreamOk());
    const reads = vi.fn();
    const listRequest = {
      ...mockNextRequest({
        pathname: "/api/fiscal/fiscal-documents",
        headers: new Headers({ "content-length": "1048576" }),
        bodyStream: streamOf([utf8("ignored")]),
      }),
      text: () => {
        reads();
        return Promise.resolve("ignored");
      },
    };
    const list = await dispatch("GET", listRequest);
    expect(list.status).toBe(202);
    expect(reads).not.toHaveBeenCalled();
    expect(fetchInit().body).toBeUndefined();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstreamOk());
    const upload = new ReadableStream<Uint8Array>();
    const response = await dispatch(
      "POST",
      mockNextRequest({
        pathname: "/api/fiscal/signing-material",
        headers: new Headers({
          "content-type": "multipart/form-data; boundary=opaque",
          "content-length": "2097152",
        }),
        bodyStream: upload,
      })
    );
    expect(response.status).toBe(202);
    const init = fetchInit() as unknown as { body: ReadableStream<Uint8Array>; duplex: string };
    expect(init.body).toBe(upload);
    expect(init.duplex).toBe("half");
  });
});

describe("/api/fiscal proxy — FISC-021 KuDE relay", () => {
  const KUDE_HTML = "<!doctype html><html><body>KuDE</body></html>";
  function upstreamKude(): Response {
    return new Response(KUDE_HTML, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": 'inline; filename="kude-0180.html"',
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
        "x-content-type-options": "nosniff",
        "x-request-id": "upstream-id",
        "set-cookie": "leak=1",
      },
    });
  }
  beforeEach(() => {
    cookiesMock.mockReset();
    fetchMock.mockReset();
    cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
  });

  it("forwards GET fiscal-documents/:id/kude and relays the HTML with its disposition and cache headers", async () => {
    fetchMock.mockResolvedValue(upstreamKude());
    const response = await missing("GET", `/api/fiscal/fiscal-documents/${ID}/kude`);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(url).toBe(`http://localhost:3001/fiscal-documents/${ID}/kude`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="kude-0180.html"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe("upstream-id");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe(KUDE_HTML);
  });

  it("relays an upstream refusal on the KuDE route as the API's JSON envelope", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"code":"NOT_FOUND","message":"x"}}', {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    );
    const response = await missing("GET", `/api/fiscal/fiscal-documents/${ID}/kude`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("keeps dropping content-disposition and cache-control on every other route", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(upstreamKude()));
    for (const path of [
      `/api/fiscal/fiscal-documents/${ID}`,
      "/api/fiscal/fiscal-documents",
      "/api/fiscal/csc",
    ]) {
      const response = await missing("GET", path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("cache-control")).toBeNull();
      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBeNull();
    }
  });

  it("refuses other methods, non-UUID ids, queries and bodies on the KuDE route", async () => {
    await expectError(
      await missing("POST", `/api/fiscal/fiscal-documents/${ID}/kude`, undefined, "{}"),
      404,
      "NOT_FOUND",
      "Fiscal route was not found."
    );
    const put = await missing("PUT", `/api/fiscal/fiscal-documents/${ID}/kude`, undefined, "{}");
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET");
    await expectError(
      await missing("GET", "/api/fiscal/fiscal-documents/not-a-uuid/kude"),
      400,
      "VALIDATION_FAILED",
      "Invalid fiscal request path."
    );
    await expectError(
      await missing("GET", `/api/fiscal/fiscal-documents/${ID}/kude`, "?download=1"),
      404,
      "NOT_FOUND",
      "Fiscal route was not found."
    );
    await expectError(
      await missing("GET", `/api/fiscal/fiscal-documents/${ID}/kude/extra`),
      404,
      "NOT_FOUND",
      "Fiscal route was not found."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
