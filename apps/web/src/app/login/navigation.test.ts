import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateAfterSignIn } from "./navigation";

afterEach(() => vi.unstubAllGlobals());
describe("authenticated document navigation", () => {
  it.each([undefined, "https://evil.test", "/api/auth/logout"])(
    "falls back safely for %s",
    (target) => {
      const assign = vi.fn();
      vi.stubGlobal("window", { location: { assign } });
      navigateAfterSignIn(target);
      expect(assign).toHaveBeenCalledExactlyOnceWith("/app");
    }
  );
  it("loads a new authenticated document at the saved resource", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    const target = "/app/sales/11111111-1111-4111-8111-111111111111";
    navigateAfterSignIn(target);
    expect(assign).toHaveBeenCalledExactlyOnceWith(target);
  });
});
