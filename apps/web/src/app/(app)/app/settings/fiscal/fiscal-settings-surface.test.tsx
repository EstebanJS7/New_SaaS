import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmitterProfile, Establishment, TimbradoRange } from "./fiscal-settings-api";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { FiscalSettingsSurface } from "./fiscal-settings-surface";

const EST_ID = "11111111-1111-4111-8111-111111111111";
const FE_RANGE_ID = "22222222-2222-4222-8222-222222222222";
const NC_RANGE_ID = "33333333-3333-4333-8333-333333333333";

const PROFILE: EmitterProfile = {
  ruc: "80012345",
  checkDigit: "6",
  taxpayerType: 2,
  regimeCode: null,
  legalName: "Clínica Demo S.A.",
  tradeName: "Vet Demo",
  responsibleIssuer: null,
  transactionType: 2,
  taxType: 1,
  emissionType: 1,
  activities: [{ code: "75000", description: "Actividades veterinarias" }],
  issuancePoint: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};
const ESTABLISHMENT: Establishment = {
  id: EST_ID,
  code: "001",
  addressLine: "Av. España",
  houseNumber: 1234,
  addressComplement1: "Piso 2",
  addressComplement2: null,
  departmentCode: 1,
  districtCode: 5,
  districtName: "Recoleta",
  cityCode: 1,
  cityName: "Asunción",
  phone: "021600000",
  email: "fiscal@demo.test",
  branchName: "Central",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};
const FE_RANGE: TimbradoRange = {
  id: FE_RANGE_ID,
  establishmentId: EST_ID,
  expeditionPoint: "001",
  documentType: 1,
  series: null,
  timbradoNumber: "12345678",
  rangeFrom: 1,
  rangeTo: 1000,
  validityStart: "2026-01-01",
  nextNumber: 1,
  status: "ACTIVE",
};
const NC_RANGE: TimbradoRange = { ...FE_RANGE, id: NC_RANGE_ID, documentType: 5 };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}
type Route = (call: Call) => Response | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

interface Fixture {
  profile?: Response | (() => Response);
  establishments?: Response | (() => Response);
  ranges?: Response | (() => Response);
}

function installFetch(fixture: Fixture, route: Route = () => undefined): Call[] {
  const calls: Call[] = [];
  const read = (value: Response | (() => Response) | undefined, fallback: () => Response) =>
    value === undefined ? fallback() : typeof value === "function" ? value() : value.clone();
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const routed = route(call);
    if (routed !== undefined) return Promise.resolve(routed);
    if (call.method === "GET" && url === "/api/fiscal/emitter-profile")
      return Promise.resolve(read(fixture.profile, () => json(PROFILE)));
    if (call.method === "GET" && url === "/api/fiscal/establishments")
      return Promise.resolve(read(fixture.establishments, () => json({ items: [ESTABLISHMENT] })));
    if (call.method === "GET" && url === "/api/fiscal/timbrado-ranges")
      return Promise.resolve(read(fixture.ranges, () => json({ items: [FE_RANGE, NC_RANGE] })));
    if (call.method === "GET" && ["/api/fiscal/signing-material", "/api/fiscal/csc"].includes(url))
      return Promise.resolve(json({ items: [] }));
    if (call.method === "GET" && url === "/api/fiscal/tax-classifications")
      return Promise.resolve(json({ items: [], rates: [] }));
    return Promise.resolve(apiError(500, "INTERNAL", "unexpected"));
  });
  return calls;
}

function renderSurface(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FiscalSettingsSurface />
    </QueryClientProvider>
  );
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
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

afterEach(() => vi.restoreAllMocks());

describe("FiscalSettingsSurface (FISC-018)", () => {
  it("shows a permission state and no forms when the API answers 403", async () => {
    const forbidden = () =>
      apiError(403, "FORBIDDEN", "The required fiscal permission is missing.");
    installFetch({ profile: forbidden, establishments: forbidden, ranges: forbidden });
    renderSurface();
    expect(
      await screen.findByText("No tenés permiso para ver la configuración fiscal")
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Perfil del emisor" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows loading states while the sections load", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));
    renderSurface();
    expect(screen.getByText("Cargando perfil fiscal…")).toBeInTheDocument();
    expect(screen.getByText("Cargando establecimientos…")).toBeInTheDocument();
    expect(screen.getByText("Cargando timbrados…")).toBeInTheDocument();
  });

  describe("profile", () => {
    it("reads the profile and saves it", async () => {
      const calls = installFetch({}, (call) =>
        call.method === "PUT" && call.url === "/api/fiscal/emitter-profile"
          ? json({ ...PROFILE, legalName: "Clínica Nueva S.A." })
          : undefined
      );
      renderSurface();
      const profile = await screen.findByRole("region", { name: "Perfil del emisor" });
      expect(await within(profile).findByText("Clínica Demo S.A.")).toBeInTheDocument();
      expect(within(profile).getByText("80012345-6")).toBeInTheDocument();
      expect(within(profile).getByText("Persona jurídica")).toBeInTheDocument();

      fireEvent.click(within(profile).getByRole("button", { name: "Editar perfil" }));
      expect(within(profile).getByLabelText("RUC")).toHaveValue("80012345");
      fireEvent.change(within(profile).getByLabelText("Razón social"), {
        target: { value: "Clínica Nueva S.A." },
      });
      fireEvent.click(within(profile).getByRole("button", { name: "Guardar perfil" }));

      expect(await screen.findByText("Se guardó el perfil fiscal.")).toBeInTheDocument();
      const put = calls.find((call) => call.method === "PUT");
      expect(JSON.parse(put?.body ?? "{}")).toEqual({
        ruc: "80012345",
        checkDigit: "6",
        taxpayerType: 2,
        regimeCode: null,
        legalName: "Clínica Nueva S.A.",
        tradeName: "Vet Demo",
        responsibleIssuer: null,
        transactionType: 2,
        taxType: 1,
        emissionType: 1,
        activities: [{ code: "75000", description: "Actividades veterinarias" }],
      });
    });

    it("prefills the declared responsible issuer and keeps it on save, with no retype notice", async () => {
      const issuer = {
        type: 1,
        typeName: "Cédula paraguaya",
        id: "1234567",
        name: "Ana Pérez",
        role: "Contadora",
      };
      const calls = installFetch(
        { profile: () => json({ ...PROFILE, responsibleIssuer: issuer }) },
        (call) =>
          call.method === "PUT" && call.url === "/api/fiscal/emitter-profile"
            ? json({ ...PROFILE, responsibleIssuer: issuer })
            : undefined
      );
      renderSurface();
      const profile = await screen.findByRole("region", { name: "Perfil del emisor" });
      fireEvent.click(await within(profile).findByRole("button", { name: "Editar perfil" }));
      expect(within(profile).getByLabelText("Declarar un responsable de la emisión")).toBeChecked();
      expect(within(profile).getByLabelText("Número de documento del responsable")).toHaveValue(
        "1234567"
      );
      expect(within(profile).getByLabelText("Nombre del responsable")).toHaveValue("Ana Pérez");
      expect(within(profile).getByLabelText("Cargo del responsable")).toHaveValue("Contadora");
      expect(within(profile).queryByText(/volvé a escribir/)).toBeNull();
      fireEvent.click(within(profile).getByRole("button", { name: "Guardar perfil" }));
      expect(await screen.findByText("Se guardó el perfil fiscal.")).toBeInTheDocument();
      const put = calls.find((call) => call.method === "PUT");
      expect((JSON.parse(put?.body ?? "{}") as Record<string, unknown>).responsibleIssuer).toEqual(
        issuer
      );
    });

    it("says there is no profile yet and offers to create it", async () => {
      let created = false;
      const calls = installFetch(
        {
          profile: () =>
            created
              ? json(PROFILE)
              : apiError(404, "NOT_FOUND", "The emitter fiscal profile was not found."),
        },
        (call) => {
          if (call.method !== "PUT") return undefined;
          created = true;
          return json(PROFILE);
        }
      );
      renderSurface();
      expect(await screen.findByText("Todavía no hay perfil fiscal")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Crear perfil fiscal" }));
      const profile = section("Perfil del emisor");
      fireEvent.click(within(profile).getByRole("button", { name: "Guardar perfil" }));
      expect(await within(profile).findByText("Escribí un RUC válido.")).toBeInTheDocument();
      expect(calls.some((call) => call.method === "PUT")).toBe(false);

      fireEvent.change(within(profile).getByLabelText("RUC"), { target: { value: "80012345" } });
      fireEvent.change(within(profile).getByLabelText("Dígito verificador"), {
        target: { value: "6" },
      });
      fireEvent.change(within(profile).getByLabelText("Razón social"), {
        target: { value: "Clínica Demo S.A." },
      });
      fireEvent.change(within(profile).getByLabelText("Código de actividad 1"), {
        target: { value: "75000" },
      });
      fireEvent.change(within(profile).getByLabelText("Descripción de actividad 1"), {
        target: { value: "Actividades veterinarias" },
      });
      fireEvent.click(within(profile).getByRole("button", { name: "Guardar perfil" }));
      expect(await screen.findByText("Se guardó el perfil fiscal.")).toBeInTheDocument();
      const body = JSON.parse(calls.find((call) => call.method === "PUT")?.body ?? "{}") as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        ruc: "80012345",
        checkDigit: "6",
        legalName: "Clínica Demo S.A.",
        tradeName: null,
        responsibleIssuer: null,
        activities: [{ code: "75000", description: "Actividades veterinarias" }],
      });
    });

    it("shows an error state when the profile cannot be read", async () => {
      installFetch({ profile: () => apiError(500, "INTERNAL", "boom") });
      renderSurface();
      expect(await screen.findByText("No se pudo cargar el perfil fiscal.")).toBeInTheDocument();
    });
  });

  describe("establishments", () => {
    it("shows the empty state and creates an establishment", async () => {
      const calls = installFetch({ establishments: () => json({ items: [] }) }, (call) =>
        call.method === "POST" && call.url === "/api/fiscal/establishments"
          ? json(ESTABLISHMENT, 201)
          : undefined
      );
      renderSurface();
      expect(await screen.findByText("Todavía no hay establecimientos")).toBeInTheDocument();
      const establishments = section("Establecimientos");
      fireEvent.click(
        within(establishments).getByRole("button", { name: "Agregar establecimiento" })
      );
      const form = within(establishments).getByRole("form", { name: "Nuevo establecimiento" });
      fireEvent.change(within(form).getByLabelText("Código"), { target: { value: "001" } });
      fireEvent.change(within(form).getByLabelText("Dirección"), {
        target: { value: "Av. España" },
      });
      fireEvent.change(within(form).getByLabelText("Número de casa"), {
        target: { value: "1234" },
      });
      fireEvent.change(within(form).getByLabelText("Código de ciudad"), {
        target: { value: "1" },
      });
      fireEvent.change(within(form).getByLabelText("Ciudad"), { target: { value: "Asunción" } });
      fireEvent.change(within(form).getByLabelText("Teléfono"), {
        target: { value: "021600000" },
      });
      fireEvent.change(within(form).getByLabelText("Correo"), {
        target: { value: "fiscal@demo.test" },
      });
      fireEvent.click(within(form).getByRole("button", { name: "Guardar establecimiento" }));
      expect(await screen.findByText("Se guardó el establecimiento 001.")).toBeInTheDocument();
      expect(JSON.parse(calls.find((call) => call.method === "POST")?.body ?? "{}")).toEqual({
        code: "001",
        addressLine: "Av. España",
        houseNumber: 1234,
        addressComplement1: null,
        addressComplement2: null,
        departmentCode: 1,
        district: null,
        cityCode: 1,
        cityName: "Asunción",
        phone: "021600000",
        email: "fiscal@demo.test",
        branchName: null,
      });
    });

    it("lists establishments and edits one through its id", async () => {
      const calls = installFetch({}, (call) =>
        call.method === "PUT" && call.url === `/api/fiscal/establishments/${EST_ID}`
          ? json({ ...ESTABLISHMENT, addressLine: "Av. Brasil" })
          : undefined
      );
      renderSurface();
      const establishments = section("Establecimientos");
      const row = await within(establishments).findByTestId("establishment-row");
      expect(within(row).getByText("001")).toBeInTheDocument();
      expect(within(row).getByText("Av. España 1234 · Capital")).toBeInTheDocument();
      fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
      const form = within(establishments).getByRole("form", { name: "Editar establecimiento 001" });
      expect(within(form).getByLabelText("Dirección")).toHaveValue("Av. España");
      // Every saved field is prefilled: the PUT replaces the row, and nothing
      // has to be written again.
      expect(within(form).getByLabelText("Ciudad")).toHaveValue("Asunción");
      expect(within(form).getByLabelText("Teléfono")).toHaveValue("021600000");
      expect(within(form).getByLabelText("Correo")).toHaveValue("fiscal@demo.test");
      expect(within(form).getByLabelText(/^Complemento de dirección 1/)).toHaveValue("Piso 2");
      expect(within(form).getByLabelText(/^Distrito/)).toHaveValue("Recoleta");
      expect(within(form).getByLabelText(/^Nombre de la sucursal/)).toHaveValue("Central");
      expect(within(form).queryByText(/volvé a escribir/)).toBeNull();
      fireEvent.change(within(form).getByLabelText("Dirección"), {
        target: { value: "Av. Brasil" },
      });
      fireEvent.click(within(form).getByRole("button", { name: "Guardar establecimiento" }));
      expect(await screen.findByText("Se guardó el establecimiento 001.")).toBeInTheDocument();
      const put = calls.find((call) => call.method === "PUT");
      expect(put?.url).toBe(`/api/fiscal/establishments/${EST_ID}`);
      expect(JSON.parse(put?.body ?? "{}")).toEqual({
        code: "001",
        addressLine: "Av. Brasil",
        houseNumber: 1234,
        addressComplement1: "Piso 2",
        addressComplement2: null,
        departmentCode: 1,
        district: { code: 5, name: "Recoleta" },
        cityCode: 1,
        cityName: "Asunción",
        phone: "021600000",
        email: "fiscal@demo.test",
        branchName: "Central",
      });
    });

    it("shows an error state when the establishments cannot be read", async () => {
      installFetch({ establishments: () => apiError(500, "INTERNAL", "boom") });
      renderSurface();
      expect(
        await screen.findByText("No se pudo cargar la lista de establecimientos.")
      ).toBeInTheDocument();
    });
  });

  describe("timbrado ranges", () => {
    it("lists ranges and creates one", async () => {
      const calls = installFetch({}, (call) =>
        call.method === "POST" && call.url === "/api/fiscal/timbrado-ranges"
          ? json(FE_RANGE, 201)
          : undefined
      );
      renderSurface();
      const ranges = section("Timbrados");
      const rows = await within(ranges).findAllByTestId("range-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText("Factura electrónica")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Activo")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Nota de crédito electrónica")).toBeInTheDocument();

      fireEvent.click(within(ranges).getByRole("button", { name: "Agregar timbrado" }));
      const form = within(ranges).getByRole("form", { name: "Nuevo timbrado" });
      fireEvent.change(within(form).getByLabelText("Establecimiento"), {
        target: { value: EST_ID },
      });
      fireEvent.change(within(form).getByLabelText("Punto de expedición"), {
        target: { value: "001" },
      });
      fireEvent.change(within(form).getByLabelText("Tipo de documento"), {
        target: { value: "5" },
      });
      fireEvent.change(within(form).getByLabelText("Número de timbrado"), {
        target: { value: "12345678" },
      });
      fireEvent.change(within(form).getByLabelText("Desde el número"), { target: { value: "1" } });
      fireEvent.change(within(form).getByLabelText("Hasta el número"), {
        target: { value: "1000" },
      });
      fireEvent.change(within(form).getByLabelText("Inicio de vigencia"), {
        target: { value: "2026-01-01" },
      });
      fireEvent.click(within(form).getByRole("button", { name: "Guardar timbrado" }));
      expect(await screen.findByText("Se cargó el timbrado 12345678.")).toBeInTheDocument();
      expect(JSON.parse(calls.find((call) => call.method === "POST")?.body ?? "{}")).toEqual({
        establishmentId: EST_ID,
        expeditionPoint: "001",
        documentType: 5,
        series: null,
        timbradoNumber: "12345678",
        rangeFrom: 1,
        rangeTo: 1000,
        validityStart: "2026-01-01",
      });
    });

    it("retires a range only with a reason and an explicit confirmation", async () => {
      const calls = installFetch({}, (call) =>
        call.method === "POST" && call.url === `/api/fiscal/timbrado-ranges/${FE_RANGE_ID}/retire`
          ? json({ ...FE_RANGE, status: "RETIRED" })
          : undefined
      );
      renderSurface();
      const ranges = section("Timbrados");
      const rows = await within(ranges).findAllByTestId("range-row");
      fireEvent.click(within(rows[0]).getByRole("button", { name: "Retirar" }));
      const dialog = screen.getByRole("dialog", { name: "¿Retirar el timbrado 12345678?" });
      const confirm = within(dialog).getByRole("button", { name: "Retirar timbrado" });
      expect(confirm).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText("Motivo"), {
        target: { value: "Timbrado vencido" },
      });
      expect(confirm).toBeEnabled();
      expect(calls.some((call) => call.url.endsWith("/retire"))).toBe(false);
      fireEvent.click(confirm);
      expect(await screen.findByText("Se retiró el timbrado 12345678.")).toBeInTheDocument();
      const retire = calls.find((call) => call.url.endsWith("/retire"));
      expect(retire?.method).toBe("POST");
      expect(JSON.parse(retire?.body ?? "{}")).toEqual({ reason: "Timbrado vencido" });
    });

    it("shows the empty state and the error state", async () => {
      installFetch({ ranges: () => json({ items: [] }) });
      renderSurface();
      expect(await screen.findByText("Todavía no hay timbrados")).toBeInTheDocument();
    });

    it("shows an error state when the ranges cannot be read", async () => {
      installFetch({ ranges: () => apiError(500, "INTERNAL", "boom") });
      renderSurface();
      expect(
        await screen.findByText("No se pudo cargar la lista de timbrados.")
      ).toBeInTheDocument();
    });
  });

  describe("issuance point", () => {
    it("shows the point as missing and declares it through FISC-017's route", async () => {
      const calls = installFetch({}, (call) =>
        call.method === "PUT" && call.url === "/api/fiscal/emitter-profile/issuance-point"
          ? json({
              issuancePoint: {
                establishmentId: EST_ID,
                establishmentCode: "001",
                expeditionPoint: "001",
                documentType: 1,
              },
              creditNoteRangeActive: true,
            })
          : undefined
      );
      renderSurface();
      const point = section("Punto de expedición");
      expect(
        await within(point).findByText("Todavía no hay un punto de expedición declarado.")
      ).toBeInTheDocument();
      fireEvent.change(await within(point).findByLabelText("Timbrado activo"), {
        target: { value: FE_RANGE_ID },
      });
      fireEvent.click(within(point).getByRole("button", { name: "Declarar punto de expedición" }));
      expect(
        await screen.findByText("Se declaró el punto de expedición 001-001 (Factura electrónica).")
      ).toBeInTheDocument();
      const put = calls.find((call) => call.url === "/api/fiscal/emitter-profile/issuance-point");
      expect(put?.method).toBe("PUT");
      expect(JSON.parse(put?.body ?? "{}")).toEqual({
        establishmentId: EST_ID,
        expeditionPoint: "001",
        documentType: 1,
      });
      expect(screen.queryByTestId("credit-note-range-warning")).toBeNull();
    });

    it("shows the declared point", async () => {
      installFetch({
        profile: () =>
          json({
            ...PROFILE,
            issuancePoint: {
              establishmentId: EST_ID,
              establishmentCode: "001",
              expeditionPoint: "001",
              documentType: 1,
            },
          }),
      });
      renderSurface();
      const point = section("Punto de expedición");
      expect(await within(point).findByText("001-001 · Factura electrónica")).toBeInTheDocument();
    });

    it("shows the API's 409 message verbatim", async () => {
      const message =
        "No hay un timbrado activo para el establecimiento 001, punto 001, tipo 1: cargá el timbrado antes de declarar el punto de expedición.";
      installFetch({}, (call) =>
        call.method === "PUT" && call.url.endsWith("/issuance-point")
          ? apiError(409, "CONFLICT", message)
          : undefined
      );
      renderSurface();
      const point = section("Punto de expedición");
      fireEvent.change(await within(point).findByLabelText("Timbrado activo"), {
        target: { value: FE_RANGE_ID },
      });
      fireEvent.click(within(point).getByRole("button", { name: "Declarar punto de expedición" }));
      expect(await within(point).findByRole("alert")).toHaveTextContent(message);
    });

    it("warns when the declared point has no credit-note range", async () => {
      installFetch({ ranges: () => json({ items: [FE_RANGE] }) }, (call) =>
        call.method === "PUT" && call.url.endsWith("/issuance-point")
          ? json({
              issuancePoint: {
                establishmentId: EST_ID,
                establishmentCode: "001",
                expeditionPoint: "001",
                documentType: 1,
              },
              creditNoteRangeActive: false,
            })
          : undefined
      );
      renderSurface();
      const point = section("Punto de expedición");
      fireEvent.change(await within(point).findByLabelText("Timbrado activo"), {
        target: { value: FE_RANGE_ID },
      });
      fireEvent.click(within(point).getByRole("button", { name: "Declarar punto de expedición" }));
      await waitFor(() =>
        expect(screen.getByTestId("credit-note-range-warning")).toHaveTextContent(
          "No hay un timbrado activo de nota de crédito para 001-001"
        )
      );
    });

    it("offers only active ranges and explains when there are none", async () => {
      installFetch({
        ranges: () => json({ items: [{ ...FE_RANGE, status: "RETIRED" }] }),
      });
      renderSurface();
      const point = section("Punto de expedición");
      expect(
        await within(point).findByText(
          "Cargá un timbrado activo antes de declarar el punto de expedición."
        )
      ).toBeInTheDocument();
      expect(within(point).queryByLabelText("Timbrado activo")).toBeNull();
    });
  });
});

/**
 * UX-037: the emitter configuration needs `fiscal.profile.manage`, the secrets
 * need `fiscal.signing_material.manage`, and everything needs the `fiscal`
 * feature. Unknown capabilities show every section, as before.
 */
describe("FiscalSettingsSurface gated by the caller's capabilities (UX-037)", () => {
  function renderWith(capabilities?: Capabilities): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={client}>
        <FiscalSettingsSurface />
      </QueryClientProvider>
    );
    render(
      capabilities === undefined ? (
        tree
      ) : (
        <CapabilitiesProvider value={capabilities}>{tree}</CapabilitiesProvider>
      )
    );
  }
  const BOTH = ["fiscal.profile.manage", "fiscal.signing_material.manage"];

  it("shows the feature state and reads nothing when the clinic lacks fiscal", () => {
    const calls = installFetch({});
    renderWith({ permissions: BOTH, features: [] });
    expect(
      screen.getByRole("heading", { name: "La facturación electrónica no está habilitada" })
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("shows the permission state and reads nothing without either permission", () => {
    const calls = installFetch({});
    renderWith({ permissions: [], features: ["fiscal"] });
    expect(
      screen.getByRole("heading", { name: "No tenés permiso para ver la configuración fiscal" })
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("offers only the secrets to a caller who manages signing material alone", async () => {
    const calls = installFetch({});
    renderWith({ permissions: ["fiscal.signing_material.manage"], features: ["fiscal"] });
    expect(await screen.findByRole("button", { name: "Cargar CSC" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Perfil del emisor" })).toBeNull();
    expect(calls.some((call) => call.url === "/api/fiscal/emitter-profile")).toBe(false);
  });

  it("offers the emitter configuration but not the secrets with fiscal.profile.manage alone", async () => {
    const calls = installFetch({});
    renderWith({ permissions: ["fiscal.profile.manage"], features: ["fiscal"] });
    expect(await screen.findByRole("region", { name: "Perfil del emisor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar CSC" })).toBeNull();
    expect(
      calls.some((call) => ["/api/fiscal/csc", "/api/fiscal/signing-material"].includes(call.url))
    ).toBe(false);
  });

  it.each([
    ["granted", { permissions: BOTH, features: ["fiscal"] }],
    ["unknown", undefined],
  ])("shows every section when capabilities are %s", async (_label, capabilities) => {
    installFetch({});
    renderWith(capabilities);
    expect(await screen.findByRole("region", { name: "Perfil del emisor" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Cargar CSC" })).toBeInTheDocument();
  });
});
