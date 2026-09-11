vi.mock("next/headers", () => ({
  __esModule: true,
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { activeProductPreset } from "@newsaas/ui/branding";
import { publicBrandingDtoToResolvedBrand, type PublicBrandingDto } from "@/lib/public-branding";
import PortalLayout from "./layout";

describe("PortalLayout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  function mockPublicBranding(dto: PublicBrandingDto): void {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dto),
    });
  }

  it("server-fetches the public branding endpoint without a staff cookie", async () => {
    mockPublicBranding({ productDisplayName: activeProductPreset.productName });

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: { slug: "acme-clinic" },
    });
    render(element);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toContain("/api/v1/public/tenants/acme-clinic/branding");
    expect(options?.cache).toBe("no-store");
    // No staff cookie is forwarded by the public portal layout.
    expect(options?.headers).toBeUndefined();
  });

  it("falls back to the product preset when the public endpoint fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: { slug: "unknown" },
    });
    const { container } = render(element);

    const style = container.querySelector("style");
    expect(style?.textContent).toContain("--primary:");
  });

  it("emits the tenant brand style bridge server-side", async () => {
    mockPublicBranding({
      productDisplayName: activeProductPreset.productName,
      primary: "#0ea5e9",
      accent: "#f43f5e",
      radius: "0.75rem",
      defaultAppearance: "dark",
    });

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: { slug: "acme-clinic" },
    });
    const { container } = render(element);

    const style = container.querySelector("style");
    expect(style).toBeTruthy();
    expect(style?.textContent).toContain("--primary:199 89% 48%;");
    expect(style?.textContent).toContain("--accent:350 89% 60%;");
    expect(style?.textContent).toContain("--radius:0.75rem;");

    const script = container.querySelector("script");
    expect(script).toBeTruthy();
    expect(script?.textContent).toContain("newsaas.appearance");
  });

  it("emits the tenant-aware bootstrap before paint-affecting portal content", async () => {
    mockPublicBranding({ productDisplayName: activeProductPreset.productName });

    const element = await PortalLayout({
      children: <span data-testid="portal-content" />,
      params: { slug: "acme-clinic" },
    });
    const { container } = render(element);

    const script = container.querySelector("script");
    const content = container.querySelector('[data-testid="portal-content"]');
    expect(script).toBeTruthy();
    expect(content).toBeTruthy();
    const position = script!.compareDocumentPosition(content!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("maps public DTO asset URLs into the resolved brand with token/logo identity parity", async () => {
    const logoUrl = "/branding/assets/logoLight/content?token=portal";
    mockPublicBranding({
      productDisplayName: activeProductPreset.productName,
      displayName: "Acme Clinic",
      primary: "#0ea5e9",
      logoLightUrl: logoUrl,
    });

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: { slug: "acme-clinic" },
    });
    const { container } = render(element);

    const style = container.querySelector("style");
    expect(style?.textContent).toContain("--primary:199 89% 48%;");

    const brand = publicBrandingDtoToResolvedBrand({
      productDisplayName: activeProductPreset.productName,
      displayName: "Acme Clinic",
      primary: "#0ea5e9",
      logoLightUrl: logoUrl,
    });
    expect(brand.assets?.logoLightUrl).toBe(logoUrl);
    // The style bridge normalizes hex to HSL; the resolved theme keeps the raw
    // tenant override for downstream consumers.
    expect(style?.textContent).toContain("--primary:199 89% 48%;");
    expect(container.innerHTML).not.toContain(logoUrl);
  });

  it("never exposes private DTO fields in the rendered output", async () => {
    mockPublicBranding({
      productDisplayName: activeProductPreset.productName,
      displayName: "Acme Clinic",
      primary: "#0ea5e9",
      logoLightUrl: "/branding/assets/logoLight/content?token=portal",
      // These private fields must be dropped by the mapping, not forwarded.
      assetKey: "s3://secret/key",
      tenantId: "tenant-uuid",
      updatedBy: "user-uuid",
      auditLogId: "audit-uuid",
      membershipRole: "admin",
      ruc: "123456789",
      billingSecret: "sk_live_secret",
    } as unknown as PublicBrandingDto);

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: { slug: "acme-clinic" },
    });
    const { container } = render(element);

    const html = container.innerHTML;
    // Assert on concrete private values rather than substrings that could
    // appear in CSS variable names or font stacks.
    expect(html).not.toContain("s3://secret/key");
    expect(html).not.toContain("tenant-uuid");
    expect(html).not.toContain("user-uuid");
    expect(html).not.toContain("audit-uuid");
    expect(html).not.toContain("sk_live_secret");
    expect(html).not.toContain("123456789");

    const brand = publicBrandingDtoToResolvedBrand({
      productDisplayName: activeProductPreset.productName,
      displayName: "Acme Clinic",
      primary: "#0ea5e9",
      logoLightUrl: "/branding/assets/logoLight/content?token=portal",
      assetKey: "s3://secret/key",
      tenantId: "tenant-uuid",
      updatedBy: "user-uuid",
      auditLogId: "audit-uuid",
      membershipRole: "admin",
      ruc: "123456789",
      billingSecret: "sk_live_secret",
    } as unknown as PublicBrandingDto);
    expect(brand).not.toHaveProperty("assetKey");
    expect(brand).not.toHaveProperty("tenantId");
    expect(brand).not.toHaveProperty("updatedBy");
    expect(brand).not.toHaveProperty("auditLogId");
    expect(brand).not.toHaveProperty("membershipRole");
    expect(brand).not.toHaveProperty("ruc");
    expect(brand).not.toHaveProperty("billingSecret");
  });

  it("reads the tenant slug from the x-tenant-slug header when no path slug is provided", async () => {
    const { headers } = await import("next/headers");
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-tenant-slug": "header-clinic" }));

    mockPublicBranding({ productDisplayName: activeProductPreset.productName });

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: {},
    });
    render(element);

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("/api/v1/public/tenants/header-clinic/branding");
  });
});
