import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClinicalAssociations } from "./clinical-associations";

const P = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const S = "44444444-4444-4444-8444-444444444444";
function setup(
  options: { denied?: boolean; conflict?: boolean; sales?: boolean; hidden?: boolean } = {}
) {
  let appointmentId: string | null = null;
  let linkedSale = false;
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (options.denied)
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Denied" } }), {
          status: 403,
        })
      );
    if (init?.method === "POST") {
      if (options.conflict)
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Other origin" } }), {
            status: 409,
          })
        );
      if (url.endsWith("/appointment")) appointmentId = A;
      else linkedSale = true;
      return Promise.resolve(new Response(JSON.stringify({ linked: true })));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          appointmentId,
          sales: linkedSale ? [{ id: S, status: "DRAFT" }] : [],
          canReadAppointments: !options.hidden,
          canReadSales: !options.hidden,
        })
      )
    );
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ClinicalAssociations
        patientId={P}
        encounterId={E}
        appointmentId={A}
        currentSaleId={options.sales ? S : undefined}
        inPOS={options.sales}
      />
    </QueryClientProvider>
  );
  return fetch;
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("ClinicalAssociations", () => {
  it("cancels appointment linking without issuing commands", async () => {
    const fetch = setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Vincular esta consulta a la cita de origen" })
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Volver" }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("persists an appointment only after explicit confirmation and reads it back", async () => {
    const fetch = setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Vincular esta consulta a la cita de origen" })
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar vínculo" })
    );
    expect(await screen.findByText(/Cita vinculada #33333333/)).toBeInTheDocument();
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]?.[1]?.body as string)).toEqual({ appointmentId: A });
  });
  it("links the existing sale without creating or completing another sale", async () => {
    const fetch = setup({ sales: true });
    fireEvent.click(
      await screen.findByRole("button", { name: "Vincular esta venta a la consulta" })
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar vínculo" })
    );
    expect(await screen.findByRole("link", { name: /Abrir venta/ })).toHaveAttribute(
      "href",
      `/app/sales/${S}`
    );
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(`/api/clinical/${P}/encounters/${E}/links/sale`);
  });
  it("a conflicting origin preserves the review and never claims success", async () => {
    setup({ conflict: true });
    fireEvent.click(
      await screen.findByRole("button", { name: "Vincular esta consulta a la cita de origen" })
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar vínculo" })
    );
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "No pudimos vincular"
    );
    expect(screen.queryByText("Vínculo confirmado por el servidor.")).not.toBeInTheDocument();
  });
  it("unreadable domains do not masquerade as empty associations", async () => {
    setup({ hidden: true });
    expect(
      await screen.findByText("No tenés acceso a los vínculos de agenda.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Sin cita vinculada")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("denied association reads expose no mutation controls", async () => {
    setup({ denied: true });
    await waitFor(() =>
      expect(screen.getByText(/No pudimos consultar los vínculos/)).toBeInTheDocument()
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
