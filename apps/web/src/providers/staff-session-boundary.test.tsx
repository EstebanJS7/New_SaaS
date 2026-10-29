import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { StaffSessionBoundary } from "./staff-session-boundary";
import { useStaffResumeTarget } from "./staff-resume-target";
const id = "11111111-1111-4111-8111-111111111111";
function Active({ target }: { target?: string }) {
  useStaffResumeTarget(target);
  return <p>Private record</p>;
}
function setup(path = "/app/agenda", target?: string) {
  window.history.replaceState(null, "", path);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <StaffSessionBoundary>
        <Active target={target} />
      </StaffSessionBoundary>
    </QueryClientProvider>
  );
  return client;
}
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
describe("staff session interruption", () => {
  it("hides private content, focuses the notice and preserves a selected encounter reference", async () => {
    const target = `/app/patients/${id}?encounter=${id}#patient-clinical`;
    const client = setup(`/app/patients/${id}`, target);
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ["clinical"],
          queryFn: () => Promise.reject(Object.assign(new Error("Expired"), { status: 401 })),
        })
        .catch(() => undefined);
    });
    expect(screen.queryByText("Private record")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tu sesión terminó" })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("registros ya guardados");
    const href = screen.getByRole("link", { name: "Volver a ingresar" }).getAttribute("href")!;
    expect(new URL(href, "https://staff.invalid").searchParams.get("returnTo")).toBe(target);
    expect(window.sessionStorage.length).toBe(0);
  });
  it.each([403, 404, 500, undefined])(
    "keeps %s recoverable without pretending the session expired",
    async (status) => {
      const client = setup();
      await act(async () => {
        await client
          .fetchQuery({
            queryKey: ["failed"],
            queryFn: () => Promise.reject(Object.assign(new Error("Request failed"), { status })),
          })
          .catch(() => undefined);
      });
      expect(screen.getByText("Private record")).toBeInTheDocument();
      expect(screen.queryByText("Tu sesión terminó")).not.toBeInTheDocument();
    }
  );
  it("does not intercept Portal 401 errors", async () => {
    const client = setup("/clinic/pets");
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ["portal"],
          queryFn: () => Promise.reject(Object.assign(new Error("Expired"), { status: 401 })),
        })
        .catch(() => undefined);
    });
    expect(screen.getByText("Private record")).toBeInTheDocument();
  });
  it("intercepts a mutation once and returns to the saved sale without replay", async () => {
    window.history.replaceState(null, "", "/app/sales");
    const command = vi.fn(() =>
      Promise.reject(Object.assign(new Error("Expired"), { status: 401 }))
    );
    function POS() {
      useStaffResumeTarget(`/app/sales/${id}`);
      const mutation = useMutation({ mutationFn: command, retry: false });
      return <button onClick={() => mutation.mutate()}>Cobrar</button>;
    }
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StaffSessionBoundary>
          <POS />
        </StaffSessionBoundary>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    const link = await screen.findByRole("link", { name: "Volver a ingresar" });
    expect(
      new URL(link.getAttribute("href")!, "https://staff.invalid").searchParams.get("returnTo")
    ).toBe(`/app/sales/${id}`);
    expect(command).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Los cambios sin guardar no se restaurarán/)).toBeInTheDocument();
  });
});
