import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { SessionPanel } from "./session-panel";
import { MovementPanel } from "./movement-panel";
import { ClosePanel } from "./close-panel";
import { ApiRequestError, type CashSession } from "./cash-api";
import { normalizeCashAmountInput } from "./cash-validation";

const session: CashSession = {
  id: "11111111-1111-4111-8111-111111111111",
  registerId: "22222222-2222-4222-8222-222222222222",
  openedByMembershipId: "33333333-3333-4333-8333-333333333333",
  status: "OPEN",
  openedAt: "2026-09-27T08:00:00Z",
  closedAt: null,
  openingAmount: "0.00",
  expectedAmount: null,
  countedAmount: null,
  differenceAmount: null,
  createdAt: "2026-09-27T08:00:00Z",
  updatedAt: "2026-09-27T08:00:00Z",
};
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
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("cash local boundary and explicit review", () => {
  it.each([
    ["1.234,50", "1234.50"],
    ["999.999.999.999,99", "999999999999.99"],
    ["0,00", "0.00"],
    ["1.234", "1234"],
    ["1,500", null],
    ["1234.50", null],
    ["1,234", null],
    ["1000000000000", null],
  ])("normalizes %s to %s without rounding", (input, expected) => {
    expect(normalizeCashAmountInput(input)).toBe(expected);
  });

  it("reviews opening, cancels without a command, then sends the exact maximum", async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionPanel
        sessions={[]}
        isLoading={false}
        loadError={null}
        statusFilter="ALL"
        onStatusFilterChange={vi.fn()}
        registers={[
          {
            id: session.registerId,
            name: "Caja sintética",
            isActive: true,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          },
        ]}
        registersLoading={false}
        onOpen={onOpen}
        isOpening={false}
        openError={null}
        opened={null}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Caja"), { target: { value: session.registerId } });
    fireEvent.change(screen.getByLabelText("Importe inicial"), {
      target: { value: "999.999.999.999,99" },
    });
    click("Abrir sesión");
    expect(onOpen).not.toHaveBeenCalled();
    const modal = screen.getByRole("dialog", { name: "Revisar apertura" });
    expect(modal).toHaveTextContent("999.999.999.999,99");
    expect(within(modal).getByRole("button", { name: "Volver" })).toHaveFocus();
    click("Volver");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Importe inicial")).toHaveValue("999.999.999.999,99");
    click("Abrir sesión");
    click("Confirmar apertura");
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledExactlyOnceWith({
        registerId: session.registerId,
        openingAmount: "999999999999.99",
      })
    );
  });

  it("does not mint a movement key on review/cancel and preserves it after a rejected attempt", async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("PRIVATE response"))
      .mockResolvedValue(undefined);
    const key = vi.spyOn(crypto, "randomUUID");
    render(
      <MovementPanel
        session={session}
        movements={[]}
        isLoading={false}
        loadError={null}
        onCreate={onCreate}
        isCreating={false}
        createError={null}
        created={null}
      />
    );
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: "INCOME" } });
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "1.234,50" } });
    click("Registrar movimiento");
    expect(onCreate).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
    click("Volver");
    expect(key).not.toHaveBeenCalled();
    click("Registrar movimiento");
    click("Confirmar movimiento");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirmar movimiento" })).toBeEnabled()
    );
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("PRIVATE");
    click("Confirmar movimiento");
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(onCreate.mock.calls[1]).toEqual(onCreate.mock.calls[0]);
    expect(onCreate.mock.calls[0][0]).toEqual({
      sessionId: session.id,
      type: "INCOME",
      amount: "1234.50",
    });
    expect(key).toHaveBeenCalledTimes(1);
    key.mockRestore();
  });

  it("reviews only the count, blocks duplicate confirmation and sanitizes a close refusal", async () => {
    let reject!: (error: Error) => void;
    const onClose = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    );
    const props = { session, onClose, isClosing: false, closeError: null as Error | null };
    const view = render(<ClosePanel {...props} />);
    fireEvent.change(screen.getByLabelText("Importe contado"), { target: { value: "0,00" } });
    click("Cerrar sesión");
    expect(onClose).not.toHaveBeenCalled();
    click("Volver");
    expect(onClose).not.toHaveBeenCalled();
    click("Cerrar sesión");
    const confirm = screen.getByRole("button", { name: "Confirmar cierre" });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ countedAmount: "0.00" });
    reject(new Error("PRIVATE timeout"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirmar cierre" })).toBeEnabled()
    );
    view.rerender(
      <ClosePanel {...props} closeError={new ApiRequestError("UNKNOWN", "PRIVATE timeout", 503)} />
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("PRIVATE");
    expect(screen.getByLabelText("Importe contado")).toHaveValue("0,00");
    expect(screen.queryByTestId("close-outcome")).not.toBeInTheDocument();
  });
});
