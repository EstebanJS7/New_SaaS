import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));
vi.mock("./route-feedback", () => ({ RouteFeedback: () => null }));
import { WorkspaceShell } from "./workspace-shell";
import { CapabilitiesProvider } from "@/lib/capabilities";

afterEach(() => vi.restoreAllMocks());

function setup() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    }),
  });
  render(
    <WorkspaceShell productName="Example product">
      <h1>Content</h1>
    </WorkspaceShell>
  );
}

describe("responsive workspace shell", () => {
  it("provides a skip link and bounds the actual page content", () => {
    setup();
    expect(screen.getByRole("link", { name: "Ir al contenido" })).toHaveAttribute(
      "href",
      "#workspace-content"
    );
    expect(
      within(screen.getByRole("main")).getByRole("heading", { name: "Content" })
    ).toBeInTheDocument();
  });
  it("opens a native modal and closes it after choosing a section", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir navegación" }));
    const dialog = screen.getByRole("dialog", { name: "Navegación del espacio de trabajo" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Abrir navegación" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    fireEvent.click(within(dialog).getByRole("link", { name: "Pacientes" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Abrir navegación" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
  it("responds to the native Escape/cancel event", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir navegación" }));
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
  });
});

describe("workspace shell capabilities (UX-037)", () => {
  it("passes the shared capabilities to the navigation", () => {
    render(
      <CapabilitiesProvider value={{ permissions: [], features: [] }}>
        <WorkspaceShell productName="Example product">
          <h1>Content</h1>
        </WorkspaceShell>
      </CapabilitiesProvider>
    );
    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).queryByRole("link", { name: "POS" })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "General" })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Clientes" })).toBeInTheDocument();
  });

  it("shows every link without a provider (capabilities unknown)", () => {
    render(
      <WorkspaceShell productName="Example product">
        <h1>Content</h1>
      </WorkspaceShell>
    );
    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).getByRole("link", { name: "POS" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "General" })).toBeInTheDocument();
  });
});
