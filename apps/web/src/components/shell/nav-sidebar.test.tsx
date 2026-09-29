import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NavSidebar, visibleNavLinks, NAV_LINKS } from "./nav-sidebar";

describe("NavSidebar", () => {
  it("renders the Customers, Patients, Catalog, Suppliers, Purchases, POS and Agenda links plus labeled placeholder entries", () => {
    render(<NavSidebar />);

    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const entries = within(sidebar).getAllByTestId("nav-entry");
    expect(entries).toHaveLength(10);

    const [customers, patients, catalog, suppliers, purchases, pos, agenda] = entries;
    expect(customers.tagName).toBe("A");
    expect(customers.getAttribute("href")).toBe("/app/customers");
    expect(customers.textContent).toBe("Customers");

    expect(patients.tagName).toBe("A");
    expect(patients.getAttribute("href")).toBe("/app/patients");
    expect(patients.textContent).toBe("Patients");

    expect(catalog.tagName).toBe("A");
    expect(catalog.getAttribute("href")).toBe("/app/catalog");
    expect(catalog.textContent).toBe("Catalog");

    expect(suppliers.tagName).toBe("A");
    expect(suppliers.getAttribute("href")).toBe("/app/suppliers");
    expect(suppliers.textContent).toBe("Suppliers");

    expect(purchases.tagName).toBe("A");
    expect(purchases.getAttribute("href")).toBe("/app/purchases");
    expect(purchases.textContent).toBe("Purchases");

    expect(pos.tagName).toBe("A");
    expect(pos.getAttribute("href")).toBe("/app/sales");
    expect(pos.textContent).toBe("POS");

    expect(agenda.tagName).toBe("A");
    expect(agenda.getAttribute("href")).toBe("/app/agenda");
    expect(agenda.textContent).toBe("Agenda");

    for (const entry of entries.slice(7)) {
      expect(entry.tagName).toBe("BUTTON");
      expect((entry as HTMLButtonElement).type).toBe("button");
      expect(entry.textContent).toMatch(/^Section [a-z]+$/i);
    }
  });

  it("ships only the real business destinations with placeholder sections", () => {
    const { container } = render(<NavSidebar />);

    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app/customers",
      "/app/patients",
      "/app/catalog",
      "/app/suppliers",
      "/app/purchases",
      "/app/sales",
      "/app/agenda",
    ]);
    expect(container.textContent).not.toMatch(/appointment|invoice|schedule|billing/i);
  });

  it("shows every entry when the entitled capability set is unknown", () => {
    render(<NavSidebar />);

    expect(screen.getByRole("link", { name: "POS" })).toHaveAttribute("href", "/app/sales");
  });

  it("hides the POS entry when the tenant is known to lack the sales capability", () => {
    render(<NavSidebar entitlements={[]} />);

    expect(screen.queryByRole("link", { name: "POS" })).not.toBeInTheDocument();
    // The ungated destinations are untouched by the gate.
    expect(screen.getByRole("link", { name: "Purchases" })).toHaveAttribute(
      "href",
      "/app/purchases"
    );
    expect(screen.getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/app/catalog");
  });

  it("shows the POS entry when the tenant is known to hold the sales capability", () => {
    render(<NavSidebar entitlements={["sales", "cash"]} />);

    expect(screen.getByRole("link", { name: "POS" })).toHaveAttribute("href", "/app/sales");
  });

  it("gates only entries that declare a capability requirement", () => {
    const gated = visibleNavLinks(NAV_LINKS, ["veterinary"]);
    const hrefs = gated.map((link) => link.href);

    expect(hrefs).not.toContain("/app/sales");
    expect(hrefs).toContain("/app/purchases");
  });
});
