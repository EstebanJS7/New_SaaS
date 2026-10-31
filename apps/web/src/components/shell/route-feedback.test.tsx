import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const route = vi.hoisted(() => ({ pathname: "/app", search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => route.search,
}));
import { RouteFeedback } from "./route-feedback";

const clients: QueryClient[] = [];
afterEach(() => {
  route.pathname = "/app";
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <a href="/app/customers" onClick={(event) => event.preventDefault()}>
        Open customers
      </a>
      <RouteFeedback />
    </QueryClientProvider>
  );
}
describe("workspace activity feedback", () => {
  it("starts for same-window navigation and clears after the route commits", () => {
    const client = new QueryClient();
    clients.push(client);
    const { rerender } = render(tree(client));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open customers" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    route.pathname = "/app/customers";
    rerender(tree(client));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("does not show a loading state for opening a new tab", () => {
    const client = new QueryClient();
    clients.push(client);
    render(tree(client));
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("does not distract users for background refreshes of already visible data", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    client.setQueryData(["background"], { count: 1 });
    render(tree(client));
    await act(async () => {
      void client
        .fetchQuery({
          queryKey: ["background"],
          queryFn: () => new Promise<never>(() => undefined),
        })
        .catch(() => undefined);
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
