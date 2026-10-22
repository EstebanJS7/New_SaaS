/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_SESSION_COOKIE, PORTAL_SESSION_COOKIE } from "@/lib/session-cookie";

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

import { GET, POST } from "./route";

/**
 * The staff imports BFF ([[IMP-005]]).
 *
 * What these cases pin, in order of what could go wrong:
 *
 * - the surface is a CLOSED allowlist: an unknown path, a wrong method, a
 *   malformed id or an out-of-contract query key is refused HERE, with no
 *   upstream call and (for the path cases) without even reading a credential —
 *   the proxy is not a tunnel to `/imports`;
 * - `tenantId` cannot travel as a query parameter, which is the one rule the
 *   allowlist exists to make structural;
 * - the multipart upload is forwarded as a parsed `FormData` with the staff
 *   cookie and NO hand-written `content-type`, so `fetch` writes its own
 *   boundary;
 * - every answer is buffered as TEXT with the upstream status and
 *   `content-type`, so the API's own message reaches the surface verbatim;
 * - the summary's `limit`/`offset` cross unchanged, because the ceiling is the
 *   API's contract and this boundary holds no second opinion about it.
 */

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";

interface MockNextRequest {
  nextUrl: { searchParams: URLSearchParams };
  headers: { get: (name: string) => string | null };
  formData: () => Promise<FormData>;
}

interface MockRequestInit {
  readonly search?: string;
  readonly headers?: Headers;
  /**
   * The multipart body this request carries. `undefined` makes `formData()`
   * throw, exactly as a JSON or empty body does — which is also the assertion
   * that a shape without a body never tries to parse one.
   */
  readonly form?: FormData;
}

function mockNextRequest(props: MockRequestInit = {}): MockNextRequest & {
  readonly formData: ReturnType<typeof vi.fn>;
} {
  const headers = props.headers ?? new Headers();
  const formData = vi.fn(() => {
    if (props.form === undefined) {
      return Promise.reject(new Error("This request carries no multipart body."));
    }
    return Promise.resolve(props.form);
  });
  return {
    nextUrl: { searchParams: new URLSearchParams(props.search ?? "") },
    headers: { get: (name: string) => headers.get(name) },
    formData,
  };
}

interface CookieValue {
  readonly name: string;
  readonly value: string;
}

/** Builds the `cookies()` double: only the listed cookies exist by name. */
function cookieStore(...entries: readonly CookieValue[]): {
  get: (name: string) => CookieValue | undefined;
  toString: () => string;
} {
  return {
    get: (name: string) => entries.find((entry) => entry.name === name),
    // Present to prove the proxy never serializes the whole jar.
    toString: () => entries.map((entry) => `${entry.name}=${entry.value}`).join("; "),
  };
}

function signedIn(): void {
  cookiesMock.mockResolvedValue(cookieStore({ name: STAFF_SESSION_COOKIE, value: "token-123" }));
}

type Dispatch = (
  request: MockNextRequest,
  segments: readonly string[] | undefined
) => Promise<Response>;

const GET_: Dispatch = (request, segments) =>
  GET(request as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ path: segments === undefined ? undefined : [...segments] }),
  });

const POST_: Dispatch = (request, segments) =>
  POST(request as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ path: segments === undefined ? undefined : [...segments] }),
  });

interface FetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  readonly cache?: string;
}

function fetchUrl(callIndex = 0): string {
  return (fetchMock.mock.calls[callIndex] as unknown as [string])[0];
}

function fetchInit(callIndex = 0): FetchInit {
  return (fetchMock.mock.calls[callIndex] as unknown as [string, FetchInit])[1];
}

/** The upstream answer every accepting case uses: JSON, as the API sends it. */
const LIST_BODY = JSON.stringify([
  {
    id: IMPORT_ID,
    entity: "CUSTOMER",
    state: "PREVIEWED",
    contentType: "text/csv",
    byteSize: 42,
    createdCount: 3,
    failedCount: 1,
    suspectedDuplicateCount: 1,
    previewedAt: "2026-10-22T10:00:00.000Z",
    committedAt: null,
    failedAt: null,
    failureReason: null,
    artefactExpiresAt: "2026-10-25T10:00:00.000Z",
    artefactDeletedAt: null,
    createdAt: "2026-10-22T09:59:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
  },
]);

function upstreamJson(body = LIST_BODY, status = 200, requestId = "req-upstream"): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
    },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  cookiesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the imports proxy · the closed allowlist", () => {
  it("refuses an unknown path locally, without an upstream call or a cookie read", async () => {
    signedIn();

    for (const segments of [
      ["customers"],
      [IMPORT_ID, "approve"],
      [IMPORT_ID, "summary", "extra"],
      ["not-a-uuid"],
      [IMPORT_ID, "expire"],
    ]) {
      const response = await GET_(mockNextRequest(), segments);

      expect(response.status, segments.join("/")).toBe(404);
      expect(await response.json(), segments.join("/")).toEqual({
        error: { code: "NOT_FOUND", message: "Import route was not found." },
      });
    }

    // No import was asked for, and no credential was touched on the way.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed id before any upstream call: a non-UUID cannot fill the id slot", async () => {
    signedIn();

    for (const segments of [["not-a-uuid"], [`${IMPORT_ID}-extra`], ["1234"], ["../rbac/roles"]]) {
      const response = await GET_(mockNextRequest(), segments);

      expect(response.status, segments.join("/")).toBe(404);
    }

    for (const segments of [
      ["not-a-uuid", "summary"],
      ["not-a-uuid", "preview"],
    ]) {
      const response = await POST_(mockNextRequest({ form: new FormData() }), segments);

      expect(response.status, segments.join("/")).toBe(404);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed segment as a structural 400 rather than normalizing it", async () => {
    signedIn();

    for (const segments of [[""], [".."], ["."], [`${IMPORT_ID}%2Fsummary`]]) {
      const response = await GET_(mockNextRequest(), segments);

      expect(response.status, JSON.stringify(segments)).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "VALIDATION_FAILED", message: "Invalid import request path." },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a known path reached with a disallowed method, with no upstream call", async () => {
    signedIn();

    // The detail read is GET-only; the two triggers are POST-only; the collection
    // is both, but never with a body on GET.
    const detailPost = await POST_(mockNextRequest({ form: new FormData() }), [IMPORT_ID]);
    expect(detailPost.status).toBe(405);
    expect(await detailPost.json()).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Import route does not support this method." },
    });

    for (const segments of [
      [IMPORT_ID, "preview"],
      [IMPORT_ID, "commit"],
    ]) {
      const response = await GET_(mockNextRequest(), segments);
      expect(response.status, segments.join("/")).toBe(405);
    }

    // `PUT` and `PATCH` are not exported by the route at all, so the framework
    // answers 405 without reaching this module: the surface is read-or-command.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown query key locally, including tenantId", async () => {
    signedIn();

    for (const search of [
      `tenantId=${IMPORT_ID}`,
      "state=PREVIEWED",
      "offset=10",
      `entity=CUSTOMER&tenantId=${IMPORT_ID}`,
    ]) {
      const response = await GET_(mockNextRequest({ search }), []);

      expect(response.status, search).toBe(400);
      expect(await response.json(), search).toEqual({
        error: {
          code: "VALIDATION_FAILED",
          message: "An import query accepts only: entity, limit.",
        },
      });
    }

    // The summary accepts a different key set, so `entity` is out of contract
    // there and `tenantId` is not a parameter anywhere.
    for (const search of ["entity=CUSTOMER", `tenantId=${IMPORT_ID}`]) {
      const response = await GET_(mockNextRequest({ search }), [IMPORT_ID, "summary"]);

      expect(response.status, search).toBe(400);
      expect(await response.json(), search).toEqual({
        error: {
          code: "VALIDATION_FAILED",
          message: "An import query accepts only: limit, offset.",
        },
      });
    }

    // The detail read takes no query at all.
    const detail = await GET_(mockNextRequest({ search: "limit=5" }), [IMPORT_ID]);
    expect(detail.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("refuses a request with no staff session, without an upstream call", async () => {
    cookiesMock.mockResolvedValue(cookieStore());

    const response = await GET_(mockNextRequest(), []);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept a portal cookie as a staff credential", async () => {
    cookiesMock.mockResolvedValue(
      cookieStore({ name: PORTAL_SESSION_COOKIE, value: "portal-token" })
    );

    const response = await GET_(mockNextRequest(), []);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the imports proxy · the upstream request", () => {
  it("forwards the multipart upload as a parsed FormData with the staff cookie and no content-type", async () => {
    signedIn();
    fetchMock.mockImplementation(() =>
      Promise.resolve(upstreamJson(JSON.stringify({ importId: IMPORT_ID, state: "UPLOADED" }), 201))
    );

    const form = new FormData();
    form.set("entity", "CUSTOMER");
    form.set("file", new Blob(["name,document_number\n"], { type: "text/csv" }), "customers.csv");

    const request = mockNextRequest({
      form,
      headers: new Headers({ "x-request-id": "req-123" }),
    });
    const response = await POST_(request, []);

    expect(response.status).toBe(201);
    expect(fetchUrl()).toBe("http://localhost:3001/imports");
    const init = fetchInit();
    expect(init.method).toBe("POST");
    expect(init.headers.cookie).toBe(`${STAFF_SESSION_COOKIE}=token-123`);
    expect(init.headers["x-request-id"]).toBe("req-123");
    expect(init.cache).toBe("no-store");
    // The body is the PARSED form: `fetch` writes the multipart boundary itself.
    // A hand-written `content-type` here would separate the boundary from the
    // body and truncate the upload at the first part.
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty("content-type");
    expect(request.formData).toHaveBeenCalledTimes(1);
  });

  it("refuses an upload whose body is not multipart with the contract's own sentence", async () => {
    signedIn();

    // `formData()` rejects for a JSON or empty body. The 400 keeps that from
    // surfacing as a 500 for a condition the contract already names.
    const response = await POST_(mockNextRequest(), []);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "An import must be uploaded as a multipart/form-data request.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no body on the two trigger commands", async () => {
    signedIn();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        upstreamJson(JSON.stringify({ importId: IMPORT_ID, state: "PREVIEWING" }), 202)
      )
    );

    const request = mockNextRequest({ form: new FormData() });
    await POST_(request, [IMPORT_ID, "preview"]);

    expect(fetchUrl()).toBe(`http://localhost:3001/imports/${IMPORT_ID}/preview`);
    expect(fetchInit().method).toBe("POST");
    // The API declares no `@Body` on a trigger: nothing is read, nothing is sent.
    expect(fetchInit().body).toBeUndefined();
    expect(request.formData).not.toHaveBeenCalled();
  });

  it("forwards only the allowlisted list query keys, in canonical order", async () => {
    signedIn();
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson()));

    await GET_(mockNextRequest({ search: "limit=20&entity=PATIENT" }), []);

    expect(fetchUrl()).toBe("http://localhost:3001/imports?entity=PATIENT&limit=20");
  });

  it("forwards the summary's limit and offset unchanged", async () => {
    signedIn();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        upstreamJson(
          JSON.stringify({
            importId: IMPORT_ID,
            state: "COMMITTED",
            totals: { createdCount: 2, failedCount: 1, suspectedDuplicateCount: 0 },
            page: { limit: 100, offset: 100 },
            rows: [],
          })
        )
      )
    );

    const response = await GET_(mockNextRequest({ search: "offset=100&limit=100" }), [
      IMPORT_ID,
      "summary",
    ]);

    expect(response.status).toBe(200);
    // Rebuilt from the allowlist, so the API's own defaults apply to whatever the
    // surface does not send — this boundary never invents a page size.
    expect(fetchUrl()).toBe(
      `http://localhost:3001/imports/${IMPORT_ID}/summary?limit=100&offset=100`
    );
  });

  it("forwards no query at all when the surface sends none", async () => {
    signedIn();
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson()));

    await GET_(mockNextRequest(), [IMPORT_ID]);

    expect(fetchUrl()).toBe(`http://localhost:3001/imports/${IMPORT_ID}`);
  });

  it("omits x-request-id when the caller sends none", async () => {
    signedIn();
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson()));

    await GET_(mockNextRequest(), []);

    expect(fetchInit().headers).not.toHaveProperty("x-request-id");
  });
});

describe("the imports proxy · the upstream response", () => {
  it("buffers the JSON body as TEXT with the upstream status and content-type", async () => {
    signedIn();
    fetchMock.mockImplementation(() => Promise.resolve(upstreamJson()));

    const response = await GET_(mockNextRequest(), []);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-request-id")).toBe("req-upstream");
    // Byte for byte: the proxy never re-serializes, so nothing is reordered and no
    // number is reformatted between the API and the surface.
    expect(await response.text()).toBe(LIST_BODY);
  });

  it("forwards a 403 upstream with its status and the API's own error envelope", async () => {
    signedIn();
    const envelope = {
      error: {
        code: "FORBIDDEN",
        message: "Insufficient permissions for this operation.",
        requestId: "req-api",
      },
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(upstreamJson(JSON.stringify(envelope), 403))
    );

    const response = await GET_(mockNextRequest(), []);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(envelope);
  });

  it("forwards the lifecycle 409 and the import's own 404 unchanged", async () => {
    signedIn();
    const conflict = {
      error: {
        code: "CONFLICT",
        message: "The import is not in a state that allows this transition.",
      },
    };
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(upstreamJson(JSON.stringify(conflict), 409))
    );

    const refused = await POST_(mockNextRequest({ form: new FormData() }), [IMPORT_ID, "commit"]);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual(conflict);

    const missing = { error: { code: "NOT_FOUND", message: "Import not found." } };
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(upstreamJson(JSON.stringify(missing), 404))
    );

    const absent = await GET_(mockNextRequest(), [IMPORT_ID]);
    expect(absent.status).toBe(404);
    // A foreign id is the byte-equivalent 404 the API answers: this boundary adds
    // no detail, because whether an import exists is the API's answer alone.
    expect(await absent.json()).toEqual(missing);
  });
});
