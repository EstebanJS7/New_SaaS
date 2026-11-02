import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ApiRequestError,
  CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE,
  CASH_SESSION_NOT_OPEN_MESSAGE,
  type CashMovement,
  type CashSession,
  type CreateCashMovementInput,
} from "./cash-api";
import { MovementPanel } from "./movement-panel";

const SESSION: CashSession = {
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

const MOVEMENT: CashMovement = {
  id: "88888888-8888-4888-8888-888888888888",
  registerId: SESSION.registerId,
  sessionId: SESSION.id,
  type: "EXPENSE",
  direction: null,
  amount: "1500.00",
  reason: "Cleaning supplies",
  createdAt: "2026-09-27T09:00:00.000Z",
};

type CreateCall = (input: CreateCashMovementInput, idempotencyKey: string) => Promise<void>;

interface PanelOverrides {
  readonly session?: CashSession | null;
  readonly movements?: readonly CashMovement[];
  readonly isLoading?: boolean;
  readonly loadError?: Error | null;
  readonly onCreate?: CreateCall;
  readonly isCreating?: boolean;
  readonly createError?: Error | null;
  readonly created?: CashMovement | null;
}

function renderPanel(overrides: PanelOverrides = {}): {
  readonly onCreate: ReturnType<typeof vi.fn<CreateCall>>;
} {
  const onCreate = vi.fn<CreateCall>(() => Promise.resolve());
  render(
    <MovementPanel
      session={overrides.session === undefined ? SESSION : overrides.session}
      movements={overrides.movements ?? []}
      isLoading={overrides.isLoading ?? false}
      loadError={overrides.loadError ?? null}
      onCreate={overrides.onCreate ?? onCreate}
      isCreating={overrides.isCreating ?? false}
      createError={overrides.createError ?? null}
      created={overrides.created ?? null}
    />
  );
  return { onCreate };
}

function setType(type: string): void {
  fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: type } });
}

function fillMovement(type: string, amount: string, reason: string, direction?: string): void {
  setType(type);
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: amount } });
  if (reason.length > 0) {
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: reason } });
  }
  if (direction !== undefined) {
    fireEvent.change(screen.getByLabelText("Sentido del ajuste"), {
      target: { value: direction },
    });
  }
}

describe("MovementPanel states", () => {
  it("asks for a session before showing the ledger or the form", () => {
    renderPanel({ session: null });

    expect(screen.getByTestId("movements-no-session")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
  });

  it("shows a loading state before the API answers", () => {
    renderPanel({ isLoading: true });

    expect(screen.getByTestId("movements-loading")).toHaveTextContent("Cargando movimientos…");
  });

  it("shows an empty ledger state for a session without movements", () => {
    renderPanel();

    expect(screen.getByTestId("movements-empty")).toHaveTextContent(
      "Todavía no hay movimientos en esta sesión."
    );
  });

  it("renders the shared 404 branch when the ledger read is refused", () => {
    renderPanel({ loadError: new ApiRequestError("NOT_FOUND", "x", 404) });

    expect(screen.getByTestId("movements-error")).toHaveTextContent(
      "No encontramos la caja o sesión"
    );
  });

  it("lists the immutable movements with their type, direction and amount", () => {
    renderPanel({
      movements: [
        MOVEMENT,
        {
          ...MOVEMENT,
          id: "other",
          type: "ADJUSTMENT",
          direction: "DECREASE",
          amount: "250.00",
          reason: "Till recount",
        },
      ],
    });

    expect(screen.getByText(/Cleaning supplies/)).toBeInTheDocument();
    expect(screen.getByText("Ajuste · Disminuir efectivo esperado")).toBeInTheDocument();
    expect(screen.getByText("1.500")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
  });

  it("shows a success state only from the movement the API returned", () => {
    renderPanel({ created: MOVEMENT });

    const status = screen.getByTestId("movement-created");
    expect(status).toHaveTextContent("Movimiento registrado");
    expect(status).toHaveTextContent("Se registró un movimiento de gasto por 1.500.");
  });

  it("offers no form for a session that is already closed", () => {
    renderPanel({ session: { ...SESSION, status: "CLOSED" } });

    expect(screen.getByTestId("movements-session-closed")).toHaveTextContent(
      "Esta sesión está cerrada"
    );
    expect(screen.queryByLabelText("Importe")).not.toBeInTheDocument();
  });
});

describe("MovementPanel form shape", () => {
  it("labels every field visibly", () => {
    renderPanel();

    expect(screen.getByLabelText("Tipo de movimiento")).toBeInTheDocument();
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
    expect(screen.getByLabelText("Motivo")).toBeInTheDocument();
  });

  it("offers every non-sale movement kind and never SALE", () => {
    renderPanel();

    const options = [...screen.getByLabelText("Tipo de movimiento").querySelectorAll("option")].map(
      (option) => option.getAttribute("value")
    );
    expect(options).toEqual(["REFUND", "INCOME", "EXPENSE", "WITHDRAWAL", "DEPOSIT", "ADJUSTMENT"]);
    expect(options).not.toContain("SALE");
  });

  it("offers the direction control exactly for ADJUSTMENT", () => {
    renderPanel();

    expect(screen.queryByLabelText("Sentido del ajuste")).not.toBeInTheDocument();

    setType("ADJUSTMENT");
    expect(screen.getByLabelText("Sentido del ajuste")).toBeInTheDocument();

    setType("DEPOSIT");
    expect(screen.queryByLabelText("Sentido del ajuste")).not.toBeInTheDocument();
  });
});

describe("MovementPanel validation", () => {
  it("requires a positive exact amount", () => {
    const { onCreate } = renderPanel();

    clickCashAction("Registrar movimiento");
    expect(screen.getByTestId("movement-validation-error")).toHaveTextContent(
      "Ingresá el importe."
    );

    fillMovement("INCOME", "0,00", "");
    clickCashAction("Registrar movimiento");
    expect(screen.getByTestId("movement-validation-error")).toHaveTextContent(
      "El importe del movimiento debe ser mayor que cero."
    );

    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "-1,00" } });
    clickCashAction("Registrar movimiento");
    expect(screen.getByTestId("movement-validation-error")).toHaveTextContent(
      "Ingresá un importe positivo con hasta dos decimales, usando coma decimal."
    );

    expect(onCreate).not.toHaveBeenCalled();
  });

  it("requires a reason for every kind but INCOME", () => {
    const { onCreate } = renderPanel();

    fillMovement("EXPENSE", "10,00", "");
    clickCashAction("Registrar movimiento");
    expect(screen.getByTestId("movement-validation-error")).toHaveTextContent(
      "Ingresá un motivo para este tipo de movimiento."
    );

    fillMovement("WITHDRAWAL", "10,00", "");
    clickCashAction("Registrar movimiento");
    expect(screen.getByTestId("movement-validation-error")).toHaveTextContent(
      "Ingresá un motivo para este tipo de movimiento."
    );

    expect(onCreate).not.toHaveBeenCalled();
  });

  it("accepts an INCOME without a reason", async () => {
    const { onCreate } = renderPanel();

    fillMovement("INCOME", "10,00", "");
    clickCashAction("Registrar movimiento");

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("movement-validation-error")).not.toBeInTheDocument();
  });

  it("requires a direction exactly for ADJUSTMENT", () => {
    const { onCreate } = renderPanel();

    fillMovement("ADJUSTMENT", "10,00", "Recount");
    clickCashAction("Registrar movimiento");

    expect(screen.getByTestId("movement-validation-error")).toHaveTextContent(
      "Elegí el sentido del ajuste."
    );
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("MovementPanel create payload", () => {
  it("sends the session, type, amount and reason without a direction", async () => {
    const { onCreate } = renderPanel();

    fillMovement("EXPENSE", "1500,00", "Cleaning supplies");
    clickCashAction("Registrar movimiento");

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const [input] = onCreate.mock.calls[0] ?? [];
    expect(input).toEqual({
      sessionId: SESSION.id,
      type: "EXPENSE",
      amount: "1500.00",
      reason: "Cleaning supplies",
    });
    expect(input).not.toHaveProperty("direction");
    expect(input).not.toHaveProperty("registerId");
    expect(input).not.toHaveProperty("tenantId");
  });

  it("omits the optional reason for INCOME", async () => {
    const { onCreate } = renderPanel();

    fillMovement("INCOME", "10,00", "");
    clickCashAction("Registrar movimiento");

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const [input] = onCreate.mock.calls[0] ?? [];
    expect(input).toEqual({ sessionId: SESSION.id, type: "INCOME", amount: "10.00" });
    expect(input).not.toHaveProperty("reason");
  });

  it("sends the direction for ADJUSTMENT", async () => {
    const { onCreate } = renderPanel();

    fillMovement("ADJUSTMENT", "10,00", "Recount", "DECREASE");
    clickCashAction("Registrar movimiento");

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const [input] = onCreate.mock.calls[0] ?? [];
    expect(input).toEqual({
      sessionId: SESSION.id,
      type: "ADJUSTMENT",
      amount: "10.00",
      reason: "Recount",
      direction: "DECREASE",
    });
  });

  it("clears the amount after a confirmed create", async () => {
    renderPanel();

    fillMovement("INCOME", "10,00", "");
    clickCashAction("Registrar movimiento");

    expect(await screen.findByLabelText("Importe")).toHaveValue("");
  });
});

describe("MovementPanel idempotency key", () => {
  it("reuses one key while an attempt is unresolved and rotates it after a confirmed create", async () => {
    const onCreate = vi.fn<CreateCall>();
    onCreate.mockRejectedValueOnce(new Error("fetch failed"));
    onCreate.mockResolvedValue(undefined);
    renderPanel({ onCreate });

    const submit = (): void => {
      clickCashAction("Registrar movimiento");
    };

    fillMovement("INCOME", "10,00", "");
    submit();
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    // A retry of the unresolved attempt reuses the key so the API replays.
    submit();
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(2);
    });

    const firstKey = onCreate.mock.calls[0]?.[1];
    const secondKey = onCreate.mock.calls[1]?.[1];
    expect(firstKey).toBeDefined();
    expect(secondKey).toBe(firstKey);

    // The confirmed create closes the attempt: the next one is a new intent.
    fillMovement("INCOME", "20,00", "");
    submit();
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(3);
    });

    const thirdKey = onCreate.mock.calls[2]?.[1];
    expect(thirdKey).toBeDefined();
    expect(thirdKey).not.toBe(firstKey);
  });

  it("never mints a key for a locally refused draft", () => {
    const { onCreate } = renderPanel();

    fillMovement("EXPENSE", "10,00", "");
    clickCashAction("Registrar movimiento");

    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("MovementPanel refusals", () => {
  it("surfaces the stable 400 validation refusal", () => {
    renderPanel({
      createError: new ApiRequestError(
        "VALIDATION_FAILED",
        "Invalid cash movement create body.",
        400
      ),
    });

    expect(screen.getByTestId("movement-create-error")).toHaveTextContent(
      "Revisá los datos de la operación"
    );
  });

  it("surfaces the shared 404", () => {
    renderPanel({ createError: new ApiRequestError("NOT_FOUND", "x", 404) });

    expect(screen.getByTestId("movement-create-error")).toHaveTextContent(
      "No encontramos la caja o sesión"
    );
  });

  it("surfaces the closed-session 409 as a terminal condition", () => {
    renderPanel({
      createError: new ApiRequestError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE, 409),
    });

    expect(screen.getByTestId("movement-create-error")).toHaveTextContent(
      "Esta sesión no está abierta"
    );
  });

  it("surfaces the reused-key 409 without minting a replacement key", () => {
    renderPanel({
      createError: new ApiRequestError("CONFLICT", CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE, 409),
    });

    expect(screen.getByTestId("movement-create-error")).toHaveTextContent(
      "El intento enviado corresponde a otro movimiento"
    );
  });

  it("surfaces the permission refusal", () => {
    renderPanel({ createError: new ApiRequestError("FORBIDDEN", "Access denied.", 403) });

    expect(screen.getByTestId("movement-create-error")).toHaveTextContent("Sin permiso");
  });

  it("relabels the button and blocks the fields while the create is in flight", () => {
    renderPanel({ isCreating: true });

    expect(screen.getByRole("button", { name: "Registrando movimiento…" })).toBeDisabled();
    expect(screen.getByLabelText("Importe")).toBeDisabled();
    expect(screen.getByLabelText("Motivo")).toBeDisabled();
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
