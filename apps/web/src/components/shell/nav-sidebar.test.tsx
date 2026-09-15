import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NavSidebar } from "./nav-sidebar";

describe("NavSidebar", () => {
  it("renders the Customers, Patients and Agenda links plus labeled placeholder entries", () => {
    render(<NavSidebar />);

    const sidebar = screen.getByTestId("nav-sidebar");
    expect(within(sidebar).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const entries = within(sidebar).getAllByTestId("nav-entry");
    expect(entries).toHaveLength(6);

    const [customers, patients, agenda] = entries;
    expect(customers.tagName).toBe("A");
    expect(customers.getAttribute("href")).toBe("/app/customers");
    expect(customers.textContent).toBe("Customers");

    expect(patients.tagName).toBe("A");
    expect(patients.getAttribute("href")).toBe("/app/patients");
    expect(patients.textContent).toBe("Patients");

    expect(agenda.tagName).toBe("A");
    expect(agenda.getAttribute("href")).toBe("/app/agenda");
    expect(agenda.textContent).toBe("Agenda");

    for (const entry of entries.slice(3)) {
      expect(entry.tagName).toBe("BUTTON");
      expect((entry as HTMLButtonElement).type).toBe("button");
      expect(entry.textContent).toMatch(/^Section [a-z]+$/i);
    }
  });

  it("ships only the Customers, Patients and Agenda business destinations with placeholder sections", () => {
    const { container } = render(<NavSidebar />);

    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app/customers",
      "/app/patients",
      "/app/agenda",
    ]);
    expect(container.textContent).not.toMatch(/appointment|invoice|schedule|billing/i);
  });
});
