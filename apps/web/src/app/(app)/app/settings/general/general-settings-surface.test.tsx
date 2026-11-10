import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GeneralSettingsSurface,
  type GeneralSettingsSurfaceProps,
} from "./general-settings-surface";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

type Stored = Record<string, Record<string, unknown>>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function defaults(): Stored {
  return {
    sales: { defaultCurrency: "PYG", requireCustomerForInvoice: false },
    portal: { bookingRequiresApproval: true },
    notifications: { appointmentReminderLeadHours: 24, appointmentReminderChannels: ["EMAIL"] },
    scheduling: {
      conflictPolicy: "REJECT",
      availability: [
        {
          membershipId: "11111111-1111-4111-8111-111111111111",
          branchId: "22222222-2222-4222-8222-222222222222",
          weekday: 1,
          startMinute: 480,
          endMinute: 720,
        },
      ],
      blocks: [],
    },
  };
}

/**
 * A fake settings API: GET returns the stored namespace; PUT merges the patch
 * (as the real service does) unless `reject` answers for that namespace.
 */
function installApi(
  options: { stored?: Stored; reject?: Partial<Record<string, Response>> } = {}
): Call[] {
  const stored = options.stored ?? defaults();
  const calls: Call[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    const namespace = url.replace("/api/settings/", "");
    const current = stored[namespace];
    if (current === undefined) return Promise.resolve(json({ error: { code: "NOT_FOUND" } }, 404));
    if (method === "PUT") {
      const rejection = options.reject?.[namespace];
      if (rejection) return Promise.resolve(rejection);
      stored[namespace] = { ...current, ...(JSON.parse(body) as Record<string, unknown>) };
    }
    return Promise.resolve(json({ settings: stored[namespace] }));
  });
  return calls;
}

function renderSurface(props: GeneralSettingsSurfaceProps = {}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GeneralSettingsSurface {...props} />
    </QueryClientProvider>
  );
}

async function section(name: string): Promise<HTMLElement> {
  const region = await screen.findByRole("region", { name });
  // Wait until the section's form replaced its loading state.
  await within(region).findByRole("button", { name: "Guardar" });
  return region;
}

function puts(calls: readonly Call[], namespace: string): Call[] {
  return calls.filter((call) => call.method === "PUT" && call.url === `/api/settings/${namespace}`);
}

function gets(calls: readonly Call[], namespace: string): Call[] {
  return calls.filter((call) => call.method === "GET" && call.url === `/api/settings/${namespace}`);
}

afterEach(() => vi.restoreAllMocks());

describe("GeneralSettingsSurface (CFG-001)", () => {
  it("renders every section with the current values from GET", async () => {
    installApi({
      stored: {
        ...defaults(),
        sales: { defaultCurrency: "PYG", requireCustomerForInvoice: true },
        portal: { bookingRequiresApproval: false },
        notifications: {
          appointmentReminderLeadHours: 48,
          appointmentReminderChannels: ["EMAIL", "WHATSAPP"],
        },
        scheduling: { conflictPolicy: "ALLOW", availability: [], blocks: [] },
      },
    });
    renderSurface();

    const sales = await section("Ventas");
    expect(within(sales).getByRole("checkbox", { name: "La factura exige cliente" })).toBeChecked();
    const portal = await section("Portal");
    expect(
      within(portal).getByRole("checkbox", { name: "Las reservas necesitan aprobación" })
    ).not.toBeChecked();
    const notifications = await section("Notificaciones");
    expect(
      within(notifications).getByRole("spinbutton", {
        name: "Horas de anticipación del recordatorio",
      })
    ).toHaveValue(48);
    expect(
      within(notifications).getByRole("checkbox", { name: "Correo electrónico" })
    ).toBeChecked();
    expect(within(notifications).getByRole("checkbox", { name: "WhatsApp" })).toBeChecked();
    const agenda = await section("Agenda");
    expect(
      within(agenda).getByRole("radio", { name: /Permitir turnos superpuestos/ })
    ).toBeChecked();
  });

  it("shows a loading state, then an error state with retry when a section cannot be read", async () => {
    installApi();
    const original = global.fetch;
    let failPortal = true;
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/settings/portal" && failPortal) {
        failPortal = false;
        return Promise.resolve(json({ error: { code: "INTERNAL" } }, 500));
      }
      return original(input, init);
    });
    renderSurface();

    const portal = await screen.findByRole("region", { name: "Portal" });
    expect(within(portal).getByText("Cargando Portal…")).toBeInTheDocument();
    const alert = await within(portal).findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo cargar esta configuración.");
    fireEvent.click(within(alert).getByRole("button", { name: "Volver a intentar" }));
    expect(
      await within(portal).findByRole("checkbox", { name: "Las reservas necesitan aprobación" })
    ).toBeChecked();
  });

  it.each([
    ["Ventas", "sales.settings.manage", "sales"],
    ["Portal", "portal.settings.manage", "portal"],
    ["Notificaciones", "notifications.settings.manage", "notifications"],
    ["Agenda", "scheduling.settings.manage", "scheduling"],
  ])("hides «%s» without %s and never reads it", async (label, permission, namespace) => {
    const calls = installApi();
    const all = [
      "sales.settings.manage",
      "portal.settings.manage",
      "notifications.settings.manage",
      "scheduling.settings.manage",
    ];
    renderSurface({ permissions: all.filter((key) => key !== permission) });

    // Some other section renders, so the page is not just still loading.
    await screen.findAllByRole("button", { name: "Guardar" });
    expect(screen.queryByRole("region", { name: label })).not.toBeInTheDocument();
    expect(gets(calls, namespace)).toHaveLength(0);
  });

  it.each([
    ["Ventas", "sales"],
    ["Portal", "portal"],
  ])("hides «%s» when the clinic lacks the %s feature", async (label, feature) => {
    installApi();
    renderSurface({
      entitlements: ["sales", "portal"].filter((code) => code !== feature),
    });
    await screen.findAllByRole("button", { name: "Guardar" });
    expect(screen.queryByRole("region", { name: label })).not.toBeInTheDocument();
    // Namespaces without a feature gate stay offered.
    expect(screen.getByRole("region", { name: "Notificaciones" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Agenda" })).toBeInTheDocument();
  });

  it("explains the empty page when the caller holds none of the four permissions", async () => {
    const calls = installApi();
    renderSurface({ permissions: ["sales.read"] });
    expect(
      await screen.findByText("No tenés permiso para cambiar la configuración general")
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("saves Ventas with only the changed key and keeps the currency read-only", async () => {
    const calls = installApi();
    renderSurface();
    const sales = await section("Ventas");

    const currency = within(sales).getByRole("textbox", { name: "Moneda" });
    expect(currency).toHaveValue("PYG");
    expect(currency).toHaveAttribute("readonly");

    fireEvent.click(within(sales).getByRole("checkbox", { name: "La factura exige cliente" }));
    fireEvent.click(within(sales).getByRole("button", { name: "Guardar" }));

    await within(sales).findByText("Se guardaron los cambios.");
    expect(puts(calls, "sales").map((call) => JSON.parse(call.body) as unknown)).toEqual([
      { requireCustomerForInvoice: true },
    ]);
  });

  it("refreshes the section from the API after a successful save", async () => {
    const calls = installApi();
    renderSurface();
    const portal = await section("Portal");
    expect(gets(calls, "portal")).toHaveLength(1);

    fireEvent.click(
      within(portal).getByRole("checkbox", { name: "Las reservas necesitan aprobación" })
    );
    fireEvent.click(within(portal).getByRole("button", { name: "Guardar" }));

    await within(portal).findByText("Se guardaron los cambios.");
    await waitFor(() => expect(gets(calls, "portal")).toHaveLength(2));
    expect(puts(calls, "portal").map((call) => JSON.parse(call.body) as unknown)).toEqual([
      { bookingRequiresApproval: false },
    ]);
    expect(
      within(portal).getByRole("checkbox", { name: "Las reservas necesitan aprobación" })
    ).not.toBeChecked();
    // Nothing left to save after the refresh.
    expect(within(portal).getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("does not offer a save while nothing changed", async () => {
    const calls = installApi();
    renderSurface();
    const sales = await section("Ventas");
    expect(within(sales).getByRole("button", { name: "Guardar" })).toBeDisabled();
    const box = within(sales).getByRole("checkbox", { name: "La factura exige cliente" });
    fireEvent.click(box);
    fireEvent.click(box);
    expect(within(sales).getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("explains a validation refusal in Spanish, in the section that failed", async () => {
    installApi({
      reject: {
        notifications: json(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "Settings patch failed namespace validation.",
            },
          },
          400
        ),
      },
    });
    renderSurface();
    const notifications = await section("Notificaciones");
    fireEvent.click(within(notifications).getByRole("checkbox", { name: "WhatsApp" }));
    fireEvent.click(within(notifications).getByRole("button", { name: "Guardar" }));

    const alert = await within(notifications).findByRole("alert");
    expect(alert).toHaveTextContent("Los valores no son válidos. Revisalos e intentá de nuevo.");
    // UX-036: the staff surface shows no English fallback from the API.
    expect(alert).not.toHaveTextContent("Settings patch failed namespace validation.");
    // Other sections are untouched by that failure.
    expect(within(await section("Ventas")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["FORBIDDEN", 403, "No tenés permiso para cambiar esta configuración."],
    ["FEATURE_NOT_ENTITLED", 403, "Tu plan no incluye esta función."],
  ])("explains a %s refusal on save", async (code, status, message) => {
    installApi({
      reject: { sales: json({ error: { code, message: "English default." } }, status) },
    });
    renderSurface();
    const sales = await section("Ventas");
    fireEvent.click(within(sales).getByRole("checkbox", { name: "La factura exige cliente" }));
    fireEvent.click(within(sales).getByRole("button", { name: "Guardar" }));
    expect(await within(sales).findByRole("alert")).toHaveTextContent(message);
  });

  it("saves the reminder lead hours alone when only they changed", async () => {
    const calls = installApi();
    renderSurface();
    const notifications = await section("Notificaciones");
    fireEvent.change(
      within(notifications).getByRole("spinbutton", {
        name: "Horas de anticipación del recordatorio",
      }),
      { target: { value: "72" } }
    );
    fireEvent.click(within(notifications).getByRole("button", { name: "Guardar" }));
    await within(notifications).findByText("Se guardaron los cambios.");
    expect(puts(calls, "notifications").map((call) => JSON.parse(call.body) as unknown)).toEqual([
      { appointmentReminderLeadHours: 72 },
    ]);
  });

  it.each(["0", "169", "12.5", ""])(
    "refuses reminder lead hours %j outside the API range without calling it",
    async (value) => {
      const calls = installApi();
      renderSurface();
      const notifications = await section("Notificaciones");
      const input = within(notifications).getByRole("spinbutton", {
        name: "Horas de anticipación del recordatorio",
      });
      expect(input).toHaveAttribute("min", "1");
      expect(input).toHaveAttribute("max", "168");
      fireEvent.change(input, { target: { value } });
      fireEvent.click(within(notifications).getByRole("button", { name: "Guardar" }));
      expect(
        await within(notifications).findByText("Elegí un número entero de horas entre 1 y 168.")
      ).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(puts(calls, "notifications")).toHaveLength(0);
    }
  );

  it("requires at least one reminder channel", async () => {
    const calls = installApi();
    renderSurface();
    const notifications = await section("Notificaciones");
    fireEvent.click(within(notifications).getByRole("checkbox", { name: "Correo electrónico" }));
    fireEvent.click(within(notifications).getByRole("button", { name: "Guardar" }));
    expect(await within(notifications).findByText("Elegí al menos un canal.")).toBeInTheDocument();
    expect(puts(calls, "notifications")).toHaveLength(0);
  });

  it("sends each reminder channel once, in the API's order", async () => {
    const calls = installApi({
      stored: {
        ...defaults(),
        // A repeated stored value must not be sent back repeated.
        notifications: {
          appointmentReminderLeadHours: 24,
          appointmentReminderChannels: ["WHATSAPP", "WHATSAPP"],
        },
      },
    });
    renderSurface();
    const notifications = await section("Notificaciones");
    fireEvent.click(within(notifications).getByRole("checkbox", { name: "Correo electrónico" }));
    fireEvent.click(within(notifications).getByRole("button", { name: "Guardar" }));
    await within(notifications).findByText("Se guardaron los cambios.");
    expect(puts(calls, "notifications").map((call) => JSON.parse(call.body) as unknown)).toEqual([
      { appointmentReminderChannels: ["EMAIL", "WHATSAPP"] },
    ]);
  });

  it("saves the agenda conflict policy without ever sending availability or blocks", async () => {
    const calls = installApi();
    renderSurface();
    const agenda = await section("Agenda");
    fireEvent.click(within(agenda).getByRole("radio", { name: /Permitir turnos superpuestos/ }));
    fireEvent.click(within(agenda).getByRole("button", { name: "Guardar" }));
    await within(agenda).findByText("Se guardaron los cambios.");

    const sent = puts(calls, "scheduling").map((call) => JSON.parse(call.body) as unknown);
    expect(sent).toEqual([{ conflictPolicy: "ALLOW" }]);
    // The stored windows survive the save untouched.
    expect(
      calls.some((call) => call.method === "PUT" && /availability|blocks/.test(call.body))
    ).toBe(false);
  });
});
