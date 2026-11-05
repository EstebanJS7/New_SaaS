import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CashSurface } from "./cash-surface";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const register = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Caja sintética",
  isActive: true,
  createdAt: "2026-09-14T02:30:00Z",
  updatedAt: "2026-09-14T02:30:00Z",
};
const session = {
  id: "11111111-1111-4111-8111-111111111111",
  registerId: register.id,
  openedByMembershipId: "33333333-3333-4333-8333-333333333333",
  status: "OPEN",
  openedAt: register.createdAt,
  closedAt: null,
  openingAmount: "0.00",
  expectedAmount: null,
  countedAmount: null,
  differenceAmount: null,
  createdAt: register.createdAt,
  updatedAt: register.createdAt,
};
const other = { ...session, id: "44444444-4444-4444-8444-444444444444" };
const closed = {
  ...session,
  status: "CLOSED",
  closedAt: "2026-09-14T15:00:00Z",
  expectedAmount: "1500.00",
  countedAmount: "1000.00",
  differenceAmount: "-500.00",
};
const movement = {
  id: "55555555-5555-4555-8555-555555555555",
  registerId: register.id,
  sessionId: session.id,
  type: "INCOME",
  direction: null,
  amount: "1234.50",
  reason: null,
  createdAt: "2026-09-14T15:00:00Z",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mount(command: Handler, read: Handler = () => json([session, other])) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === "POST") return command(url, init);
    if (url.endsWith("/registers")) return json([register]);
    if (url.includes("/sessions") || url.includes("/attempts/")) return read(url, init);
    return json([]);
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <a href="/app">Salir</a>
      <CashSurface />
    </QueryClientProvider>
  );
  return fetcher;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
async function select() {
  const buttons = await screen.findAllByRole("button", { name: "Seleccionar sesión" });
  fireEvent.click(buttons[0]);
}
async function sendMovement() {
  await select();
  fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: "INCOME" } });
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "1.234,50" } });
  click("Registrar movimiento");
  click("Confirmar movimiento");
}
async function sendClose() {
  await select();
  fireEvent.change(screen.getByLabelText("Importe contado"), { target: { value: "1.000,00" } });
  click("Cerrar sesión");
  click("Confirmar cierre");
}
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  push.mockClear();
});

describe("cash unresolved attempts", () => {
  it("freezes movement body/key across failures, blocks other commands and only clears on a valid receipt", async () => {
    let attempts = 0;
    const fetcher = mount(() => {
      if (++attempts === 1) throw new Error("PRIVATE lost response");
      if (attempts === 2)
        return json({ error: { code: "FORBIDDEN", message: "PRIVATE denied" } }, 403);
      return json(movement, 200);
    });
    await sendMovement();
    await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
    click("Volver");
    expect(screen.getByLabelText("Importe")).toBeDisabled();
    expect(screen.getByLabelText("Filtrar por estado")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Seleccionar sesión" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Crear caja" })).toBeDisabled();
    click("Reintentar el mismo movimiento");
    await waitFor(() => expect(attempts).toBe(2));
    expect(
      screen.getByRole("region", { name: "Intento de Caja sin confirmar" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reintentar el mismo movimiento" })).toBeEnabled()
    );
    click("Reintentar el mismo movimiento");
    await screen.findByTestId("movement-created");
    expect(
      screen.queryByRole("region", { name: "Intento de Caja sin confirmar" })
    ).not.toBeInTheDocument();
    const posts = fetcher.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
    expect(posts[2][1]?.body).toBe(posts[0][1]?.body);
    expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
    expect(posts[2][1]?.headers).toEqual(posts[0][1]?.headers);
    expect(screen.getByLabelText("Importe")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar sesión" }));
    await waitFor(() => expect(screen.queryByTestId("movement-created")).not.toBeInTheDocument());
  });

  it.each(["OPEN", "CLOSED"])(
    "reads the confirmed close ID explicitly and handles %s without another POST",
    async (status) => {
      let reads = 0;
      let recover = false;
      const fetcher = mount(
        () => {
          throw new Error("PRIVATE lost close");
        },
        () => {
          reads++;
          return json(recover ? [status === "CLOSED" ? closed : session, other] : [session, other]);
        }
      );
      await sendClose();
      await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
      click("Volver");
      const previousReads = reads;
      recover = true;
      click("Consultar estado de la sesión");
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "Intento de Caja sin confirmar" })
        ).not.toBeInTheDocument()
      );
      expect(reads).toBe(previousReads + 1);
      expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
      if (status === "CLOSED")
        expect(screen.getByTestId("close-outcome")).toHaveTextContent("Sesión cerrada");
      else {
        expect(screen.getByLabelText("Importe contado")).toHaveValue("1.000,00");
        expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
      }
    }
  );

  it.each(["denied", "missing"])(
    "keeps the close attempt blocked when the state read is %s",
    async (result) => {
      let recover = false;
      const fetcher = mount(
        () => {
          throw new Error("PRIVATE lost close");
        },
        () => {
          if (!recover) return json([session, other]);
          return result === "denied"
            ? json({ error: { code: "FORBIDDEN", message: "PRIVATE" } }, 403)
            : json([other]);
        }
      );
      await sendClose();
      await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
      click("Volver");
      recover = true;
      click("Consultar estado de la sesión");
      await screen.findByText(
        "No pudimos verificar la sesión. Conservamos el bloqueo; podés volver a consultar su estado."
      );
      expect(screen.getByLabelText("Importe contado")).toBeDisabled();
      expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
      expect(
        screen.getByRole("region", { name: "Intento de Caja sin confirmar" })
      ).not.toHaveTextContent("PRIVATE");
    }
  );

  it.each(["register", "invalid receipt"])(
    "does not retry or infer an unidentified %s creation",
    async (kind) => {
      const fetcher = mount(() =>
        kind === "invalid receipt"
          ? json({ id: "bad" }, 201)
          : Promise.reject(new Error("PRIVATE lost"))
      );
      void kind;
      fireEvent.change(await screen.findByLabelText("Nombre de la caja"), {
        target: { value: "Caja nueva" },
      });
      click("Crear caja");
      const region = await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
      expect(region).toHaveTextContent("No recibimos un identificador confirmado");
      expect(region).not.toHaveTextContent("PRIVATE");
      expect(within(region).queryByRole("button")).not.toBeInTheDocument();
      expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    }
  );

  async function sendOpen() {
    await screen.findByRole("option", { name: register.name });
    fireEvent.change(screen.getByLabelText("Caja"), { target: { value: register.id } });
    fireEvent.change(screen.getByLabelText("Importe inicial"), { target: { value: "0,00" } });
    click("Abrir sesión");
    click("Confirmar apertura");
  }

  it("UX-035: an uncertain open is looked up by its key and never re-sent blind", async () => {
    const fetcher = mount(
      () => Promise.reject(new Error("PRIVATE lost")),
      (url) => (url.includes("/sessions/attempts/") ? json(session) : json([session, other]))
    );
    await sendOpen();
    const region = await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
    expect(region).not.toHaveTextContent("PRIVATE");
    const post = fetcher.mock.calls.find((call) => call[1]?.method === "POST");
    const key = (post?.[1]?.headers as Record<string, string>)["Idempotency-Key"];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);

    fireEvent.click(within(region).getByRole("button", { name: "Consultar si se abrió" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Intento de Caja sin confirmar" })
      ).not.toBeInTheDocument()
    );
    expect(
      fetcher.mock.calls.some((call) => (call[0] as string).endsWith(`/sessions/attempts/${key}`))
    ).toBe(true);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("UX-035: when the open recorded nothing, the retry re-sends the SAME key", async () => {
    let posts = 0;
    const fetcher = mount(
      () => {
        posts += 1;
        return posts === 1 ? Promise.reject(new Error("lost")) : json(session, 201);
      },
      (url) =>
        url.includes("/sessions/attempts/")
          ? json({ error: { code: "NOT_FOUND", message: "x" } }, 404)
          : json([session, other])
    );
    await sendOpen();
    const region = await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
    fireEvent.click(within(region).getByRole("button", { name: "Consultar si se abrió" }));
    expect(await screen.findByTestId("open-attempt-absent")).toHaveTextContent("misma clave");
    click("Reintentar la misma apertura");
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Intento de Caja sin confirmar" })
      ).not.toBeInTheDocument()
    );
    const keys = fetcher.mock.calls
      .filter((call) => call[1]?.method === "POST")
      .map((call) => (call[1]?.headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("UX-035: after a reload, offers to look up a previous page's unanswered movement", async () => {
    const key = "66666666-6666-4666-8666-666666666666";
    window.sessionStorage.setItem(
      "newsaas.pending-attempts.v1",
      JSON.stringify([{ kind: "cash.movement.create", key, startedAt: new Date().toISOString() }])
    );
    mount(
      () => json({}),
      (url) =>
        url.endsWith(`/movements/attempts/${key}`) ? json(movement) : json([session, other])
    );
    const panel = await screen.findByTestId("pending-cash-attempts");
    fireEvent.click(within(panel).getByRole("button", { name: "Consultar" }));
    expect(await within(panel).findByText(/Se registró/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("newsaas.pending-attempts.v1")).toBeNull();
    window.sessionStorage.clear();
  });

  it("blocks link exit and session switches while pending, warns on unload and permits acknowledged uncertain exit", async () => {
    let reject!: (error: Error) => void;
    const fetcher = mount(
      () =>
        new Promise<Response>((_resolve, fail) => {
          reject = fail;
        })
    );
    await sendMovement();
    const pendingButton = screen.getByRole("button", { name: "Guardando…" });
    expect(pendingButton).toBeDisabled();
    // Cancel native review is blocked while its command is still in flight.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Seleccionar sesión" })).toBeDisabled();
    fireEvent.click(screen.getByRole("link", { name: "Salir" }));
    const pendingExit = screen.getByRole("dialog", { name: "Hay una operación pendiente" });
    expect(
      within(pendingExit).getByRole("button", { name: "Salir y descartar copia local" })
    ).toBeDisabled();
    click("Permanecer en Caja");
    expect(push).not.toHaveBeenCalled();
    reject(new Error("PRIVATE timeout"));
    await screen.findByRole("region", { name: "Intento de Caja sin confirmar" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Volver" })).toBeEnabled());
    click("Volver");
    fireEvent.click(screen.getByRole("link", { name: "Salir" }));
    const dialog = screen.getByRole("dialog", { name: "¿Salir de Caja?" });
    expect(dialog).toHaveTextContent("no cancela ni confirma");
    click("Permanecer en Caja");
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Salir" }));
    click("Salir y descartar copia local");
    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith("/app"));
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
});
