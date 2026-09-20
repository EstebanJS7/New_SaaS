import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalNav } from "./portal-nav";

describe("PortalNav", () => {
  it("renders only the destinations that exist after this slice, preserving the slug", () => {
    const { container } = render(<PortalNav slug="acme-clinic" />);

    expect(screen.getByTestId("portal-nav")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Portal" })).toBeInTheDocument();

    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/acme-clinic",
      "/acme-clinic/pets",
      "/acme-clinic/appointments",
    ]);
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Pets", "Appointments"]);
  });

  it("keeps every entry a labelled link with a test id and no staff destinations", () => {
    render(<PortalNav slug="acme-clinic" />);

    const entries = screen.getAllByTestId("portal-nav-entry");
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.tagName).toBe("A");
    }
    // No staff route group, and no destination that would 404 on this surface.
    // `/appointments` is a real portal destination and must not trip the staff
    // `/app` route-group check, so the segment is anchored rather than bare.
    expect(entries.map((entry) => entry.getAttribute("href")).join(" ")).not.toMatch(
      /\/app(?:\/|$)|profile|booking/i
    );
  });

  it("preserves a slug that needs encoding", () => {
    render(<PortalNav slug="acme clinic" />);

    const [home, pets, appointments] = screen.getAllByTestId("portal-nav-entry");
    expect(home.getAttribute("href")).toBe("/acme%20clinic");
    expect(pets.getAttribute("href")).toBe("/acme%20clinic/pets");
    expect(appointments.getAttribute("href")).toBe("/acme%20clinic/appointments");
  });
});
