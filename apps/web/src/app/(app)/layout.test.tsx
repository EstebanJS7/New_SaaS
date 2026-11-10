vi.mock("next/headers", () => ({
  __esModule: true,
  headers: () =>
    Promise.resolve(new Headers({ "x-staff-return-path": globalThis.location.pathname })),
  cookies: vi.fn().mockResolvedValue({
    toString: () => "",
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
    clear: () => undefined,
    size: 0,
  }),
}));

const redirect = vi.fn((path: string) => {
  // `next/navigation`'s redirect works by THROWING a sentinel the framework catches, so a
  // mock that merely records would let the layout render and the test would assert the
  // wrong thing.
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
  usePathname: () => "/app",
}));
vi.mock("@/components/shell/route-feedback", () => ({ RouteFeedback: () => null }));

import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AppHomePage from "./app/page";
import AppShellLayout from "./layout";
import { QueryProvider } from "@/providers/query-provider";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";

/**
 * The shell home, as the running app composes it.
 *
 * The home page is a live surface now ([[REP-008]]), not a static card: its four
 * cards read the reporting API through TanStack Query. The ROOT layout supplies
 * the client in production (`QueryProvider` wraps every route), and this suite
 * renders the layout WITHOUT that root layout — so the provider is supplied here,
 * exactly where the root layout would supply it.
 */
function homePage(): ReactElement {
  return (
    <QueryProvider>
      <AppHomePage />
    </QueryProvider>
  );
}

/** The bounded content region is contracted by its `data-shell-content` attribute. */
function getContentRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>("main[data-shell-content]");
  if (!region) {
    throw new Error("shell content region <main data-shell-content> was not rendered");
  }
  return region;
}

describe("AppShellLayout", () => {
  /**
   * The gate ([[SHELL-001]]): a signed-out visitor is sent to `/login` rather than shown an
   * empty shell, and the asymmetry with an outage is the point — only a `401` proves there is
   * no session.
   */
  it("sends a visitor to /login when the private read says 401", async () => {
    redirect.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });

    await expect(AppShellLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("preserves an authorized resource destination through the sign-in gate", async () => {
    const target = "/app/sales/11111111-1111-4111-8111-111111111111";
    window.history.replaceState(null, "", target);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    try {
      await expect(AppShellLayout({ children: null })).rejects.toThrow(
        "NEXT_REDIRECT:/login?returnTo="
      );
      expect(redirect).toHaveBeenLastCalledWith(
        `/login?returnTo=${encodeURIComponent(target)}&reason=session-expired`
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  /**
   * ONB-001: a suspended member keeps a valid session, but the API refuses every
   * tenant request with 403. The shell would render module after module of
   * permission errors, so the layout shows one clear screen instead.
   */
  it("shows the no-access screen instead of the shell when the private read says 403", async () => {
    redirect.mockClear();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    render(await AppShellLayout({ children: <p>contenido privado</p> }));

    expect(screen.getByRole("heading", { name: "Tu acceso no está activo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.queryByTestId("nav-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByText("contenido privado")).not.toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still renders the shell when the private read fails with a server error", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    render(await AppShellLayout({ children: <p>contenido privado</p> }));

    expect(screen.getByText("contenido privado")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tu acceso no está activo" })).toBeNull();
  });

  it("does NOT send a signed-in visitor anywhere when branding is merely broken", async () => {
    redirect.mockClear();
    // A 500, a timeout or an unparseable body is an OUTAGE. Treating it as "signed out" would
    // log every staff member out the moment branding has a bad minute.
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

    // Resolves rather than throwing: the shell renders with the product preset.
    await expect(AppShellLayout({ children: null })).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          source: "preset",
          brand: resolveBrand(activeProductPreset),
        }),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("wraps a direct visit to the shell home with sidebar and topbar", async () => {
    const element = await AppShellLayout({ children: homePage() });
    render(element);

    expect(screen.getByTestId("nav-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();

    const region = getContentRegion();
    expect(region.tagName).toBe("MAIN");
    // The dashboard is what the shell home renders now, and it renders INSIDE the
    // bounded region rather than beside it.
    expect(within(region).getByTestId("app-dashboard")).toBeInTheDocument();
    expect(within(region).getByRole("heading", { level: 1, name: "Panel" })).toBeInTheDocument();
  });

  it("keeps the shell around the content of a deep-linked sub-route", async () => {
    // The child is a SYNTHETIC element rather than a page, and it used to be a real route
    // (`/app/placeholder`) that existed only for this case: a test-only route ships to production and
    // is reachable by URL, and the surface-integrity fence reported it as the orphan it was. The
    // property under test is the layout's — it surrounds ANY child — so a local element proves it
    // without shipping a page nobody can reach.
    const element = await AppShellLayout({
      children: <div data-testid="sub-route-content">Sub-route content</div>,
    });
    render(element);

    expect(screen.getByTestId("nav-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    const region = getContentRegion();
    expect(region.tagName).toBe("MAIN");
    expect(within(region).getByTestId("sub-route-content")).toBeInTheDocument();
  });

  it("hosts the dashboard in the bounded region consuming tokens only", async () => {
    const element = await AppShellLayout({ children: homePage() });
    render(element);

    // The property is the CONTENT's, and it did not change when the placeholder
    // became a live surface: the dashboard is a token surface, so a tenant brand
    // re-themes it without touching a component. Asserting it on the placeholder's
    // `sample-card` would have silently stopped proving anything once that card
    // was replaced, which is exactly what happened.
    const dashboard = screen.getByTestId("app-dashboard");
    expect(dashboard.className).toContain("text-foreground");

    // Chrome carries token classes too and never inline color styles.
    const sidebar = screen.getByTestId("nav-sidebar");
    expect(sidebar.className).toContain("workspace-sidebar");
    for (const node of [sidebar, screen.getByTestId("topbar"), dashboard]) {
      expect(node.getAttribute("style")).toBeNull();
    }
  });

  /**
   * UX-037: the layout loads the caller's capabilities once per request and the
   * shell's nav hides what the caller cannot use. A failed load is UNKNOWN, never
   * "no permissions": the nav shows everything and the API stays the authority.
   */
  describe("caller capabilities (UX-037)", () => {
    function routeFetch(capabilities: () => Promise<unknown>): ReturnType<typeof vi.fn> {
      const fetchMock = vi.fn((input: string) => {
        const url = input;
        if (url.endsWith("/memberships/me/capabilities")) return capabilities();
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ source: "preset", brand: resolveBrand(activeProductPreset) }),
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    function navLinks(): string[] {
      const nav = within(screen.getByTestId("nav-sidebar")).getByRole("navigation", {
        name: "Principal",
      });
      return within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent ?? "");
    }

    it("loads the capabilities exactly once and hides nav links the caller cannot use", async () => {
      const fetchMock = routeFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ permissions: ["sales.read"], features: ["cash"] }),
        })
      );

      render(await AppShellLayout({ children: <p>contenido</p> }));

      const capabilityCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).endsWith("/memberships/me/capabilities")
      );
      expect(capabilityCalls).toHaveLength(1);
      const links = navLinks();
      expect(links).toContain("Caja");
      expect(links).toContain("Clientes");
      for (const hidden of ["POS", "Facturación", "Fiscal", "Configuración fiscal", "General"]) {
        expect(links).not.toContain(hidden);
      }
    });

    it.each([
      [
        "a 500 answer",
        () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
      ],
      ["a network failure", () => Promise.reject(new Error("timeout"))],
      [
        "a malformed body",
        () =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ permissions: "all" }),
          }),
      ],
    ])("treats %s as unknown and still shows every nav link", async (_label, capabilities) => {
      routeFetch(capabilities);

      render(await AppShellLayout({ children: <p>contenido</p> }));

      expect(navLinks()).toHaveLength(20);
      expect(navLinks()).toEqual(
        expect.arrayContaining(["POS", "General", "Configuración fiscal"])
      );
    });
  });

  it("emits the brand style bridge server-side", async () => {
    const element = await AppShellLayout({ children: homePage() });
    const { container } = render(element);

    const style = container.querySelector("style");
    expect(style).toBeTruthy();
    expect(style?.textContent).toContain("--primary:");
  });

  it("resolves tenant branding into the CSS bridge output", async () => {
    const tenantBrand = resolveBrand(activeProductPreset, undefined, {
      schemaVersion: 1,
      primary: "#0ea5e9",
      accent: "#f43f5e",
      radius: "0.75rem",
      defaultAppearance: "dark",
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          source: "tenant",
          brand: tenantBrand,
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const element = await AppShellLayout({ children: homePage() });
    const { container } = render(element);

    // Branding is resolved EXACTLY ONCE, and this counts branding calls rather
    // than all calls: the dashboard inside the shell reads its four reports
    // through the same `fetch`, so a total count would be measuring the content's
    // reads, not the shell's one resolution of the tenant brand.
    const brandingCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/branding/current")
    );
    expect(brandingCalls).toHaveLength(1);

    const style = container.querySelector("style");
    expect(style).toBeTruthy();
    // toCssVariables serializes tenant colors as HSL, so assert the resolved
    // tenant values rather than the raw hex input.
    expect(style?.textContent).toContain("--primary:199 89% 48%;");
    expect(style?.textContent).toContain("--accent:350 89% 60%;");
    expect(style?.textContent).toContain("--radius:0.75rem;");

    // The tenant default appearance is wired into the parser-blocking bootstrap.
    const script = container.querySelector("script");
    expect(script).toBeTruthy();
    expect(script?.textContent).toContain("newsaas.appearance");
  });

  it("emits the tenant-aware appearance bootstrap before paint-affecting shell content", async () => {
    const element = await AppShellLayout({ children: homePage() });
    const { container } = render(element);

    const script = container.querySelector("script");
    expect(script).toBeTruthy();
    const paintTarget = container.querySelector('[data-testid="nav-sidebar"]');
    expect(paintTarget).toBeTruthy();

    // The script must precede any visible shell node so the `dark` class is
    // resolved before first paint of tenant content.
    const position = script!.compareDocumentPosition(paintTarget!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets a valid local light preference win over a tenant dark default", async () => {
    window.localStorage.setItem("newsaas.appearance", "light");

    const tenantBrand = resolveBrand(activeProductPreset, undefined, {
      schemaVersion: 1,
      defaultAppearance: "dark",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            source: "tenant",
            brand: tenantBrand,
          }),
      })
    );

    const element = await AppShellLayout({ children: homePage() });
    const { container } = render(element);

    const script = container.querySelector("script");
    expect(script).toBeTruthy();

    // Execute the emitted bootstrap exactly as the parser would.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    new Function(script?.textContent ?? "")();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
