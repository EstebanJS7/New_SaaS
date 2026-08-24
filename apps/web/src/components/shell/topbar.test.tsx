import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { activeProductPreset } from "@newsaas/ui/branding";
import { Topbar } from "./topbar";

describe("Topbar", () => {
  it("renders the product identity handed down by the server-resolved layout", () => {
    render(<Topbar productName={activeProductPreset.productName} />);

    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-product-name").textContent).toBe(
      activeProductPreset.productName
    );
  });

  it("stays inert placeholder chrome: no links, token-only classes", () => {
    const { container } = render(<Topbar productName="Clinical Precision" />);

    // Inert placeholder entry — chrome-only gate.
    expect(screen.getByTestId("topbar-entry").tagName).toBe("BUTTON");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/appointment|patient|invoice|schedule|billing/i);
  });
});
