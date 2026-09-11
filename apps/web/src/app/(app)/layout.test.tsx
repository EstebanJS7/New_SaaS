vi.mock("next/headers", () => ({
  __esModule: true,
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AppHomePage from "./app/page";
import AppPlaceholderPage from "./app/placeholder/page";
import AppShellLayout from "./layout";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";

/** The bounded content region is contracted by its `data-shell-content` attribute. */
function getContentRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>("main[data-shell-content]");
  if (!region) {
    throw new Error("shell content region <main data-shell-content> was not rendered");
  }
  return region;
}

describe("AppShellLayout", () => {
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
    const element = await AppShellLayout({ children: <AppHomePage /> });
    render(element);

    expect(screen.getByTestId("nav-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();

    const region = getContentRegion();
    expect(region.tagName).toBe("MAIN");
    expect(within(region).getByTestId("sample-card")).toBeInTheDocument();
    expect(within(region).getByText("Staff workspace")).toBeInTheDocument();
  });

  it("keeps the shell around content of a deep-linked sub-route", async () => {
    const element = await AppShellLayout({ children: <AppPlaceholderPage /> });
    render(element);

    // Same chrome as the direct visit: the group layout surrounds any child.
    expect(screen.getByTestId("nav-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    const region = getContentRegion();
    expect(region.tagName).toBe("MAIN");
    expect(within(region).getByTestId("placeholder-content")).toBeInTheDocument();
  });

  it("hosts the sample card in the bounded region consuming tokens only", async () => {
    const element = await AppShellLayout({ children: <AppHomePage /> });
    render(element);

    const card = screen.getByTestId("sample-card");
    // Semantic-token classes from the shared Card primitive (no literals).
    expect(card.className).toContain("bg-card");
    expect(card.className).toContain("text-card-foreground");

    // Chrome carries token classes too and never inline color styles.
    const sidebar = screen.getByTestId("nav-sidebar");
    expect(sidebar.className).toContain("bg-card");
    for (const node of [sidebar, screen.getByTestId("topbar"), card]) {
      expect(node.getAttribute("style")).toBeNull();
    }
  });

  it("emits the brand style bridge server-side", async () => {
    const element = await AppShellLayout({ children: <AppHomePage /> });
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

    const element = await AppShellLayout({ children: <AppHomePage /> });
    const { container } = render(element);

    expect(fetchMock).toHaveBeenCalledTimes(1);

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
    const element = await AppShellLayout({ children: <AppHomePage /> });
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

    const element = await AppShellLayout({ children: <AppHomePage /> });
    const { container } = render(element);

    const script = container.querySelector("script");
    expect(script).toBeTruthy();

    // Execute the emitted bootstrap exactly as the parser would.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    new Function(script?.textContent ?? "")();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
