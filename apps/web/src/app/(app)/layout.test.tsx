import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AppHomePage from "./app/page";
import AppPlaceholderPage from "./app/placeholder/page";
import AppShellLayout from "./layout";

/** The bounded content region is contracted by its `data-shell-content` attribute. */
function getContentRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>("main[data-shell-content]");
  if (!region) {
    throw new Error("shell content region <main data-shell-content> was not rendered");
  }
  return region;
}

describe("AppShellLayout", () => {
  it("wraps a direct visit to the shell home with sidebar and topbar", () => {
    render(
      <AppShellLayout>
        <AppHomePage />
      </AppShellLayout>
    );

    expect(screen.getByTestId("nav-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();

    const region = getContentRegion();
    expect(region.tagName).toBe("MAIN");
    expect(within(region).getByTestId("sample-card")).toBeInTheDocument();
    expect(within(region).getByText("Staff workspace")).toBeInTheDocument();
  });

  it("keeps the shell around content of a deep-linked sub-route", () => {
    render(
      <AppShellLayout>
        <AppPlaceholderPage />
      </AppShellLayout>
    );

    // Same chrome as the direct visit: the group layout surrounds any child.
    expect(screen.getByTestId("nav-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    const region = getContentRegion();
    expect(region.tagName).toBe("MAIN");
    expect(within(region).getByTestId("placeholder-content")).toBeInTheDocument();
  });

  it("hosts the sample card in the bounded region consuming tokens only", () => {
    render(
      <AppShellLayout>
        <AppHomePage />
      </AppShellLayout>
    );

    const card = screen.getByTestId("sample-card");
    // Semantic-token classes from the shared Card primitive (no literals).
    expect(card.className).toContain("bg-card");
    expect(card.className).toContain("text-card-foreground");

    // Chrome carries token classes too and never inline color styles.
    const sidebar = screen.getByTestId("nav-sidebar");
    expect(sidebar.className).toContain("bg-card");
    for (const node of [sidebar, screen.getByTestId("topbar"), card]) {
      expect(node.getAttribute("style")).toBeNull();
    }
  });
});
