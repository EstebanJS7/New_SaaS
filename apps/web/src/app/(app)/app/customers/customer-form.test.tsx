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
  fiscalOperationType: "B2B",
  isActive: true,
  createdAt: "2026-10-31T12:00:00Z",
  updatedAt: "2026-10-31T12:00:00Z",
};
const company: Customer = {
  ...existing,
  id: "33333333-3333-4333-8333-333333333333",
  kind: "COMPANY",
  displayName: "Empresa guardada",
  firstName: null,
  lastName: null,
  documentNumber: null,
  legalName: "Sociedad",
  taxId: "80012345-6",
  fiscalOperationType: null,
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
  it("declares the fiscal operation type on create and omits the key when left undeclared", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm onSubmit={submit} isPending={false} error={null} />);
    fill("Nombre visible", "Paws S.A.");
    fireEvent.change(screen.getByLabelText("Tipo de cliente"), { target: { value: "COMPANY" } });
    fill("Razón social", "Paws");
    fill("RUC", "80012345-6");
    fireEvent.change(screen.getByLabelText("Tipo de operación fiscal (iTiOpe)"), {
      target: { value: "B2G" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        kind: "COMPANY",
        displayName: "Paws S.A.",
        legalName: "Paws",
        taxId: "80012345-6",
        fiscalOperationType: "B2G",
      })
    );
  });
  it("never invents a declaration for a create left undeclared", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm customer={company} onSubmit={submit} isPending={false} error={null} />);

    // A company whose row has no declaration opens on "Sin declarar".
    expect(screen.getByLabelText("Tipo de operación fiscal (iTiOpe)")).toHaveValue("");
    fill("Nombre visible", "Empresa renombrada");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        displayName: "Empresa renombrada",
      })
    );
    expect(submit.mock.calls[0][0]).not.toHaveProperty("fiscalOperationType");
  });
  it("preserves a declared operation type on an untouched edit and sends an explicit change", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm customer={existing} onSubmit={submit} isPending={false} error={null} />);

    // The form shows the stored declaration instead of re-picking one.
    expect(screen.getByLabelText("Tipo de operación fiscal (iTiOpe)")).toHaveValue("B2B");
    fill("Nombre visible", "Nuevo nombre");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ displayName: "Nuevo nombre" }));

    // Omission above never erased the declaration; an explicit change is sent.
    expect(submit.mock.calls[0][0]).not.toHaveProperty("fiscalOperationType");
    fireEvent.change(screen.getByLabelText("Tipo de operación fiscal (iTiOpe)"), {
      target: { value: "B2F" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        displayName: "Nuevo nombre",
        fiscalOperationType: "B2F",
      })
    );
  });
  it("clears a declared operation type only when 'Sin declarar' is chosen", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<CustomerForm customer={existing} onSubmit={submit} isPending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Tipo de operación fiscal (iTiOpe)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ fiscalOperationType: null }));
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
