import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerDetail } from "./customer-detail";
const id = "11111111-1111-4111-8111-111111111111";
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => nav,
}));
const base = "/api/customers/" + id;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const customer = {
  id,
  displayName: "Cliente sintético",
  kind: "INDIVIDUAL",
  isActive: true,
  firstName: "Ana",
};
let writes: { url: string; body: unknown }[];
function install(failure?: "contact" | "read" | "unknown" | "denied") {
  const fetch = vi.fn((url: unknown, init?: RequestInit) => {
    if (typeof url !== "string") throw Error("Expected path");
    if (init?.method) {
      writes.push({
        url,
        body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
      });
      if (failure === "unknown") return Promise.reject(Error("Lost response"));
      if (failure === "denied")
        return Promise.resolve(json({ error: { code: "FORBIDDEN", message: "Private" } }, 403));
      return Promise.resolve(json({ id }, 201));
    }
    if (failure === "read")
      return Promise.resolve(json({ error: { code: "NOT_FOUND", message: "Private name" } }, 404));
    if (url === base) return Promise.resolve(json(customer));
    if (failure === "contact" && url.endsWith("/contacts"))
      return Promise.resolve(json({ error: { code: "FORBIDDEN" } }, 403));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <CustomerDetail />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  writes = [];
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Customer detail subforms", () => {
  it("adds only supplied address keys and keeps exact country validation local", async () => {
    install();
    mount();
    await screen.findByRole("heading", { name: "Cliente sintético" });
    fireEvent.change(screen.getByLabelText("Dirección (obligatorio)", { exact: true }), {
      target: { value: " Calle sintética " },
    });
    fireEvent.change(screen.getByLabelText("Código de país", { exact: false }), {
      target: { value: "P" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar dirección" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Código de país", { exact: false })).toHaveFocus()
    );
    expect(writes).toEqual([]);
    fireEvent.change(screen.getByLabelText("Código de país", { exact: false }), {
      target: { value: "PY" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar dirección" }));
    await screen.findByText("Dirección agregada.");
    expect(writes).toEqual([
      { url: base + "/addresses", body: { line1: "Calle sintética", countryCode: "PY" } },
    ]);
  });
  it("accepts non-patterned contact values and clears only after acknowledgement", async () => {
    install();
    mount();
    await screen.findByRole("heading", { name: "Cliente sintético" });
    const field = screen.getByLabelText("Correo electrónico (obligatorio)", { exact: true });
    fireEvent.change(field, { target: { value: " sin-regex " } });
    fireEvent.click(screen.getByLabelText("Contacto principal"));
    fireEvent.click(screen.getByRole("button", { name: "Agregar contacto" }));
    await screen.findByText("Contacto agregado.");
    expect(writes).toEqual([
      { url: base + "/contacts", body: { kind: "EMAIL", value: "sin-regex", isPrimary: true } },
    ]);
    expect(field).toHaveValue("");
  });
  it("does not expose private read errors or child forms after missing customer", async () => {
    install("read");
    mount();
    await screen.findByText("No encontramos este registro de cliente.");
    expect(screen.queryByText("Private name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar contacto" })).not.toBeInTheDocument();
    expect(writes).toEqual([]);
  });
  it("does not infer contact-manage permission from customer read", async () => {
    install("contact");
    mount();
    await screen.findByRole("heading", { name: "Cliente sintético" });
    await screen.findByText("No tenés permiso para realizar esta acción sobre clientes.");
    expect(screen.queryByRole("button", { name: "Agregar contacto" })).not.toBeInTheDocument();
    expect(writes).toEqual([]);
  });
  it.each(["unknown", "denied"] as const)(
    "retains a %s contact command without automatic or repeated submission",
    async (failure) => {
      install(failure);
      mount();
      await screen.findByRole("heading", { name: "Cliente sintético" });
      fireEvent.change(screen.getByLabelText("Correo electrónico (obligatorio)", { exact: true }), {
        target: { value: "Copia privada" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Agregar contacto" }));
      await screen.findByRole("alert");
      expect(screen.getByRole("button", { name: "Agregar contacto" })).toBeDisabled();
      expect(
        screen.getByLabelText("Correo electrónico (obligatorio)", { exact: true })
      ).toHaveValue("Copia privada");
      expect(writes).toHaveLength(1);
    }
  );
  it("warns before edit navigation with an unsaved address and keeps it on cancellation", async () => {
    install();
    mount();
    await screen.findByRole("heading", { name: "Cliente sintético" });
    fireEvent.change(screen.getByLabelText("Dirección (obligatorio)", { exact: true }), {
      target: { value: "Copia privada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Editar cliente" }));
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Dirección (obligatorio)", { exact: true })).toHaveValue(
      "Copia privada"
    );
    expect(writes).toEqual([]);
  });
  it("cancels deactivation without effects and blocks another confirm after an uncertain response", async () => {
    install("unknown");
    mount();
    await screen.findByRole("heading", { name: "Cliente sintético" });
    fireEvent.click(screen.getByRole("button", { name: "Desactivar cliente" }));
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Desactivar cliente" }));
    const dialog = screen.getByRole("dialog", { name: "Desactivar cliente" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Desactivar cliente" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByRole("button", { name: "Desactivar cliente" })).toBeDisabled();
    expect(writes).toHaveLength(1);
  });
});
