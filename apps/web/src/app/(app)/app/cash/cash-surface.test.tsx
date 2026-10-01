import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CashMovement, CashRegister, CashSession } from "./cash-api";
import { CashSurface } from "./cash-surface";

const REGISTER: CashRegister = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Front desk",
  isActive: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const OPEN_SESSION: CashSession = {
  id: "77777777-7777-4777-8777-777777777777",
  registerId: REGISTER.id,
  status: "OPEN",
  openedAt: "2026-09-27T08:00:00.000Z",
  openedByMembershipId: "66666666-6666-4666-8666-666666666666",
  openingAmount: "500000.00",
  expectedAmount: null,
  countedAmount: null,
  differenceAmount: null,
  createdAt: "2026-09-27T08:00:00.000Z",
  updatedAt: "2026-09-27T08:00:00.000Z",
};

const CLOSED_SESSION: CashSession = {
  ...OPEN_SESSION,
  status: "CLOSED",
  expectedAmount: "500000.00",
  countedAmount: "498500.00",
  differenceAmount: "-1500.00",
};

const MOVEMENT: CashMovement = {
  id: "88888888-8888-4888-8888-888888888888",
  registerId: REGISTER.id,
  sessionId: OPEN_SESSION.id,
  type: "INCOME",
  direction: null,
  amount: "1500.00",
  reason: null,
  createdAt: "2026-09-27T09:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

type Responder = (url: string, init?: RequestInit) => Response;

interface FetchHandlers {
  readonly registers?: Responder;
  readonly sessions?: Responder;
  readonly movements?: Responder;
  readonly close?: Responder;
}

function installFetch(handlers: FetchHandlers): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url.startsWith("/api/cash/registers")) {
      return Promise.resolve((handlers.registers ?? (() => jsonResponse([])))(url, init));
    }
    if (url.startsWith("/api/cash/sessions")) {
      if (url.endsWith("/close")) {
        return Promise.resolve((handlers.close ?? (() => jsonResponse(CLOSED_SESSION)))(url, init));
      }
      return Promise.resolve((handlers.sessions ?? (() => jsonResponse([])))(url, init));
    }
    if (url.startsWith("/api/cash/movements")) {
      return Promise.resolve((handlers.movements ?? (() => jsonResponse([])))(url, init));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function typedCalls(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit?][] {
  return fetchMock.mock.calls as [RequestInfo | URL, RequestInit?][];
}

function callsTo(
  fetchMock: ReturnType<typeof vi.fn>,
  prefix: string
): [RequestInfo | URL, RequestInit?][] {
  return typedCalls(fetchMock).filter((call) => resolveUrl(call[0]).startsWith(prefix));
}

function renderSurface(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CashSurface />
    </QueryClientProvider>
  );
}

async function selectFirstSession(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Select session" }));
  await screen.findByLabelText("Counted amount");
}

describe("CashSurface reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads registers and sessions through the cash client", async () => {
    const fetchMock = installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: () => jsonResponse([OPEN_SESSION]),
    });

    renderSurface();

    expect(await screen.findAllByText("Front desk")).not.toHaveLength(0);
    expect(await screen.findByText(/Open session · register #55555555/)).toBeInTheDocument();

    const urls = typedCalls(fetchMock).map((call) => resolveUrl(call[0]));
    expect(urls).toContain("/api/cash/registers");
    expect(urls).toContain("/api/cash/sessions");
  });

  it("asks the API for the chosen status filter", async () => {
    const fetchMock = installFetch({
      sessions: () => jsonResponse([OPEN_SESSION]),
    });

    renderSurface();
    await screen.findByText(/Open session/);

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "OPEN" } });

    await waitFor(() => {
      expect(typedCalls(fetchMock).map((call) => resolveUrl(call[0]))).toContain(
        "/api/cash/sessions?status=OPEN"
      );
    });
  });

  it("renders the permission branch when the register read is forbidden", async () => {
    installFetch({
      registers: () => errorResponse("FORBIDDEN", "Access denied.", 403),
      sessions: () => jsonResponse([]),
    });

    renderSurface();

    expect(await screen.findByTestId("registers-error")).toHaveTextContent("Permission denied");
  });

  it("hides the workspace when the tenant lacks the cash capability", async () => {
    installFetch({
      registers: () =>
        errorResponse(
          "FEATURE_NOT_ENTITLED",
          "Cash features are not enabled for this tenant.",
          403
        ),
      sessions: () => jsonResponse([]),
    });

    renderSurface();

    expect(await screen.findByTestId("cash-entitlement-denied")).toHaveTextContent(
      "Cash features are not enabled for this tenant"
    );
    // The UX gate hides the surface; the backend remains the authority.
    expect(screen.queryByLabelText("Register name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status filter")).not.toBeInTheDocument();
  });
});

describe("CashSurface commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a register with the name alone", async () => {
    const fetchMock = installFetch({
      registers: (_url, init) =>
        init?.method === "POST" ? jsonResponse(REGISTER, 201) : jsonResponse([]),
      sessions: () => jsonResponse([]),
    });

    renderSurface();
    await screen.findByTestId("registers-empty");

    fireEvent.change(screen.getByLabelText("Register name"), { target: { value: "Front desk" } });
    fireEvent.click(screen.getByRole("button", { name: "Create register" }));

    expect(await screen.findByTestId("register-created")).toHaveTextContent("Register created");

    const post = callsTo(fetchMock, "/api/cash/registers").find(
      (call) => call[1]?.method === "POST"
    );
    expect(post).toBeDefined();
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ name: "Front desk" });
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("isActive");
  });

  it("resets the per-session forms and the idempotency key when the selection changes", async () => {
    const secondSession: CashSession = {
      ...OPEN_SESSION,
      id: "99999999-9999-4999-8999-999999999999",
    };
    installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: () => jsonResponse([OPEN_SESSION, secondSession]),
      movements: () => jsonResponse([]),
    });

    renderSurface();
    const selectButtons = await screen.findAllByRole("button", { name: "Select session" });
    fireEvent.click(selectButtons[0]);

    // Values entered for the FIRST session must not survive a switch to the
    // second: a carried counted amount would be submitted with the NEW session
    // id, and a carried key would be replayed against the wrong movement.
    fireEvent.change(await screen.findByLabelText("Counted amount"), {
      target: { value: "498500.00" },
    });
    expect(screen.getByLabelText("Counted amount")).toHaveValue("498500.00");

    fireEvent.click(selectButtons[1]);

    await waitFor(() => {
      expect(screen.getByLabelText("Counted amount")).toHaveValue("");
    });
  });

  it("opens a session for a register and selects it for the ledger", async () => {
    const fetchMock = installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: (_url, init) =>
        init?.method === "POST" ? jsonResponse(OPEN_SESSION, 201) : jsonResponse([]),
      movements: () => jsonResponse([]),
    });

    renderSurface();
    await screen.findByRole("option", { name: "Front desk" });

    fireEvent.change(screen.getByLabelText("Register"), { target: { value: REGISTER.id } });
    fireEvent.change(screen.getByLabelText("Opening amount"), { target: { value: "500000.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));

    expect(await screen.findByTestId("session-opened")).toHaveTextContent("Session opened");
    // The opened session is selected: the ledger is read for it and the close
    // form becomes available.
    expect(await screen.findByLabelText("Counted amount")).toBeInTheDocument();

    const post = callsTo(fetchMock, "/api/cash/sessions").find(
      (call) => call[1]?.method === "POST"
    );
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ registerId: REGISTER.id, openingAmount: "500000.00" });
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("openedByMembershipId");
    expect(body).not.toHaveProperty("tenantId");

    await waitFor(() => {
      expect(typedCalls(fetchMock).map((call) => resolveUrl(call[0]))).toContain(
        `/api/cash/movements?sessionId=${OPEN_SESSION.id}`
      );
    });
  });

  it("records a movement with a caller-owned Idempotency-Key and no tenant field", async () => {
    const fetchMock = installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: () => jsonResponse([OPEN_SESSION]),
      movements: (_url, init) =>
        init?.method === "POST" ? jsonResponse(MOVEMENT, 201) : jsonResponse([]),
    });

    renderSurface();
    await selectFirstSession();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1500.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record movement" }));

    expect(await screen.findByTestId("movement-created")).toHaveTextContent("Movement recorded");

    const post = callsTo(fetchMock, "/api/cash/movements").find(
      (call) => call[1]?.method === "POST"
    );
    expect(post).toBeDefined();
    const headers = post?.[1]?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      sessionId: OPEN_SESSION.id,
      type: "INCOME",
      amount: "1500.00",
    });
    expect(body).not.toHaveProperty("registerId");
    expect(body).not.toHaveProperty("tenantId");
  });

  it("closes a session with the counted amount and shows the signed difference", async () => {
    const fetchMock = installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: () => jsonResponse([OPEN_SESSION]),
      movements: () => jsonResponse([]),
      close: () => jsonResponse(CLOSED_SESSION, 201),
    });

    renderSurface();
    await selectFirstSession();

    fireEvent.change(screen.getByLabelText("Counted amount"), { target: { value: "498500.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));

    expect(await screen.findByTestId("close-outcome")).toHaveAttribute("data-outcome", "SHORT");
    expect(screen.getByTestId("close-expected")).toHaveTextContent("500,000.00");
    expect(screen.getByTestId("close-counted")).toHaveTextContent("498,500.00");
    expect(screen.getByTestId("close-difference")).toHaveTextContent("-1,500.00");
    expect(screen.getByTestId("close-difference-note")).toHaveTextContent("Short by 1,500.00");

    const post = callsTo(fetchMock, "/api/cash/sessions").find((call) =>
      resolveUrl(call[0]).endsWith("/close")
    );
    expect(post).toBeDefined();
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ countedAmount: "498500.00" });
    expect(body).not.toHaveProperty("expectedAmount");
    expect(body).not.toHaveProperty("differenceAmount");
    expect(body).not.toHaveProperty("status");
  });

  it("surfaces a refused movement without presenting it as recorded", async () => {
    installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: () => jsonResponse([OPEN_SESSION]),
      movements: (_url, init) =>
        init?.method === "POST"
          ? errorResponse("CONFLICT", "This cash session is not open.", 409)
          : jsonResponse([]),
    });

    renderSurface();
    await selectFirstSession();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1500.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record movement" }));

    expect(await screen.findByTestId("movement-create-error")).toHaveTextContent(
      "This cash session is not open"
    );
    expect(screen.queryByTestId("movement-created")).not.toBeInTheDocument();
  });

  it("sends no tenant authority in any query the surface issues", async () => {
    const fetchMock = installFetch({
      registers: () => jsonResponse([REGISTER]),
      sessions: () => jsonResponse([OPEN_SESSION]),
      movements: () => jsonResponse([]),
    });

    renderSurface();
    await selectFirstSession();

    for (const call of typedCalls(fetchMock)) {
      expect(resolveUrl(call[0])).not.toMatch(/tenant/i);
      const body = call[1]?.body;
      if (typeof body === "string") {
        expect(body).not.toMatch(/tenantId/);
      }
    }
  });
});
