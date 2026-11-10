import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import GeneralSettingsPage from "./page";

/**
 * UX-037: the composed route reads the caller's capabilities from the shell, so
 * a section the caller cannot change is not offered. Unknown capabilities keep
 * CFG-001's default: every section is shown and the API refuses.
 */
function renderPage(capabilities?: Capabilities): void {
  global.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ settings: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <QueryClientProvider client={client}>
      <GeneralSettingsPage />
    </QueryClientProvider>
  );
  render(
    capabilities === undefined ? (
      page
    ) : (
      <CapabilitiesProvider value={capabilities}>{page}</CapabilitiesProvider>
    )
  );
}

afterEach(() => vi.restoreAllMocks());

describe("GeneralSettingsPage composed with the shell's capabilities (UX-037)", () => {
  it("offers only the sections the caller's permissions and clinic's features allow", () => {
    renderPage({
      permissions: ["notifications.settings.manage", "sales.settings.manage"],
      features: [],
    });

    expect(screen.getByRole("region", { name: "Notificaciones" })).toBeInTheDocument();
    // Ventas needs the `sales` feature too; Portal and Agenda need their permission.
    expect(screen.queryByRole("region", { name: "Ventas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Portal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Agenda" })).not.toBeInTheDocument();
  });

  it("shows every section when the capabilities are unknown", () => {
    renderPage();

    for (const name of ["Ventas", "Portal", "Notificaciones", "Agenda"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });
});
