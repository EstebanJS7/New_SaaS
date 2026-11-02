import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  ApiRequestError,
  CASH_SESSION_NOT_OPEN_MESSAGE,
  type CashSession,
  type CloseCashSessionInput,
} from "./cash-api";
import { ClosePanel } from "./close-panel";

const OPEN_SESSION: CashSession = {
  id: "77777777-7777-4777-8777-777777777777",
  registerId: "55555555-5555-4555-8555-555555555555",
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

const CLOSED_SESSION: CashSession = {
  ...OPEN_SESSION,
  status: "CLOSED",
  expectedAmount: "500000.00",
  countedAmount: "498500.00",
  differenceAmount: "-1500.00",
  closedAt: "2026-09-27T18:30:00.000Z",
};

interface PanelOverrides {
  readonly session?: CashSession | null;
  readonly onClose?: (input: CloseCashSessionInput) => Promise<void>;
  readonly isClosing?: boolean;
  readonly closeError?: Error | null;
}

function renderPanel(overrides: PanelOverrides = {}): {
  readonly onClose: ReturnType<typeof vi.fn>;
} {
  const onClose = vi.fn((_input: CloseCashSessionInput) => Promise.resolve());
  render(
    <ClosePanel
      session={overrides.session === undefined ? OPEN_SESSION : overrides.session}
      onClose={overrides.onClose ?? onClose}
      isClosing={overrides.isClosing ?? false}
      closeError={overrides.closeError ?? null}
    />
  );
  return { onClose };
}

describe("ClosePanel states", () => {
  it("asks for a session before offering the close form", () => {
    renderPanel({ session: null });

    expect(screen.getByTestId("close-no-session")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe contado")).not.toBeInTheDocument();
  });

  it("labels the counted amount visibly", () => {
    renderPanel();

    expect(screen.getByLabelText("Importe contado")).toHaveValue("");
  });

  it("shows a closed session's stored close result instead of the form", () => {
    renderPanel({ session: CLOSED_SESSION });

    expect(screen.getByTestId("close-outcome")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe contado")).not.toBeInTheDocument();
  });
});

describe("ClosePanel form", () => {
  it("requires an exact non-negative counted amount", () => {
    const { onClose } = renderPanel();

    clickCashAction("Cerrar sesión");
    expect(screen.getByTestId("close-validation-error")).toHaveTextContent(
      "Ingresá el importe contado."
    );

    fireEvent.change(screen.getByLabelText("Importe contado"), { target: { value: "-1,00" } });
    clickCashAction("Cerrar sesión");
    expect(screen.getByTestId("close-validation-error")).toHaveTextContent(
      "Ingresá un importe contado no negativo con hasta dos decimales, usando coma decimal."
    );

    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends the counted amount alone and clears it after a confirmed close", async () => {
    const { onClose } = renderPanel();

    fireEvent.change(screen.getByLabelText("Importe contado"), { target: { value: "498500,00" } });
    clickCashAction("Cerrar sesión");

    expect(onClose).toHaveBeenCalledWith({ countedAmount: "498500.00" });
    expect(await screen.findByLabelText("Importe contado")).toHaveValue("");
  });

  it("relabels the button and blocks the field while the close is in flight", () => {
    renderPanel({ isClosing: true });

    expect(screen.getByRole("button", { name: "Cerrando sesión…" })).toBeDisabled();
    expect(screen.getByLabelText("Importe contado")).toBeDisabled();
  });
});

describe("ClosePanel outcome", () => {
  it("shows the three amounts the close returned", () => {
    renderPanel({ session: CLOSED_SESSION });

    expect(screen.getByTestId("close-expected")).toHaveTextContent("500.000");
    expect(screen.getByTestId("close-counted")).toHaveTextContent("498.500");
  });

  it("renders a short drawer with an explicit minus sign and never as an error", () => {
    renderPanel({ session: CLOSED_SESSION });

    const difference = screen.getByTestId("close-difference");
    expect(difference).toHaveTextContent("-1.500");
    expect(difference.className).not.toMatch(/destructive/);
    expect(screen.getByTestId("close-outcome")).toHaveAttribute("data-outcome", "SHORT");
    expect(screen.getByTestId("close-difference-note")).toHaveTextContent("Faltante de 1.500");
  });

  it("renders an over drawer with an explicit plus sign", () => {
    renderPanel({
      session: {
        ...CLOSED_SESSION,
        countedAmount: "501500.00",
        differenceAmount: "1500.00",
      },
    });

    const difference = screen.getByTestId("close-difference");
    expect(difference).toHaveTextContent("+1.500");
    expect(difference.className).not.toMatch(/destructive/);
    expect(screen.getByTestId("close-outcome")).toHaveAttribute("data-outcome", "OVER");
    expect(screen.getByTestId("close-difference-note")).toHaveTextContent("Sobrante de 1.500");
  });

  it("renders a balanced count without a sign", () => {
    renderPanel({
      session: { ...CLOSED_SESSION, countedAmount: "500000.00", differenceAmount: "0.00" },
    });

    expect(screen.getByTestId("close-difference")).toHaveTextContent(/^0$/);
    expect(screen.getByTestId("close-outcome")).toHaveAttribute("data-outcome", "BALANCED");
    expect(screen.getByTestId("close-difference-note")).toHaveTextContent("Sin diferencia");
  });

  it("states plainly when the API did not report an amount", () => {
    renderPanel({
      session: {
        ...CLOSED_SESSION,
        expectedAmount: null,
        countedAmount: null,
        differenceAmount: null,
      },
    });

    expect(screen.getByTestId("close-expected")).toHaveTextContent("No informado");
    expect(screen.getByTestId("close-counted")).toHaveTextContent("No informado");
    expect(screen.getByTestId("close-difference")).toHaveTextContent("No informado");
    expect(screen.queryByTestId("close-difference-note")).not.toBeInTheDocument();
  });

  it("offers no reopen control on a closed session", () => {
    renderPanel({ session: CLOSED_SESSION });

    expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
  });
});

describe("ClosePanel refusals", () => {
  it("surfaces the not-open 409 as a terminal condition", () => {
    renderPanel({
      closeError: new ApiRequestError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE, 409),
    });

    expect(screen.getByTestId("close-error")).toHaveTextContent("Esta sesión no está abierta");
  });

  it("surfaces the shared 404", () => {
    renderPanel({ closeError: new ApiRequestError("NOT_FOUND", "x", 404) });

    expect(screen.getByTestId("close-error")).toHaveTextContent("No encontramos la caja o sesión");
  });

  it("surfaces the stable 400 validation refusal", () => {
    renderPanel({
      closeError: new ApiRequestError("VALIDATION_FAILED", "Invalid cash session close body.", 400),
    });

    expect(screen.getByTestId("close-error")).toHaveTextContent("Revisá los datos de la operación");
  });

  it("surfaces the permission refusal", () => {
    renderPanel({ closeError: new ApiRequestError("FORBIDDEN", "Access denied.", 403) });

    expect(screen.getByTestId("close-error")).toHaveTextContent("Sin permiso");
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
