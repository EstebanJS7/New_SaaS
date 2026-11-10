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
      "Personal",
      "Sucursales",
      "Marca",
      "Configuración fiscal",
      "General",
    ]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(20);
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
    for (const label of ["POS", "Caja", "Facturación", "Fiscal", "Configuración fiscal"])
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    // «Pacientes» needs the veterinary feature (UX-037); permissions are unknown here.
    expect(screen.queryByRole("link", { name: "Pacientes" })).not.toBeInTheDocument();
    for (const label of ["Clientes", "Catálogo", "Compras", "Informes", "Importaciones"])
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
    const gated = visibleNavLinks(NAV_LINKS, [feature]).filter((link) => link.requiredFeature);
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.every((link) => link.requiredFeature === feature)).toBe(true);
  });

  it("shows «Configuración fiscal» in «Configuración» only with the fiscal feature (FISC-018)", () => {
    const link = NAV_LINKS.find((candidate) => candidate.href === "/app/settings/fiscal");
    expect(link).toMatchObject({ section: "Configuración", requiredFeature: "fiscal" });
    render(<NavSidebar entitlements={["fiscal"]} />);
    expect(screen.getByRole("link", { name: "Configuración fiscal" })).toHaveAttribute(
      "href",
      "/app/settings/fiscal"
    );
  });

  it("hides «Configuración fiscal» without the fiscal feature (FISC-018)", () => {
    render(<NavSidebar entitlements={["sales", "cash", "billing"]} />);
    expect(screen.queryByRole("link", { name: "Configuración fiscal" })).not.toBeInTheDocument();
  });

  describe("«Configuración › General» (CFG-001)", () => {
    const SETTINGS_PERMISSIONS = [
      "sales.settings.manage",
      "portal.settings.manage",
      "notifications.settings.manage",
      "scheduling.settings.manage",
    ];

    it("links «General» from «Configuración» to /app/settings/general", () => {
      const link = NAV_LINKS.find((candidate) => candidate.href === "/app/settings/general");
      expect(link).toMatchObject({ label: "General", section: "Configuración" });
      expect(link?.requiredFeature).toBeUndefined();
      render(<NavSidebar />);
      expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
        "href",
        "/app/settings/general"
      );
    });

    it("does not hide «General» when the caller's permissions are unknown", () => {
      expect(visibleNavLinks(NAV_LINKS, undefined, undefined)).toEqual(NAV_LINKS);
    });

    it("hides «General» when the caller holds none of the four settings permissions", () => {
      render(<NavSidebar permissions={["sales.read", "users.membership.manage"]} />);
      expect(screen.queryByRole("link", { name: "General" })).not.toBeInTheDocument();
      // Other destinations follow their own keys (UX-037): «Personal» stays.
      expect(screen.getByRole("link", { name: "Personal" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Sucursales" })).not.toBeInTheDocument();
    });

    it.each(SETTINGS_PERMISSIONS)("shows «General» with only %s", (permission) => {
      render(<NavSidebar permissions={[permission]} />);
      expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
    });
  });

  describe("module entries follow the caller's read permission (UX-037)", () => {
    const ALL_FEATURES = ["sales", "cash", "billing", "fiscal", "veterinary"];
    it.each([
      ["/app/agenda", ["scheduling.appointment.read"]],
      ["/app/customers", ["customers.read"]],
      ["/app/patients", ["patients.read"]],
      ["/app/catalog", ["catalog.read"]],
      ["/app/suppliers", ["suppliers.read"]],
      ["/app/purchases", ["purchases.read"]],
      ["/app/inventory", ["inventory.stock.read"]],
      ["/app/sales", ["sales.read", "sales.create"]],
      ["/app/cash", ["cash.read"]],
      ["/app/billing", ["billing.read"]],
      ["/app/fiscal", ["fiscal.read"]],
      ["/app/reports", ["reports.read"]],
      ["/app/notifications", ["notifications.delivery.read"]],
      ["/app/imports", ["imports.read"]],
      ["/app/settings/team", ["users.membership.manage"]],
      ["/app/settings/branches", ["branches.manage"]],
      ["/app/settings/fiscal", ["fiscal.profile.manage", "fiscal.signing_material.manage"]],
    ])("%s is shown with any of %j and hidden without them", (href, keys) => {
      for (const key of keys) {
        const shown = visibleNavLinks(NAV_LINKS, ALL_FEATURES, [key]).map((link) => link.href);
        expect(shown).toContain(href);
      }
      const hidden = visibleNavLinks(NAV_LINKS, ALL_FEATURES, ["unrelated.permission"]).map(
        (link) => link.href
      );
      expect(hidden).not.toContain(href);
    });

    it("hides «Pacientes» without the veterinary feature", () => {
      const shown = visibleNavLinks(NAV_LINKS, ["sales"], ["patients.read"]).map(
        (link) => link.href
      );
      expect(shown).not.toContain("/app/patients");
    });

    it("keeps «Inicio» and «Marca» for any member: their reads need no permission", () => {
      const shown = visibleNavLinks(NAV_LINKS, [], []).map((link) => link.href);
      expect(shown).toEqual(expect.arrayContaining(["/app", "/app/settings/branding"]));
    });
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
