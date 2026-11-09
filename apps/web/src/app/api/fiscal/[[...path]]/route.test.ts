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

const ID = "99999999-9999-4999-8999-999999999999";
interface MockNextRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}
function mockNextRequest(props: {
  pathname: string;
  search?: string;
  headers?: Headers;
  body?: string;
}): MockNextRequest {
  const headers = props.headers ?? new Headers();
  return {
    nextUrl: { pathname: props.pathname, searchParams: new URLSearchParams(props.search ?? "") },
    headers: { get: (name) => headers.get(name) },
    text: () => Promise.resolve(props.body ?? ""),
  };
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

  it("keeps the void, signing material and every other method or path out of the proxy", async () => {
    for (const [method, path, body] of [
      ["POST", `/api/fiscal/timbrado-ranges/${ID}/void`, RETIRE_BODY],
      ["GET", "/api/fiscal/signing-material", ""],
      ["POST", "/api/fiscal/signing-material", "{}"],
      ["POST", `/api/fiscal/signing-material/${ID}/retire`, RETIRE_BODY],
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
      ["PUT", "/api/fiscal/fiscal-documents", ISSUE_BODY],
      ["PUT", `/api/fiscal/fiscal-documents/${ID}/cancel`, CANCEL_BODY],
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
