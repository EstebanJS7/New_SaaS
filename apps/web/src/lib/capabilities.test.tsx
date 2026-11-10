import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  CapabilitiesProvider,
  canUse,
  hasFeature,
  hasPermission,
  useCan,
  type Capabilities,
} from "./capabilities";

describe("capability checks (UX-037)", () => {
  it("allows everything while capabilities are unknown", () => {
    expect(hasPermission({}, "sales.create")).toBe(true);
    expect(hasFeature({}, "portal")).toBe(true);
    expect(canUse({}, { permission: "sales.create", feature: "sales" })).toBe(true);
  });

  it("allows only granted permissions and features once known", () => {
    const known: Capabilities = { permissions: ["sales.create"], features: ["sales"] };
    expect(hasPermission(known, "sales.create")).toBe(true);
    expect(hasPermission(known, "cash.session.open")).toBe(false);
    expect(hasFeature(known, "sales")).toBe(true);
    expect(hasFeature(known, "portal")).toBe(false);
  });

  it("treats a known empty list as nothing granted", () => {
    expect(hasPermission({ permissions: [] }, "sales.create")).toBe(false);
    expect(hasFeature({ features: [] }, "sales")).toBe(false);
  });

  it("needs every listed permission and the feature together", () => {
    const known: Capabilities = { permissions: ["a", "b"], features: ["f"] };
    expect(canUse(known, { permission: ["a", "b"], feature: "f" })).toBe(true);
    expect(canUse(known, { permission: ["a", "c"], feature: "f" })).toBe(false);
    expect(canUse(known, { permission: "a", feature: "g" })).toBe(false);
    expect(canUse(known, {})).toBe(true);
  });

  it("useCan reads the shell's capabilities", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CapabilitiesProvider value={{ permissions: ["x"], features: [] }}>
        {children}
      </CapabilitiesProvider>
    );
    const { result } = renderHook(
      () => [useCan({ permission: "x" }), useCan({ permission: "y" })],
      {
        wrapper,
      }
    );
    expect(result.current).toEqual([true, false]);
  });
});
