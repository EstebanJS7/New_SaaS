import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  ApiRequestError,
  CASH_SESSION_ALREADY_OPEN_MESSAGE,
  CASH_SESSION_NOT_FOUND_MESSAGE,
  type CashRegister,
  type CashSession,
  type OpenCashSessionInput,
} from "./cash-api";
import { SessionPanel, type CashSessionFilter } from "./session-panel";

const REGISTER: CashRegister = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Front desk",
  isActive: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const SESSION: CashSession = {
  id: "77777777-7777-4777-8777-777777777777",
  registerId: REGISTER.id,
  status: "OPEN",
  openedAt: "2026-09-27T08:00:00.000Z",
  openedByMembershipId: "66666666-6666-4666-8666-666666666666",
  openingAmount: "500000.00",
  expectedAmount: null,
  countedAmount: null,
  differenceAmount: null,
  closedAt: null,
  createdAt: "2026-09-27T08:00:00.000Z",
  updatedAt: "2026-09-27T08:00:00.000Z",
};

interface PanelOverrides {
  readonly sessions?: readonly CashSession[];
  readonly isLoading?: boolean;
  readonly loadError?: Error | null;
  readonly statusFilter?: CashSessionFilter;
  readonly onStatusFilterChange?: (value: CashSessionFilter) => void;
  readonly registers?: readonly CashRegister[];
  readonly registersLoading?: boolean;
  readonly onOpen?: (input: OpenCashSessionInput) => Promise<void>;
  readonly isOpening?: boolean;
  readonly openError?: Error | null;
  readonly opened?: CashSession | null;
  readonly selectedSessionId?: string | null;
  readonly onSelectSession?: (session: CashSession) => void;
}

function renderPanel(overrides: PanelOverrides = {}): {
  readonly onOpen: ReturnType<typeof vi.fn>;
  readonly onStatusFilterChange: ReturnType<typeof vi.fn>;
  readonly onSelectSession: ReturnType<typeof vi.fn>;
} {
  const onOpen = vi.fn((_input: OpenCashSessionInput) => Promise.resolve());
  const onStatusFilterChange = vi.fn((_value: CashSessionFilter) => undefined);
  const onSelectSession = vi.fn((_session: CashSession) => undefined);
  render(
    <SessionPanel
      sessions={overrides.sessions ?? []}
      isLoading={overrides.isLoading ?? false}
      loadError={overrides.loadError ?? null}
      statusFilter={overrides.statusFilter ?? "ALL"}
      onStatusFilterChange={overrides.onStatusFilterChange ?? onStatusFilterChange}
      registers={overrides.registers ?? [REGISTER]}
      registersLoading={overrides.registersLoading ?? false}
      onOpen={overrides.onOpen ?? onOpen}
      isOpening={overrides.isOpening ?? false}
      openError={overrides.openError ?? null}
      opened={overrides.opened ?? null}
      selectedSessionId={overrides.selectedSessionId ?? null}
      onSelectSession={overrides.onSelectSession ?? onSelectSession}
    />
  );
  return { onOpen, onStatusFilterChange, onSelectSession };
}

describe("SessionPanel states", () => {
  it("shows a loading state before the API answers", () => {
    renderPanel({ isLoading: true });

    expect(screen.getByTestId("sessions-loading")).toHaveTextContent("Cargando sesiones…");
  });

  it("shows an empty state when no session matches the filter", () => {
    renderPanel();

    expect(screen.getByTestId("sessions-empty")).toHaveTextContent(
      "No hay sesiones para este filtro."
    );
  });

  it("renders the shared 404 branch when the read is refused", () => {
    renderPanel({ loadError: new ApiRequestError("NOT_FOUND", "x", 404) });

    expect(screen.getByTestId("sessions-error")).toHaveTextContent(
      "No encontramos la caja o sesión"
    );
  });

  it("lists the API's sessions with their status and opening amount", () => {
    renderPanel({ sessions: [SESSION] });

    expect(screen.getByText(/Sesión abierta · caja #55555555/)).toBeInTheDocument();
    expect(screen.getByText(/Inicial 500\.000/)).toBeInTheDocument();
  });

  it("shows a success state only from the session the API opened", () => {
    renderPanel({ opened: SESSION });

    const status = screen.getByTestId("session-opened");
    expect(status).toHaveTextContent("Sesión abierta");
    expect(status).toHaveTextContent("importe inicial de 500.000");
  });
});

describe("SessionPanel filter and selection", () => {
  it("labels the status filter visibly and reports a change", () => {
    const { onStatusFilterChange } = renderPanel();

    const select = screen.getByLabelText("Filtrar por estado");
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Todos los estados",
      "Abierta",
      "Cerrada",
    ]);

    fireEvent.change(select, { target: { value: "OPEN" } });
    expect(onStatusFilterChange).toHaveBeenCalledWith("OPEN");
  });

  it("selects a session for the movement and close panels", () => {
    const { onSelectSession } = renderPanel({ sessions: [SESSION] });

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar sesión" }));

    expect(onSelectSession).toHaveBeenCalledWith(SESSION);
  });

  it("marks the already-selected session", () => {
    renderPanel({ sessions: [SESSION], selectedSessionId: SESSION.id });

    expect(screen.getByRole("button", { name: "Seleccionada" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("SessionPanel open form", () => {
  it("labels both fields visibly", () => {
    renderPanel();

    expect(screen.getByLabelText("Caja")).toBeInTheDocument();
    expect(screen.getByLabelText("Importe inicial")).toHaveValue("");
  });

  it("requires a register before opening", () => {
    const { onOpen } = renderPanel();

    fireEvent.change(screen.getByLabelText("Importe inicial"), { target: { value: "0,00" } });
    clickCashAction("Abrir sesión");

    expect(screen.getByTestId("session-open-validation-error")).toHaveTextContent(
      "Elegí la caja para abrir la sesión."
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("requires an exact non-negative opening amount", () => {
    const { onOpen } = renderPanel();

    fireEvent.change(screen.getByLabelText("Caja"), { target: { value: REGISTER.id } });
    fireEvent.change(screen.getByLabelText("Importe inicial"), { target: { value: "-1,00" } });
    clickCashAction("Abrir sesión");

    expect(screen.getByTestId("session-open-validation-error")).toHaveTextContent(
      "Ingresá un importe inicial no negativo con hasta dos decimales, usando coma decimal."
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("sends the register and the opening amount alone", async () => {
    const { onOpen } = renderPanel();

    fireEvent.change(screen.getByLabelText("Caja"), { target: { value: REGISTER.id } });
    fireEvent.change(screen.getByLabelText("Importe inicial"), { target: { value: "500000,00" } });
    clickCashAction("Abrir sesión");

    expect(onOpen).toHaveBeenCalledWith({
      registerId: REGISTER.id,
      openingAmount: "500000.00",
    });
    expect(await screen.findByLabelText("Importe inicial")).toHaveValue("");
  });

  it("disables the form and explains itself when no register exists yet", () => {
    renderPanel({ registers: [] });

    expect(screen.getByTestId("session-no-registers")).toHaveTextContent(
      "Creá una caja antes de abrir una sesión."
    );
    expect(screen.getByRole("button", { name: "Abrir sesión" })).toBeDisabled();
    expect(screen.getByLabelText("Caja")).toBeDisabled();
  });

  it("surfaces the already-open 409 as a real state of the tenant", () => {
    renderPanel({
      openError: new ApiRequestError("CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE, 409),
    });

    expect(screen.getByTestId("session-open-error")).toHaveTextContent(
      "Esta caja ya tiene una sesión abierta"
    );
  });

  it("surfaces the shared 404 for a foreign or unknown register", () => {
    renderPanel({
      openError: new ApiRequestError("NOT_FOUND", CASH_SESSION_NOT_FOUND_MESSAGE, 404),
    });

    expect(screen.getByTestId("session-open-error")).toHaveTextContent(
      "No encontramos la caja o sesión"
    );
  });

  it("surfaces the stable 400 validation refusal", () => {
    renderPanel({
      openError: new ApiRequestError("VALIDATION_FAILED", "Invalid cash session open body.", 400),
    });
    expect(screen.getByTestId("session-open-error")).toHaveTextContent(
      "Revisá los datos de la operación"
    );
  });

  it("surfaces the permission refusal for the open command", () => {
    renderPanel({ openError: new ApiRequestError("FORBIDDEN", "Access denied.", 403) });

    expect(screen.getByTestId("session-open-error")).toHaveTextContent("Sin permiso");
  });

  it("relabels the button and blocks the fields while the open is in flight", () => {
    renderPanel({ isOpening: true });

    expect(screen.getByRole("button", { name: "Abriendo sesión…" })).toBeDisabled();
    expect(screen.getByLabelText("Importe inicial")).toBeDisabled();
  });
});

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
function clickCashAction(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
  const dialog = screen.queryByRole("dialog");
  const confirm: Record<string, string> = {
    "Abrir sesión": "Confirmar apertura",
    "Registrar movimiento": "Confirmar movimiento",
    "Cerrar sesión": "Confirmar cierre",
  };
  if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: confirm[name] }));
}
