import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { HealthIndicator } from "./health-indicator";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const server = setupServer();

describe("HealthIndicator", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    queryClient.clear();
  });
  afterAll(() => server.close());

  it("renders available when the API is healthy via the dev proxy path", async () => {
    server.use(
      http.get("/api/health/live", () =>
        HttpResponse.json({
          status: "healthy",
          service: "api",
          timestamp: new Date().toISOString(),
        })
      )
    );

    render(<HealthIndicator />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("health-indicator")).toHaveAttribute("data-status", "available");
    });
    expect(screen.getByText("API available")).toBeInTheDocument();
  });

  it("renders unavailable when the API is down via the dev proxy path", async () => {
    server.use(http.get("/api/health/live", () => new HttpResponse(null, { status: 503 })));

    render(<HealthIndicator />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("health-indicator")).toHaveAttribute("data-status", "unavailable");
    });
    expect(screen.getByText("API unavailable")).toBeInTheDocument();
  });
});
