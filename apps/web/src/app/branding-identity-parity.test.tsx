vi.mock("next/headers", () => ({
  __esModule: true,
  cookies: vi.fn(),
  headers: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { cookies, headers } from "next/headers";
import { activeProductPreset, resolveBrand, type ResolvedBrand } from "@newsaas/ui/branding";
import { TenantHeader } from "@/components/portal/tenant-header";
import { publicBrandingDtoToResolvedBrand, type PublicBrandingDto } from "@/lib/public-branding";
import AppShellLayout from "./(app)/layout";
import PortalLayout from "./(portal)/layout";

/**
 * Canonical API-local anonymous HMAC asset URL. Branding assets are
 * intentionally public, so both audiences must render this exact form.
 */
const PUBLIC_LOGO_URL =
  "http://localhost:3001/api/v1/public/branding/assets/logoLight/content?token=parity";

/** Normalized HSL for the #0ea5e9 primary override, as emitted by the style bridge. */
const PRIMARY_CSS = "--primary:199 89% 48%;";

describe("staff/portal resolved identity parity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    vi.mocked(cookies).mockResolvedValue({ toString: () => "session=staff" } as never);
    vi.mocked(headers).mockResolvedValue(new Headers());
  });

  it("renders the same primary token and logo URL across staff and portal audiences", async () => {
    const publicDto: PublicBrandingDto = {
      productDisplayName: activeProductPreset.productName,
      displayName: "Acme Clinic",
      primary: "#0ea5e9",
      logoLightUrl: PUBLIC_LOGO_URL,
    };

    const staffBrand: ResolvedBrand = {
      ...resolveBrand(activeProductPreset, undefined, {
        schemaVersion: 1,
        primary: "#0ea5e9",
      }),
      assets: { logoLightUrl: PUBLIC_LOGO_URL },
    };

    // Staff hits the private endpoint; portal hits the public endpoint. Both
    // responses carry the same canonical public URL and the same raw primary.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = input;
        if (url.includes("/branding/current")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ source: "tenant", brand: staffBrand }),
          });
        }
        if (url.includes("/api/v1/public/tenants/")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(publicDto) });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      })
    );

    const staff = render(await AppShellLayout({ children: <span data-testid="staff" /> }));
    const staffStyle = staff.container.querySelector("style")?.textContent ?? "";
    const staffLogo = staff.getByTestId("topbar-logo").getAttribute("src");

    const portalBrand = publicBrandingDtoToResolvedBrand(publicDto);
    const portal = render(
      await PortalLayout({
        children: (
          <TenantHeader
            productDisplayName={publicDto.productDisplayName}
            displayName={publicDto.displayName}
            brand={portalBrand}
          />
        ),
        params: { slug: "acme-clinic" },
      })
    );
    const portalStyle = portal.container.querySelector("style")?.textContent ?? "";
    const portalLogo = portal.getByTestId("tenant-logo").getAttribute("src");

    // Same rendered logo URL across audiences.
    expect(staffLogo).toBe(PUBLIC_LOGO_URL);
    expect(portalLogo).toBe(PUBLIC_LOGO_URL);
    expect(staffLogo).toBe(portalLogo);

    // Same resolved primary token across audiences.
    expect(staffStyle).toContain(PRIMARY_CSS);
    expect(portalStyle).toContain(PRIMARY_CSS);
    // The style bridge output is byte-identical for the same resolved brand.
    expect(staffStyle).toBe(portalStyle);
  });
});
