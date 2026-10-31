import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const state = vi.hoisted(() => ({ pathname: "/app" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
import { NavSidebar, visibleNavLinks, NAV_LINKS } from "./nav-sidebar";

afterEach(() => {
  state.pathname = "/app";
  vi.restoreAllMocks();
});

describe("NavSidebar", () => {
  it("groups implemented destinations without inactive placeholder controls", () => {
    render(<NavSidebar productName="Example workspace" />);
    const nav = within(screen.getByTestId("nav-sidebar")).getByRole("navigation", {
      name: "Principal",
    });
    for (const label of [
      "Inicio",
      "Agenda",
      "Clientes",
      "Pacientes",
      "Catálogo",
      "Proveedores",
      "Compras",
      "POS",
      "Caja",
      "Facturación",
      "Fiscal",
      "Informes",
      "Notificaciones",
      "Importaciones",
      "Marca",
    ]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(15);
    expect(within(nav).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Section one|Section two|Section three/)).not.toBeInTheDocument();
    expect(screen.getByText("Example workspace")).toBeInTheDocument();
  });

  it("keeps a detail's parent section active and does not activate Overview", () => {
    state.pathname = "/app/customers/example/edit";
    render(<NavSidebar />);
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inicio" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Pacientes" })).not.toHaveAttribute("aria-current");
  });

  it("does not hide destinations when entitlements are unknown", () => {
    expect(visibleNavLinks(NAV_LINKS)).toEqual(NAV_LINKS);
  });

  it("retains ungated modules while hiding known unentitled destinations", () => {
    render(<NavSidebar entitlements={[]} />);
    for (const label of ["POS", "Caja", "Facturación", "Fiscal"])
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    for (const label of [
      "Clientes",
      "Pacientes",
      "Catálogo",
      "Compras",
      "Informes",
      "Importaciones",
    ])
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  });

  it.each([
    ["sales", "POS"],
    ["cash", "Caja"],
    ["billing", "Facturación"],
    ["fiscal", "Fiscal"],
  ])("keeps the %s feature gate independent", (feature, label) => {
    render(<NavSidebar entitlements={[feature]} />);
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    expect(
      visibleNavLinks(NAV_LINKS, [feature])
        .filter((link) => link.requiredFeature)
        .map((link) => link.requiredFeature)
    ).toEqual([feature]);
  });

  it("notifies the mobile shell after a navigation choice", () => {
    const onNavigate = vi.fn();
    render(<NavSidebar mobile onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Clientes" }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("does not pretend sign-out succeeded when the server is unavailable", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    render(<NavSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cerrar la sesión")
    );
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    expect(global.fetch).toHaveBeenCalledWith("/api/session/logout", { method: "POST" });
  });
});
