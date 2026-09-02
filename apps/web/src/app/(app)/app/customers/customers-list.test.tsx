import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomersList } from "./customers-list";

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("CustomersList", () => {
  it("renders a permission-denied UX message when the API returns 403", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "Access denied" },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    render(
      <TestWrapper>
        <CustomersList />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to manage customers.")
      ).toBeInTheDocument();
    });
  });

  it("renders an unauthenticated UX message when the API returns 401", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "Authentication required" },
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      )
    );

    render(
      <TestWrapper>
        <CustomersList />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("You must be signed in to view customers.")).toBeInTheDocument();
    });
  });
});
