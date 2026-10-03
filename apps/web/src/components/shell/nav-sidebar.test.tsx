import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NavSidebar, visibleNavLinks, NAV_LINKS } from "./nav-sidebar";

describe("NavSidebar", () => {
  it("renders the Customers, Patients, Catalog, Suppliers, Purchases, POS, Cash, Billing, Fiscal and Agenda links plus labeled placeholder entries", () => {
    render(<NavSidebar />);

    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const entries = within(sidebar).getAllByTestId("nav-entry");
    expect(entries).toHaveLength(13);

    const [customers, patients, catalog, suppliers, purchases, pos, cash, billing, fiscal, agenda] =
      entries;
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

    expect(cash.tagName).toBe("A");
    expect(cash.getAttribute("href")).toBe("/app/cash");
    expect(cash.textContent).toBe("Cash");

    expect(billing.tagName).toBe("A");
    expect(billing.getAttribute("href")).toBe("/app/billing");
    expect(billing.textContent).toBe("Billing");

    expect(fiscal.tagName).toBe("A");
    expect(fiscal.getAttribute("href")).toBe("/app/fiscal");
    expect(fiscal.textContent).toBe("Fiscal");

    expect(agenda.tagName).toBe("A");
    expect(agenda.getAttribute("href")).toBe("/app/agenda");
    expect(agenda.textContent).toBe("Agenda");

    for (const entry of entries.slice(10)) {
      expect(entry.tagName).toBe("BUTTON");
      expect((entry as HTMLButtonElement).type).toBe("button");
      expect(entry.textContent).toMatch(/^Section [a-z]+$/i);
    }
  });

  it("ships only the real business destinations with placeholder sections", () => {
    const { container } = render(<NavSidebar />);

    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(10);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app/customers",
      "/app/patients",
      "/app/catalog",
      "/app/suppliers",
      "/app/purchases",
      "/app/sales",
      "/app/cash",
      "/app/billing",
      "/app/fiscal",
      "/app/agenda",
    ]);
    // Billing is a real destination now; the placeholders stay chrome-only and
    // no appointment, invoice or schedule surface exists behind this chrome.
    expect(container.textContent).toContain("Billing");
    expect(container.textContent).not.toMatch(/appointment|invoice|schedule/i);
  });

  it("shows every entry when the entitled capability set is unknown", () => {
    render(<NavSidebar />);

    expect(screen.getByRole("link", { name: "POS" })).toHaveAttribute("href", "/app/sales");
    expect(screen.getByRole("link", { name: "Cash" })).toHaveAttribute("href", "/app/cash");
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/app/billing");
    expect(screen.getByRole("link", { name: "Fiscal" })).toHaveAttribute("href", "/app/fiscal");
  });

  it("hides the gated POS, Cash and Billing entries when the tenant is known to lack every capability", () => {
    render(<NavSidebar entitlements={[]} />);

    expect(screen.queryByRole("link", { name: "POS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cash" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fiscal" })).not.toBeInTheDocument();
    // The ungated destinations are untouched by the gate.
    expect(screen.getByRole("link", { name: "Purchases" })).toHaveAttribute(
      "href",
      "/app/purchases"
    );
    expect(screen.getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/app/catalog");
  });

  it("shows the Cash entry when the tenant is known to hold the cash capability", () => {
    render(<NavSidebar entitlements={["cash"]} />);

    expect(screen.getByRole("link", { name: "Cash" })).toHaveAttribute("href", "/app/cash");
    // The POS and Billing gates are independent: holding `cash` reveals neither.
    expect(screen.queryByRole("link", { name: "POS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
  });

  it("shows the POS entry when the tenant is known to hold the sales capability", () => {
    render(<NavSidebar entitlements={["sales", "cash"]} />);

    expect(screen.getByRole("link", { name: "POS" })).toHaveAttribute("href", "/app/sales");
    expect(screen.getByRole("link", { name: "Cash" })).toHaveAttribute("href", "/app/cash");
    // The Billing gate is independent of the sales and cash capabilities.
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
  });

  it("shows the Billing entry when the tenant is known to hold the billing capability", () => {
    render(<NavSidebar entitlements={["billing"]} />);

    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/app/billing");
    // The POS and Cash gates are independent: holding `billing` reveals neither.
    expect(screen.queryByRole("link", { name: "POS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cash" })).not.toBeInTheDocument();
  });

  it("shows the Fiscal entry when the tenant is known to hold the fiscal capability", () => {
    render(<NavSidebar entitlements={["fiscal"]} />);

    expect(screen.getByRole("link", { name: "Fiscal" })).toHaveAttribute("href", "/app/fiscal");
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
  });

  it("gates only entries that declare a capability requirement", () => {
    const gated = visibleNavLinks(NAV_LINKS, ["veterinary"]);
    const hrefs = gated.map((link) => link.href);

    expect(hrefs).not.toContain("/app/sales");
    expect(hrefs).not.toContain("/app/cash");
    expect(hrefs).not.toContain("/app/billing");
    expect(hrefs).not.toContain("/app/fiscal");
    expect(hrefs).toContain("/app/purchases");
  });
});
