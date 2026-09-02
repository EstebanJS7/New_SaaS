import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BrandingPreview } from "./branding-preview";

describe("BrandingPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders local form state without calling the API", () => {
    global.fetch = vi.fn();

    render(<BrandingPreview primary="#0ea5e9" accent="#f43f5e" radius="0.75rem" />);

    expect(screen.getByText("Primary surface")).toBeInTheDocument();
    expect(screen.getByText("Accent surface")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the preset when no local overrides are provided", () => {
    global.fetch = vi.fn();

    render(<BrandingPreview primary="" accent="" radius="" />);

    expect(screen.getByText("Primary surface")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("applies styles only to the bounded preview card", () => {
    global.fetch = vi.fn();

    const { container } = render(
      <BrandingPreview primary="#0ea5e9" accent="#f43f5e" radius="0.75rem" />
    );

    const card =
      screen.getByText("Preview").closest('[class*="max-w-xl"]') ??
      container.querySelector('[class*="max-w-xl"]');
    expect(card).toBeTruthy();

    // Inline styles live only inside the preview card, never on the document.
    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(document.body.getAttribute("style")).toBeNull();

    const surfaces = within(card as HTMLElement).getAllByText(/Primary surface|Accent surface/);
    expect(surfaces.length).toBe(2);
    for (const surface of surfaces) {
      expect(surface.getAttribute("style")).toContain("background-color");
    }
  });

  it("uses the tenant fallback radius when only primary/accent are local", () => {
    global.fetch = vi.fn();

    const { container } = render(<BrandingPreview primary="#0ea5e9" accent="#f43f5e" radius="" />);

    const card = container.querySelector('[class*="max-w-xl"]');
    expect(card).toBeTruthy();
    expect(card?.getAttribute("style")).toBeTruthy();
  });
});
