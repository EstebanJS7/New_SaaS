import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorState, ListSkeleton } from "./feedback";
describe("Staff shared feedback", () => {
  it("uses Spanish defaults and retries only on explicit click", () => {
    const retry = vi.fn();
    render(<ErrorState message="Fallo sintético" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar esta información");
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("retains consumer overrides and announces loading", () => {
    render(
      <>
        <ErrorState
          message="Temporal"
          title="Consulta específica"
          retryLabel="Consultar"
          onRetry={() => undefined}
        />
        <ListSkeleton />
      </>
    );
    expect(screen.getByRole("button", { name: "Consultar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando registros…");
  });
});
