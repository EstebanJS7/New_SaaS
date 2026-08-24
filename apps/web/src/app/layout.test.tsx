import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { appearanceBootstrapScript } from "@/lib/appearance";
import RootLayout from "./layout";

describe("RootLayout appearance bootstrap", () => {
  it("ships the pre-paint bootstrap script as the first body child (D6)", () => {
    const { container } = render(
      <RootLayout>
        <span data-testid="child" />
      </RootLayout>
    );

    // React 19 renders <html>/<body> transparently into the test container,
    // so container children mirror what SSR ships inside <body>.
    const firstChild = container.firstElementChild;
    expect(firstChild?.tagName).toBe("SCRIPT");
    // Same source contract lib/appearance.ts owns — no drift between module and markup.
    expect(firstChild?.textContent).toBe(appearanceBootstrapScript);

    // Brand bridge follows the script; precedence comes from :root:not(.dark), not order.
    const children = Array.from(container.children);
    const styleIndex = children.findIndex((node) => node.tagName === "STYLE");
    expect(styleIndex).toBeGreaterThan(0);
    expect(children[styleIndex]?.textContent).toContain(":root:not(.dark)");
  });
});
