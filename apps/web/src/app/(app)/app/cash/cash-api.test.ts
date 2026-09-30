/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  CASH_FEATURE_NOT_ENTITLED_MESSAGE,
  CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE,
  CASH_REGISTER_NAME_CONFLICT_MESSAGE,
  CASH_SESSION_ALREADY_OPEN_MESSAGE,
  CASH_SESSION_NOT_OPEN_MESSAGE,
  closeSession,
  createCashRegister,
  createMovement,
  isCashConflict,
  isCashIdempotencyKeyConflict,
  isCashNotFound,
  isCashNotEntitled,
  isCashPermissionDenied,
  isCashRegisterNameConflict,
  isCashSessionAlreadyOpen,
  isCashSessionNotOpen,
  isCashTransportError,
  listCashRegisters,
  listCashSessions,
  listMovements,
  openCashSession,
  userFacingCashError,
  type CashMovement,
  type CashRegister,
  type CashSession,
} from "./cash-api";

const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";

const REGISTER: CashRegister = {
  id: REGISTER_ID,
  name: "Front desk",
  isActive: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const SESSION: CashSession = {
  id: "77777777-7777-4777-8777-777777777777",
  registerId: REGISTER_ID,
  status: "OPEN",
  openedAt: "2026-09-27T08:00:00.000Z",
  openedByMembershipId: MEMBERSHIP_ID,
  openingAmount: "500000.00",
  createdAt: "2026-09-27T08:00:00.000Z",
  updatedAt: "2026-09-27T08:00:00.000Z",
};

const MOVEMENT: CashMovement = {
  id: "88888888-8888-4888-8888-888888888888",
  registerId: REGISTER_ID,
  sessionId: SESSION.id,
  type: "ADJUSTMENT",
  direction: "INCREASE",
  amount: "1500.00",
  reason: "Drawer recount",
  createdAt: "2026-09-27T09:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("cash-api transport contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listCashRegisters GETs /api/cash/registers without a query", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([REGISTER])));
    global.fetch = fetchMock;

    await expect(listCashRegisters()).resolves.toEqual([REGISTER]);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/cash/registers");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
    // No tenant, opener or permission header is invented by the client either.
    expect(init.headers).toBeUndefined();
  });

  it("createCashRegister POSTs the name alone", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(REGISTER, 201)));
    global.fetch = fetchMock;

    await expect(createCashRegister({ name: "Front desk" })).resolves.toEqual(REGISTER);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/cash/registers");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    // No tenant, branch, currency or server-set active flag crosses the wire.
    expect(JSON.parse(init.body as string)).toEqual({ name: "Front desk" });
  });

  it("listCashSessions GETs /api/cash/sessions with no filter when none is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([SESSION])));
    global.fetch = fetchMock;

    await expect(listCashSessions()).resolves.toEqual([SESSION]);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/cash/sessions");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("listCashSessions serializes the status filter", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listCashSessions({ status: "OPEN" });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/cash/sessions?status=OPEN");
  });

  it("openCashSession POSTs the register and the exact opening amount", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SESSION, 201)));
    global.fetch = fetchMock;

    const body = { registerId: REGISTER_ID, openingAmount: "500000.00" };
    await expect(openCashSession(body)).resolves.toEqual(SESSION);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/cash/sessions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    // The opener is server-resolved: the body never carries it.
    expect(JSON.parse(init.body as string)).not.toHaveProperty("openedByMembershipId");
  });

  it("listMovements GETs /api/cash/movements with no query when none is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([MOVEMENT])));
    global.fetch = fetchMock;

    await expect(listMovements()).resolves.toEqual([MOVEMENT]);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/cash/movements");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
    // The read never carries the command's idempotency key.
    expect(init.headers).toBeUndefined();
  });

  it("listMovements serializes the sessionId filter", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listMovements({ sessionId: SESSION.id });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe(`/api/cash/movements?sessionId=${SESSION.id}`);
  });

  it("createMovement POSTs exactly the command keys and forwards the caller's Idempotency-Key verbatim", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(MOVEMENT, 201)));
    global.fetch = fetchMock;

    await expect(
      createMovement(
        {
          sessionId: SESSION.id,
          type: "ADJUSTMENT",
          amount: "1500.00",
          reason: "Drawer recount",
          direction: "INCREASE",
        },
        "key-abc"
      )
    ).resolves.toEqual(MOVEMENT);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/cash/movements");
    expect(init.method).toBe("POST");
    expect(Object.keys(JSON.parse(init.body as string) as Record<string, unknown>).sort()).toEqual([
      "amount",
      "direction",
      "reason",
      "sessionId",
      "type",
    ]);
    // The caller owns the key: the module forwards it verbatim and never mints one.
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-abc");
  });

  it("createMovement sends no registerId, tenant or status and omits the absent optional keys", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(MOVEMENT, 201)));
    global.fetch = fetchMock;

    await createMovement({ sessionId: SESSION.id, type: "INCOME", amount: "100.00" }, "key-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["amount", "sessionId", "type"]);
    // Derived server-side, never caller-supplied.
    expect(parsed).not.toHaveProperty("registerId");
    expect(parsed).not.toHaveProperty("tenantId");
    expect(parsed).not.toHaveProperty("status");
  });

  it("closeSession POSTs the counted amount alone to the session's close path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ...SESSION, status: "CLOSED" })));
    global.fetch = fetchMock;

    await closeSession(SESSION.id, { countedAmount: "500000.00" });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/cash/sessions/${SESSION.id}/close`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ countedAmount: "500000.00" });
    // The close command takes no idempotency key: a second close is the stable 409.
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });

  it("surfaces the stable register-name conflict and classifies it", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "CONFLICT", message: CASH_REGISTER_NAME_CONFLICT_MESSAGE } },
          409
        )
      )
    );
    global.fetch = fetchMock;

    const error = await createCashRegister({ name: "Front desk" }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(409);
    expect(isCashConflict(error as Error)).toBe(true);
    expect(isCashRegisterNameConflict(error as Error)).toBe(true);
    // The conflict copy never echoes the name back.
    expect((error as ApiRequestError).message).not.toContain("Front desk");
    expect(userFacingCashError(error as Error)).toBe(CASH_REGISTER_NAME_CONFLICT_MESSAGE);
  });

  it("distinguishes an already-open register from a duplicate name", () => {
    const alreadyOpen = new ApiRequestError("CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE, 409);
    const duplicateName = new ApiRequestError("CONFLICT", CASH_REGISTER_NAME_CONFLICT_MESSAGE, 409);

    expect(isCashSessionAlreadyOpen(alreadyOpen)).toBe(true);
    expect(isCashRegisterNameConflict(alreadyOpen)).toBe(false);

    expect(isCashRegisterNameConflict(duplicateName)).toBe(true);
    expect(isCashSessionAlreadyOpen(duplicateName)).toBe(false);

    // An unrecognized conflict is still a conflict, just unclassified.
    const unknown = new ApiRequestError("CONFLICT", "Something else.", 409);
    expect(isCashConflict(unknown)).toBe(true);
    expect(isCashRegisterNameConflict(unknown)).toBe(false);
    expect(isCashSessionAlreadyOpen(unknown)).toBe(false);
  });

  it("classifies the not-open session and the reused idempotency key apart", () => {
    const notOpen = new ApiRequestError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE, 409);
    const reusedKey = new ApiRequestError("CONFLICT", CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE, 409);

    expect(isCashSessionNotOpen(notOpen)).toBe(true);
    expect(isCashIdempotencyKeyConflict(notOpen)).toBe(false);

    expect(isCashIdempotencyKeyConflict(reusedKey)).toBe(true);
    expect(isCashSessionNotOpen(reusedKey)).toBe(false);

    // Both are the shared stable CONFLICT, so the surface can still render a conflict.
    expect(isCashConflict(notOpen)).toBe(true);
    expect(isCashConflict(reusedKey)).toBe(true);
    expect(isCashSessionAlreadyOpen(notOpen)).toBe(false);
  });

  it("keeps the entitlement refusal apart from the permission refusal", () => {
    const notEntitled = new ApiRequestError(
      "FEATURE_NOT_ENTITLED",
      CASH_FEATURE_NOT_ENTITLED_MESSAGE,
      403
    );
    const forbidden = new ApiRequestError("FORBIDDEN", "Access denied.", 403);

    expect(isCashNotEntitled(notEntitled)).toBe(true);
    expect(isCashPermissionDenied(notEntitled)).toBe(false);

    expect(isCashPermissionDenied(forbidden)).toBe(true);
    expect(isCashNotEntitled(forbidden)).toBe(false);
  });

  it("maps not-found, entitlement, permission and transport failures to distinct copy", () => {
    expect(userFacingCashError(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      "You do not have permission to manage cash registers."
    );
    expect(
      userFacingCashError(
        new ApiRequestError("FEATURE_NOT_ENTITLED", CASH_FEATURE_NOT_ENTITLED_MESSAGE, 403)
      )
    ).toBe("Cash features are not enabled for this tenant.");
    expect(
      userFacingCashError(new ApiRequestError("NOT_FOUND", "Resource was not found.", 404))
    ).toBe("Cash register or session not found.");
    expect(
      userFacingCashError(new ApiRequestError("UNAUTHENTICATED", "Authentication required.", 401))
    ).toBe("You must be signed in to use the cash register.");
    expect(userFacingCashError(new TypeError("Failed to fetch"))).toBe(
      "The request could not reach the server. Check your connection and try again."
    );
    // An unmapped code keeps the server message instead of inventing a cause.
    expect(userFacingCashError(new ApiRequestError("VALIDATION_FAILED", "Bad body.", 400))).toBe(
      "Bad body."
    );
  });

  it("identifies a 404 and a transport failure", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Cash register was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await openCashSession({
      registerId: REGISTER_ID,
      openingAmount: "0.00",
    }).catch((caught: unknown) => caught);

    expect(isCashNotFound(error as Error)).toBe(true);
    expect(isCashTransportError(error as Error)).toBe(false);
    expect(isCashTransportError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("falls back to UNKNOWN when the failure carries no envelope", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    global.fetch = fetchMock;

    const error = await listCashRegisters().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe("UNKNOWN");
    expect((error as ApiRequestError).status).toBe(500);
    expect(userFacingCashError(error as Error)).toBe("Request failed (500)");
  });

  it("never writes a cash payload to the console", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(REGISTER, 201))
      .mockResolvedValueOnce(jsonResponse(SESSION, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "CONFLICT", message: CASH_SESSION_ALREADY_OPEN_MESSAGE } },
          409
        )
      )
      .mockResolvedValueOnce(jsonResponse(MOVEMENT, 201))
      .mockResolvedValueOnce(jsonResponse({ ...SESSION, status: "CLOSED" }));
    global.fetch = fetchMock;

    await createCashRegister({ name: REGISTER.name });
    await openCashSession({ registerId: REGISTER_ID, openingAmount: SESSION.openingAmount });
    await openCashSession({ registerId: REGISTER_ID, openingAmount: "0.00" }).catch(
      () => undefined
    );
    await createMovement(
      {
        sessionId: SESSION.id,
        type: "ADJUSTMENT",
        amount: "1500.00",
        reason: "Drawer recount",
        direction: "INCREASE",
      },
      "key-console"
    );
    await closeSession(SESSION.id, { countedAmount: "0.00" });

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
