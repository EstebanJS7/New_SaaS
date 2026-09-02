import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NavSidebar } from "./nav-sidebar";

describe("NavSidebar", () => {
  it("renders the Customers link plus labeled placeholder entries", () => {
    render(<NavSidebar />);

    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const entries = within(sidebar).getAllByTestId("nav-entry");
    expect(entries).toHaveLength(4);

    const link = entries[0];
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/app/customers");
    expect(link.textContent).toBe("Customers");

    for (const entry of entries.slice(1)) {
      expect(entry.tagName).toBe("BUTTON");
      expect((entry as HTMLButtonElement).type).toBe("button");
      expect(entry.textContent).toMatch(/^Section [a-z]+$/i);
    }
  });

  it("ships only the Customers business destination with placeholder sections", () => {
    const { container } = render(<NavSidebar />);

    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/app/customers");
    expect(container.textContent).not.toMatch(/appointment|patient|invoice|schedule|billing/i);
  });
});
