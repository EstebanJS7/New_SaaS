import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaxClassificationSection } from "./tax-classification-section";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TaxClassificationSection />
    </QueryClientProvider>
  );
}
afterEach(() => vi.restoreAllMocks());
it("requires an explicit tax treatment and saves it over the public proxy", async () => {
  let saved = false;
  const fetcher = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      saved = true;
      return Promise.resolve(json({}));
    }
    return Promise.resolve(
      json({
        rates: [{ code: "IVA_10", rate: "10" }],
        items: saved
          ? [{ rateCode: "IVA_10", affectation: "GRAVADO_IVA", proportionality: null }]
          : [],
      })
    );
  });
  global.fetch = fetcher;
  mount();
  expect(await screen.findByText(/Sin declarar/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Guardar clasificación" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Alícuota"), { target: { value: "IVA_10" } });
  fireEvent.change(screen.getByLabelText("Tratamiento fiscal"), {
    target: { value: "GRAVADO_IVA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar clasificación" }));
  expect(await screen.findByText("Se guardó la clasificación tributaria.")).toBeInTheDocument();
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/fiscal/tax-classifications/IVA_10",
      expect.objectContaining({
        method: "PUT",
        body: '{"affectation":"GRAVADO_IVA","proportionality":null}',
      })
    )
  );
});
it("shows a local permission state without allowing writes", async () => {
  global.fetch = vi.fn(() => Promise.resolve(json({ error: { code: "FORBIDDEN" } }, 403)));
  mount();
  expect(
    await screen.findByText("No tenés permiso para declarar el tratamiento fiscal.")
  ).toBeInTheDocument();
  expect(screen.queryByRole("form")).toBeNull();
});
