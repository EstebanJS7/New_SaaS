import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NavSidebar } from "./nav-sidebar";

describe("NavSidebar", () => {
  it("renders labeled placeholder entries inside a primary navigation", () => {
    render(<NavSidebar />);

    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const entries = within(sidebar).getAllByTestId("nav-entry");
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.tagName).toBe("BUTTON");
      expect((entry as HTMLButtonElement).type).toBe("button");
      expect(entry.textContent).toMatch(/^Section [a-z]+$/i);
    }
  });

  it("ships no links or business-domain destinations (chrome-only gate)", () => {
    const { container } = render(<NavSidebar />);

    expect(container.querySelectorAll("a")).toHaveLength(0);
    // Placeholder labels only — no scheduling/records/billing vocabulary.
    expect(container.textContent).not.toMatch(/appointment|patient|invoice|schedule|billing/i);
  });
});
