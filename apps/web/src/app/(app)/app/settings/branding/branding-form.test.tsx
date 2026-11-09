import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";
import { BrandingForm } from "./branding-form";

/**
 * The staff branding form (UX-036): every visible string in es-PY, and every
 * failure explained in Spanish — the API's English message never reaches the
 * screen, and a request that never reached the server says so.
 */

const BRAND = resolveBrand(activeProductPreset);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderForm(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BrandingForm />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrandingForm · es-PY copy", () => {
  it("shows the loading state in Spanish", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));
    renderForm();

    expect(screen.getByText("Cargando la configuración de marca...")).toBeInTheDocument();
    expect(screen.getByText("Cargando los recursos de identidad...")).toBeInTheDocument();
  });

  it("labels every control, action and section in Spanish", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ source: "preset", brand: BRAND })));
    renderForm();

    expect(await screen.findByLabelText("Color primario")).toBeInTheDocument();
    expect(screen.getByLabelText("Color de acento")).toBeInTheDocument();
    expect(screen.getByLabelText("Radio de bordes")).toBeInTheDocument();
    expect(screen.getByLabelText("Apariencia predeterminada")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Clara" })).toHaveValue("light");
    expect(screen.getByRole("option", { name: "Oscura" })).toHaveValue("dark");
    expect(screen.getByRole("option", { name: "Según el sistema" })).toHaveValue("system");
    expect(screen.getByLabelText("Color primario")).toHaveAttribute(
      "placeholder",
      "hsl(...) o #rrggbb"
    );

    expect(screen.getByText("Apariencia de la marca")).toBeInTheDocument();
    expect(screen.getByText("Recursos de identidad")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Subí los logos y un favicon. Los archivos deben ser PNG, WebP o ICO. Los logos pueden pesar hasta 2 MB y el favicon, hasta 512 KB."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Logo claro")).toBeInTheDocument();
    expect(screen.getByText("Logo oscuro")).toBeInTheDocument();
    expect(screen.getByText("Favicon")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restablecer valores predeterminados" })
    ).toBeInTheDocument();
  });

  it("confirms a save in Spanish and still sends the same PUT", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({ source: init?.method === "PUT" ? "tenant" : "preset", brand: BRAND })
      )
    );
    global.fetch = fetchMock;
    renderForm();

    fireEvent.click(await screen.findByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Marca guardada.")).toBeInTheDocument();
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
    expect(put?.[0]).toBe("/api/branding/current");
  });
});

describe("BrandingForm · failures in Spanish", () => {
  it.each([
    ["UNAUTHENTICATED", 401, "Iniciá sesión para gestionar la marca."],
    ["FORBIDDEN", 403, "No tenés permiso para gestionar la marca."],
    [
      "FEATURE_NOT_ENTITLED",
      403,
      "La marca personalizada no está habilitada para esta organización.",
    ],
  ])("explains %s without the API's English message", async (code, status, sentence) => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code, message: "Access denied (English)." } }, status)
      )
    );
    renderForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent("English");
  });

  it("explains a rejected value without echoing the API's English message", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PUT"
          ? jsonResponse(
              { error: { code: "BRAND_OVERRIDE_INVALID_VALUE", message: "primary is invalid." } },
              400
            )
          : jsonResponse({ source: "preset", brand: BRAND })
      )
    );
    global.fetch = fetchMock;
    renderForm();

    fireEvent.click(await screen.findByRole("button", { name: "Guardar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Revisá los valores de la marca: alguno no tiene un formato válido."
    );
    expect(alert).not.toHaveTextContent("primary is invalid.");
  });

  it("uses the shared connection sentence when the request never reaches the server", async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    renderForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar."
    );
    expect(alert).not.toHaveTextContent("Failed to fetch");
  });

  it("falls back to a Spanish sentence for an unexpected failure", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "INTERNAL", message: "Boom." } }, 500))
    );
    renderForm();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No pudimos completar la operación de marca. Volvé a intentar."
      )
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Boom.");
  });
});
