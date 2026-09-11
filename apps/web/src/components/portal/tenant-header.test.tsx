import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { activeProductPreset, resolveBrand, type ResolvedBrand } from "@newsaas/ui/branding";
import { TenantHeader } from "./tenant-header";

const PRODUCT_NAME = activeProductPreset.productName;
const IDENTITY_NAME = "Acme Clinic";
const LIGHT_LOGO =
  "http://localhost:3001/api/v1/public/branding/assets/logoLight/content?token=light";
const DARK_LOGO = "http://localhost:3001/api/v1/public/branding/assets/logoDark/content?token=dark";

function renderHeader(assets?: ResolvedBrand["assets"]) {
  return render(
    <TenantHeader
      productDisplayName={PRODUCT_NAME}
      displayName={IDENTITY_NAME}
      brand={{ ...resolveBrand(activeProductPreset), assets }}
    />
  );
}

/**
 * TenantHeader logo fallback matrix.
 *
 * The dark-only case is the regression guard: a `<picture>` whose only child is
 * a `<source>` and whose `<img>` fallback is absent renders nothing in the light
 * scheme, hiding the tenant identity. Every rendered logo must expose
 * `alt={identityName}` so the identity stays accessible.
 */
describe("TenantHeader logo fallback", () => {
  it("prefers the light logo and offers the dark variant via a color-scheme source", () => {
    const { container } = renderHeader({ logoLightUrl: LIGHT_LOGO, logoDarkUrl: DARK_LOGO });

    const source = container.querySelector("source");
    expect(source?.getAttribute("srcset")).toBe(DARK_LOGO);
    expect(source?.getAttribute("media")).toBe("(prefers-color-scheme: dark)");

    const logo = screen.getByTestId("tenant-logo");
    expect(logo.tagName).toBe("IMG");
    expect(logo.getAttribute("src")).toBe(LIGHT_LOGO);
    expect(screen.getByAltText(IDENTITY_NAME)).toBe(logo);
  });

  it("renders the light logo when it is the only variant", () => {
    const { container } = renderHeader({ logoLightUrl: LIGHT_LOGO });

    expect(container.querySelector("source")).toBeNull();

    const logo = screen.getByTestId("tenant-logo");
    expect(logo.tagName).toBe("IMG");
    expect(logo.getAttribute("src")).toBe(LIGHT_LOGO);
    expect(screen.getByAltText(IDENTITY_NAME)).toBe(logo);
  });

  it("renders a visible, accessible image when only the dark logo exists", () => {
    const { container } = renderHeader({ logoDarkUrl: DARK_LOGO });

    // A <picture> with only a <source> and no <img> renders nothing, so the
    // dark-only branch must fall back to a plain <img>.
    expect(container.querySelector("picture")).toBeNull();

    const logo = screen.getByTestId("tenant-logo");
    expect(logo.tagName).toBe("IMG");
    expect(logo.getAttribute("src")).toBe(DARK_LOGO);
    expect(screen.getByAltText(IDENTITY_NAME)).toBe(logo);
  });

  it("renders no logo image when the tenant has no assets", () => {
    const { container } = renderHeader(undefined);

    expect(screen.queryByTestId("tenant-logo")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();
    expect(container.querySelector("source")).toBeNull();
    // Identity text is still present even without an image.
    expect(screen.getByTestId("tenant-name").textContent).toBe(IDENTITY_NAME);
  });
});
