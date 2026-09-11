import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  __esModule: true,
  headers: vi.fn(),
  cookies: vi.fn(),
}));

import { render } from "@testing-library/react";
import { cookies, headers } from "next/headers";
import { appearanceBootstrapScriptWithTenantDefault } from "@/lib/appearance";
import RootLayout from "./layout";

function mockNoTenantSignal(): void {
  vi.mocked(headers).mockResolvedValue(new Headers());
  vi.mocked(cookies).mockResolvedValue({ toString: () => "" } as never);
}

describe("RootLayout pre-paint appearance bootstrap (root order)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNoTenantSignal();
    global.fetch = vi.fn();
  });

  it("renders the tenant-aware bootstrap before the preset <style> and every paint-affecting node", async () => {
    vi.mocked(cookies).mockResolvedValue({ toString: () => "session=staff" } as never);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ source: "tenant", brand: { defaultAppearance: "dark" } }),
    });

    const element = await RootLayout({ children: <span data-testid="child" /> });
    const { container } = render(element);

    const script = container.querySelector("script");
    const style = container.querySelector("style");
    const child = container.querySelector('[data-testid="child"]');

    expect(script).toBeTruthy();
    expect(style).toBeTruthy();
    expect(child).toBeTruthy();

    // The tenant default is embedded at the document root, not only in a late
    // nested segment: this is the exact source the parser executes first.
    expect(script?.textContent).toBe(appearanceBootstrapScriptWithTenantDefault("dark"));
    expect(script?.textContent).toContain('"dark"');

    // Root-document order: the tenant-aware script precedes the preset <style>
    // bridge and all paint-affecting content.
    expect(script!.compareDocumentPosition(style!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(script!.compareDocumentPosition(child!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.firstElementChild).toBe(script);
  });

  it("resolves the portal tenant default from the x-tenant-slug header", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-tenant-slug": "acme-clinic" }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ defaultAppearance: "dark" }),
    });
    global.fetch = fetchMock;

    const element = await RootLayout({ children: <span /> });
    const { container } = render(element);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3001/api/v1/public/tenants/acme-clinic/branding");
    const script = container.querySelector("script");
    expect(script?.textContent).toBe(appearanceBootstrapScriptWithTenantDefault("dark"));
  });

  it("falls back to the OS/Core bootstrap with no tenant signal and no fetch", async () => {
    const element = await RootLayout({ children: <span /> });
    const { container } = render(element);

    const script = container.querySelector("script");
    expect(script?.textContent).toBe(appearanceBootstrapScriptWithTenantDefault(undefined));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores an empty forwarded tenant slug and never fetches tenant branding", async () => {
    // Middleware forwards an empty value on staff/root paths; it must not be
    // treated as a tenant signal for the parser-blocking first paint.
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-tenant-slug": "" }));

    const element = await RootLayout({ children: <span /> });
    const { container } = render(element);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(container.querySelector("script")?.textContent).toBe(
      appearanceBootstrapScriptWithTenantDefault(undefined)
    );
  });
});
