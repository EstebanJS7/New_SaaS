import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { APPEARANCE_STORAGE_KEY, DARK_CLASS } from "@/lib/appearance";
import AppShellLayout from "@/app/(app)/layout";
import AppHomePage from "@/app/(app)/app/page";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";
import { AppearanceToggle } from "./appearance-toggle";

/* eslint-disable @typescript-eslint/unbound-method -- tests reference MediaQueryList mock methods as plain call records. */
function resetAppearanceState(): void {
  document.documentElement.classList.remove(DARK_CLASS);
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

function createMatchMedia(matchesDark: boolean): MediaQueryList {
  return {
    matches: matchesDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  } as unknown as MediaQueryList;
}

describe("AppearanceToggle", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ source: "preset", brand: resolveBrand(activeProductPreset) }),
    });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(createMatchMedia(false)));
  });

  afterEach(resetAppearanceState);

  it("defers (system) with no stored value, then cycles system -> light -> dark -> system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(createMatchMedia(false)));
    render(<AppearanceToggle />);

    const toggle = screen.getByTestId("appearance-toggle");
    // No stored preference: defer to tenant/OS instead of forcing light.
    expect(toggle.textContent).toBe("System");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Light");
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("light");

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Dark");
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("System");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("system");
  });

  it("reapplies a stored dark preference on mount", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");

    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("defers to OS light with no stored value", () => {
    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("defers to OS light on corrupted stored values", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "not-a-valid-appearance");

    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("tolerates localStorage write failures while still toggling", () => {
    render(<AppearanceToggle />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const toggle = screen.getByTestId("appearance-toggle");
    // system -> light -> dark: second click reaches explicit dark.
    expect(() => fireEvent.click(toggle)).not.toThrow();
    expect(() => fireEvent.click(toggle)).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("uses tenant dark default in system mode and does not attach an OS listener", () => {
    const media = createMatchMedia(false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));

    render(<AppearanceToggle defaultAppearance="dark" />);

    // No stored preference: system mode with a tenant dark default renders dark.
    expect(screen.getByTestId("appearance-toggle").textContent).toBe("System");
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(media.addEventListener).not.toHaveBeenCalled();
  });

  it("attaches a matchMedia listener in system mode only when no tenant default fixes appearance", () => {
    const media = createMatchMedia(true);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));

    const { unmount } = render(<AppearanceToggle />);

    // No stored preference resolves to system mode with no tenant default.
    expect(screen.getByTestId("appearance-toggle").textContent).toBe("System");
    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    expect(media.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    unmount();
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("reacts to OS appearance changes while in system mode", () => {
    let currentMatches = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      get matches() {
        return currentMatches;
      },
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn((_type, handler) => {
        listeners.add(handler as (event: MediaQueryListEvent) => void);
      }),
      removeEventListener: vi.fn((_, handler) => {
        listeners.delete(handler as (event: MediaQueryListEvent) => void);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    } as unknown as MediaQueryList;

    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));

    render(<AppearanceToggle />);

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);

    currentMatches = true;
    for (const handler of listeners) {
      handler({ matches: true } as MediaQueryListEvent);
    }
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("re-themes the bounded sample-card region through tokens only", async () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "light");
    const element = await AppShellLayout({ children: <AppHomePage /> });
    render(element);

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
