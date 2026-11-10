import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FiscalSecretsSection } from "./fiscal-secrets-section";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const renderSection = (kind: "csc" | "signing-material") =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FiscalSecretsSection kind={kind} />
    </QueryClientProvider>
  );
afterEach(() => vi.restoreAllMocks());
describe("taxpayer secret forms", () => {
  it("clears the CSC immediately while its request is pending, including on failure", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const fetcher = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Promise<Response>((_resolve, fail) => {
            reject = fail;
          })
        : Promise.resolve(json({ items: [] }))
    );
    global.fetch = fetcher;
    renderSection("csc");
    const input = await screen.findByLabelText("Valor del CSC");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByLabelText("Identificador CSC"), { target: { value: "0001" } });
    fireEvent.change(input, { target: { value: "Aa12".repeat(8) } });
    fireEvent.submit(screen.getByRole("form", { name: "Cargar CSC" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("");
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ environment: "TEST", idCsc: "0001", value: "Aa12".repeat(8) })
    );
    reject?.(new Error("network"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(input).toHaveValue("");
  });
  it("submits four printable ASCII CSC identifier characters, including punctuation, unchanged", async () => {
    const fetcher = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(json(init?.method === "POST" ? { id: "loaded" } : { items: [] }))
    );
    global.fetch = fetcher;
    renderSection("csc");
    const identifier = await screen.findByLabelText("Identificador CSC");
    const value = screen.getByLabelText("Valor del CSC");
    fireEvent.change(identifier, { target: { value: "!~A1" } });
    fireEvent.change(value, { target: { value: "Aa12".repeat(8) } });
    fireEvent.submit(screen.getByRole("form", { name: "Cargar CSC" }));
    expect(await screen.findByText("Se guardó el CSC.")).toBeInTheDocument();
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[1]?.body).toBe(
      JSON.stringify({ environment: "TEST", idCsc: "!~A1", value: "Aa12".repeat(8) })
    );
    expect(identifier).toHaveValue("");
    expect(value).toHaveValue("");
  });
  it.each(["001", "00001", "00 1", "00é1", "00\u007f1"])(
    "rejects CSC identifier %j outside the API's four printable ASCII characters without a write",
    async (idCsc) => {
      const fetcher = vi.fn(() => Promise.resolve(json({ items: [] })));
      global.fetch = fetcher;
      renderSection("csc");
      fireEvent.change(await screen.findByLabelText("Identificador CSC"), {
        target: { value: idCsc },
      });
      const value = screen.getByLabelText("Valor del CSC");
      fireEvent.change(value, { target: { value: "Aa12".repeat(8) } });
      fireEvent.submit(screen.getByRole("form", { name: "Cargar CSC" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Ingresá el identificador de 4 caracteres y el CSC de 32 caracteres alfanuméricos."
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(value).toHaveValue("");
    }
  );
  it("submits certificate multipart and clears password/file before awaiting the response", async () => {
    let resolve: ((response: Response) => void) | undefined;
    const fetcher = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : Promise.resolve(json({ items: [] }))
    );
    global.fetch = fetcher;
    renderSection("signing-material");
    const password = await screen.findByLabelText("Contraseña del certificado");
    fireEvent.change(password, { target: { value: "private-password" } });
    fireEvent.change(screen.getByLabelText("Archivo PKCS#12"), {
      target: { files: [new File(["certificate"], "test.p12")] },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Subir certificado" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(password).toHaveValue("");
    const body = fetcher.mock.calls[1]?.[1]?.body as FormData;
    expect(body.get("password")).toBe("private-password");
    expect(body.get("environment")).toBe("TEST");
    resolve?.(json({ id: "loaded" }, 201));
    expect(await screen.findByText("Se guardó el certificado de firma.")).toBeInTheDocument();
  });
  it.each(["csc", "signing-material"] as const)(
    "shows a permission state without inputs for %s",
    async (kind) => {
      global.fetch = vi.fn(() => Promise.resolve(json({ error: { code: "FORBIDDEN" } }, 403)));
      renderSection(kind);
      expect(
        await screen.findByText("No tenés permiso para gestionar este material fiscal.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("form")).toBeNull();
    }
  );
  it("lists metadata and retires with a reason and explicit confirmation", async () => {
    let retired = false;
    global.fetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        retired = true;
        return Promise.resolve(json({}));
      }
      return Promise.resolve(
        json({
          items: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              idCsc: "0001",
              environment: "TEST",
              status: retired ? "RETIRED" : "ACTIVE",
              createdAt: "2026-11-09",
              retiredAt: null,
            },
          ],
        })
      );
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
    renderSection("csc");
    fireEvent.click(await screen.findByRole("button", { name: "Retirar" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Retirar material" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "rotation" } });
    fireEvent.click(confirm);
    expect(await screen.findByText("Se retiró el material fiscal.")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/csc/11111111-1111-4111-8111-111111111111/retire"),
      expect.objectContaining({ body: '{"reason":"rotation"}' })
    );
  });
});
