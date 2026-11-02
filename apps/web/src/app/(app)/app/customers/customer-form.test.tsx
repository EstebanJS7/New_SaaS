import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomerForm } from "./customer-form";
import { CustomerRequestError, type Customer } from "./customers-api";
const navigation = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
afterEach(() => vi.clearAllMocks());
const existing: Customer = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  kind: "INDIVIDUAL",
  displayName: "Nombre guardado",
  firstName: "Ana",
  lastName: null,
  documentNumber: "123",
  legalName: null,
  taxId: null,
  isActive: true,
  createdAt: "2026-10-31T12:00:00Z",
  updatedAt: "2026-10-31T12:00:00Z",
};
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}
function installDialog() {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
describe("Customer create/edit working copy", () => {
  it("focuses the first invalid field without submitting, retaining an oversized value", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm onSubmit={submit} isPending={false} error={null} />);
    fill("Nombre visible", "x".repeat(201));
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre visible", { exact: false })).toHaveFocus()
    );
    expect(screen.getByText("Usá hasta 200 caracteres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre visible", { exact: false })).toHaveValue("x".repeat(201));
    expect(submit).not.toHaveBeenCalled();
    fill("Nombre visible", "Nombre corregido");
    expect(screen.queryByText("Usá hasta 200 caracteres.")).not.toBeInTheDocument();
  });
  it("keeps company and individual command keys distinct and trims the existing wire fields", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm onSubmit={submit} isPending={false} error={null} />);
    fill("Nombre visible", " Empresa sintética ");
    fill("Nombres", "No enviar");
    fireEvent.change(screen.getByLabelText("Tipo de cliente"), { target: { value: "COMPANY" } });
    fill("Razón social", " Sociedad ");
    fill("RUC", " 123-4 ");
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        kind: "COMPANY",
        displayName: "Empresa sintética",
        legalName: "Sociedad",
        taxId: "123-4",
      })
    );
  });
  it("preserves edit omission semantics and the immutable kind", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm customer={existing} onSubmit={submit} isPending={false} error={null} />);
    expect(screen.getByLabelText("Tipo de cliente")).toBeDisabled();
    fill("Nombres", "");
    fill("Nombre visible", "Nuevo nombre");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ displayName: "Nuevo nombre" }));
  });
  it("blocks rapid duplicate submits while a command is unresolved", () => {
    const submit = vi.fn(() => new Promise(() => undefined));
    render(<CustomerForm onSubmit={submit} isPending={false} error={null} />);
    fill("Nombre visible", "Ana");
    const save = screen.getByRole("button", { name: "Crear cliente" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertain values visible and prevents another mutation even after editing", () => {
    const submit = vi.fn().mockResolvedValue({});
    const { rerender } = render(<CustomerForm onSubmit={submit} isPending={false} error={null} />);
    fill("Nombre visible", "Sin acuse");
    rerender(
      <CustomerForm
        onSubmit={submit}
        isPending={false}
        error={new CustomerRequestError("NETWORK_ERROR", 0, true)}
      />
    );
    expect(screen.getByLabelText("Nombre visible", { exact: false })).toHaveValue("Sin acuse");
    expect(screen.getByRole("button", { name: "Crear cliente" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
    expect(submit).not.toHaveBeenCalled();
  });
  it("confirms discard, retains the draft on cancel and guards document unload", async () => {
    installDialog();
    render(
      <CustomerForm onSubmit={vi.fn().mockResolvedValue({})} isPending={false} error={null} />
    );
    fill("Nombre visible", "Copia privada");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("La copia de este formulario se perderá");
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByLabelText("Nombre visible", { exact: false })).toHaveValue("Copia privada");
    expect(navigation.back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar y salir" }));
    await waitFor(() => expect(navigation.back).toHaveBeenCalledTimes(1));
  });
});
