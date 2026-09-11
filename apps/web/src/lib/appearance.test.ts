import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  DARK_CLASS,
  SYSTEM_VALUE,
  appearanceBootstrapScript,
  appearanceBootstrapScriptWithTenantDefault,
} from "./appearance";

it("pins the D6 storage-key contract literally", () => {
  expect(APPEARANCE_STORAGE_KEY).toBe("newsaas.appearance");
});

/**
 * Executes the shipped bootstrap source against the live jsdom document —
 * exactly what the parser does when it reaches the first body child.
 */
function runBootstrap(): void {
  // Intentional raw-JS evaluation of the exact string the layout ships.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- test harness executes shipped source
  new Function(appearanceBootstrapScript)();
}

describe("appearance bootstrap script", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Tests share one jsdom document: clear state the script itself mutates.
    document.documentElement.classList.remove(DARK_CLASS);
    window.localStorage.clear();
  });

  it("applies the dark class before paint when a dark preference is stored", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");

    runBootstrap();

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("mounts light with no stored value", () => {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);

    runBootstrap();

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("falls back to light on corrupted stored values", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{corrupted json!");

    runBootstrap();

    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("falls back to light silently when storage access throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    expect(() => runBootstrap()).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });
});

describe("appearanceBootstrapScriptWithTenantDefault", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove(DARK_CLASS);
    window.localStorage.clear();
  });

  function run(script: string): void {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    new Function(script)();
  }

  it("pins the system literal exported for the toggle", () => {
    expect(SYSTEM_VALUE).toBe("system");
  });

  it("honors a stored light preference over tenant dark default", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "light");
    run(appearanceBootstrapScriptWithTenantDefault("dark"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("honors a stored dark preference over tenant light default", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
    run(appearanceBootstrapScriptWithTenantDefault("light"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("falls back to tenant dark default when local is system", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "system");
    run(appearanceBootstrapScriptWithTenantDefault("dark"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("falls back to tenant light default when local is system", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "system");
    run(appearanceBootstrapScriptWithTenantDefault("light"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("falls back to OS dark when tenant default is system and OS prefers dark", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "system");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((_query: string) => ({
        matches: _query === "(prefers-color-scheme: dark)",
      }))
    );
    run(appearanceBootstrapScriptWithTenantDefault("system"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("falls back to Core light when tenant default is system and OS prefers light", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "system");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
      }))
    );
    run(appearanceBootstrapScriptWithTenantDefault("system"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("falls back to tenant dark on corrupted local storage", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{corrupted json!");
    run(appearanceBootstrapScriptWithTenantDefault("dark"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("defers to OS dark when the tenant default is absent", () => {
    // No stored value and no tenant default: the OS preference must win.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((_query: string) => ({
        matches: _query === "(prefers-color-scheme: dark)",
      }))
    );
    run(appearanceBootstrapScriptWithTenantDefault(undefined));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("defers to Core light when the tenant default is absent and OS prefers light", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({ matches: false }))
    );
    run(appearanceBootstrapScriptWithTenantDefault(undefined));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it("retains the tenant fallback when localStorage is inaccessible", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(() => run(appearanceBootstrapScriptWithTenantDefault("dark"))).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("retains the OS fallback when localStorage is inaccessible", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((_query: string) => ({
        matches: _query === "(prefers-color-scheme: dark)",
      }))
    );
    expect(() => run(appearanceBootstrapScriptWithTenantDefault(undefined))).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("pre-paints dark before any paint-affecting node when OS prefers dark", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "system");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((_query: string) => ({
        matches: _query === "(prefers-color-scheme: dark)",
      }))
    );
    run(appearanceBootstrapScriptWithTenantDefault("system"));
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("tolerates missing matchMedia and falls back to light", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "system");
    vi.stubGlobal("matchMedia", undefined);
    expect(() => run(appearanceBootstrapScriptWithTenantDefault("system"))).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });
});
