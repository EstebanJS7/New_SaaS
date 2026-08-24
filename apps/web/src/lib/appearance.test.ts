import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_STORAGE_KEY, DARK_CLASS, appearanceBootstrapScript } from "./appearance";

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
