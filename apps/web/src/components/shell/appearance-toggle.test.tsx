import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { APPEARANCE_STORAGE_KEY, DARK_CLASS } from "@/lib/appearance";
import AppShellLayout from "@/app/(app)/layout";
import AppHomePage from "@/app/(app)/app/page";
import { AppearanceToggle } from "./appearance-toggle";

function resetAppearanceState(): void {
  document.documentElement.classList.remove(DARK_CLASS);
  window.localStorage.clear();
  vi.restoreAllMocks();
}

describe("AppearanceToggle", () => {
  afterEach(resetAppearanceState);

  it("flips the dark class on the document root without navigation or reload", () => {
    const hrefBefore = window.location.href;
    render(<AppearanceToggle />);

    const toggle = screen.getByTestId("appearance-toggle");
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("light");

    // Chrome-only control: same document, no navigation happened.
    expect(window.location.href).toBe(hrefBefore);
  });

  it("reapplies a stored dark preference on mount", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");

    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("mounts light with no stored value", () => {
    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("mounts light on corrupted stored values", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "not-a-valid-appearance");

    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("tolerates localStorage write failures while still toggling", () => {
    render(<AppearanceToggle />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => fireEvent.click(screen.getByTestId("appearance-toggle"))).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("re-themes the bounded sample-card region through tokens only", () => {
    render(
      <AppShellLayout>
        <AppHomePage />
      </AppShellLayout>
    );

    const card = screen.getByTestId("sample-card");
    // Sample content inherits semantic tokens; no component-local colors.
    expect(card.className).toContain("bg-card");

    fireEvent.click(screen.getByTestId("appearance-toggle"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);

    // The card element itself never changes — the cascade re-themes it.
    expect(card.className).toContain("text-card-foreground");
    expect(card.getAttribute("style")).toBeNull();

    fireEvent.click(screen.getByTestId("appearance-toggle"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });
});
