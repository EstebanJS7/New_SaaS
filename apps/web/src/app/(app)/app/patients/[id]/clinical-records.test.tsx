import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ClinicalRecordsSection,
  formatRecordedDate,
  fromDateInput,
  toDateInput,
} from "./clinical-records";
import type { ClinicalDeworming, ClinicalVaccination } from "./clinical-api";

/**
 * Vaccination and deworming entry surface (EPIC-18 REP-010).
 *
 * Every fixture id is a canonical UUID because the clinical client rejects a
 * malformed route identifier before it issues a request.
 */
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";
const VACCINATION_ID = "55555555-5555-4555-8555-555555555555";
const DEWORMING_ID = "66666666-6666-4666-8666-666666666666";

/** Instants with no seconds so a local round trip preserves them exactly. */
const ADMINISTERED_AT = "2026-10-19T12:00:00.000Z";
const DUE_AT = "2027-10-19T12:00:00.000Z";

/**
 * The instant the correction expects, derived exactly as the form derives it: the
 * chosen calendar date pinned to NOON UTC. Written out rather than computed so the
 * wire contract is visible, and so a change to it fails this expectation instead of
 * silently re-deriving itself — the previous version converted through the
 * browser's clock and therefore compared the parser against itself.
 */
const CORRECTED_DUE_INPUT = "2028-01-05";
const CORRECTED_DUE_AT = "2028-01-05T12:00:00.000Z";

const VACCINATION: ClinicalVaccination = {
  id: VACCINATION_ID,
  tenantId: TENANT_ID,
  patientId: PATIENT_ID,
  vaccine: "Rabies",
  administeredAt: ADMINISTERED_AT,
  nextDueAt: DUE_AT,
  createdAt: ADMINISTERED_AT,
  updatedAt: ADMINISTERED_AT,
};

const DEWORMING: ClinicalDeworming = {
  id: DEWORMING_ID,
  tenantId: TENANT_ID,
  patientId: PATIENT_ID,
  product: "Praziquantel",
  administeredAt: ADMINISTERED_AT,
  nextDueAt: null,
  createdAt: ADMINISTERED_AT,
  updatedAt: ADMINISTERED_AT,
};

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Reads a string field from a request body without stringifying a non-string. */
function textField(body: Record<string, unknown> | undefined, key: string): string | null {
  const value = body?.[key];
  return typeof value === "string" ? value : null;
}

type Handler = (body?: Record<string, unknown>) => Response | Promise<Response>;

interface RecordOverrides {
  readonly listVaccinations?: Handler;
  readonly listDeworming?: Handler;
  readonly createVaccination?: Handler;
  readonly createDeworming?: Handler;
  readonly updateVaccination?: Handler;
  readonly updateDeworming?: Handler;
}

interface RecordSeed {
  readonly vaccinations?: ClinicalVaccination[];
  readonly deworming?: ClinicalDeworming[];
}

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | undefined;
}

/**
 * URL + method aware fetch double for both record kinds. The default handlers
 * keep an in-memory list per kind, so a create/update round trip is reflected by
 * the next list read exactly like a real server — which is what makes the
 * post-invalidation assertions meaningful.
 */
function mockRecords(
  overrides: RecordOverrides = {},
  seed: RecordSeed = {}
): ReturnType<typeof vi.fn> {
  const vaccinations: ClinicalVaccination[] = [...(seed.vaccinations ?? [])];
  const deworming: ClinicalDeworming[] = [...(seed.deworming ?? [])];
  const base = `/api/clinical/${PATIENT_ID}`;

  const createVaccination = (body: Record<string, unknown> = {}): ClinicalVaccination => {
    const created: ClinicalVaccination = {
      ...VACCINATION,
      id: "77777777-7777-4777-8777-777777777777",
      vaccine: textField(body, "vaccine") ?? "",
      administeredAt: textField(body, "administeredAt") ?? "",
      nextDueAt: typeof body.nextDueAt === "string" ? body.nextDueAt : null,
    };
    vaccinations.push(created);
    return created;
  };

  const updateVaccination = (
    id: string,
    body: Record<string, unknown> = {}
  ): ClinicalVaccination => {
    const index = vaccinations.findIndex((record) => record.id === id);
    const current = vaccinations[index];
    const updated: ClinicalVaccination = {
      ...current,
      vaccine: typeof body.vaccine === "string" ? body.vaccine : current.vaccine,
      administeredAt:
        typeof body.administeredAt === "string" ? body.administeredAt : current.administeredAt,
      // An explicit `null` clears the due date; an absent key leaves it alone.
      nextDueAt:
        body.nextDueAt === null
          ? null
          : typeof body.nextDueAt === "string"
            ? body.nextDueAt
            : current.nextDueAt,
    };
    vaccinations[index] = updated;
    return updated;
  };

  const createDewormingRecord = (body: Record<string, unknown> = {}): ClinicalDeworming => {
    const created: ClinicalDeworming = {
      ...DEWORMING,
      id: "88888888-8888-4888-8888-888888888888",
      product: textField(body, "product") ?? "",
      administeredAt: textField(body, "administeredAt") ?? "",
      nextDueAt: typeof body.nextDueAt === "string" ? body.nextDueAt : null,
    };
    deworming.push(created);
    return created;
  };

  const updateDewormingRecord = (
    id: string,
    body: Record<string, unknown> = {}
  ): ClinicalDeworming => {
    const index = deworming.findIndex((record) => record.id === id);
    const current = deworming[index];
    const updated: ClinicalDeworming = {
      ...current,
      product: typeof body.product === "string" ? body.product : current.product,
      administeredAt:
        typeof body.administeredAt === "string" ? body.administeredAt : current.administeredAt,
      nextDueAt:
        body.nextDueAt === null
          ? null
          : typeof body.nextDueAt === "string"
            ? body.nextDueAt
            : current.nextDueAt,
    };
    deworming[index] = updated;
    return updated;
  };

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;

    if (url === `${base}/vaccinations` && method === "POST") {
      return Promise.resolve(
        overrides.createVaccination?.(body) ?? jsonResponse(createVaccination(body), 201)
      );
    }
    if (url.startsWith(`${base}/vaccinations/`) && method === "PUT") {
      const id = url.slice(`${base}/vaccinations/`.length);
      return Promise.resolve(
        overrides.updateVaccination?.(body) ?? jsonResponse(updateVaccination(id, body))
      );
    }
    if (url === `${base}/vaccinations`) {
      return Promise.resolve(overrides.listVaccinations?.() ?? jsonResponse(vaccinations));
    }
    if (url === `${base}/deworming` && method === "POST") {
      return Promise.resolve(
        overrides.createDeworming?.(body) ?? jsonResponse(createDewormingRecord(body), 201)
      );
    }
    if (url.startsWith(`${base}/deworming/`) && method === "PUT") {
      const id = url.slice(`${base}/deworming/`.length);
      return Promise.resolve(
        overrides.updateDeworming?.(body) ?? jsonResponse(updateDewormingRecord(id, body))
      );
    }
    if (url === `${base}/deworming`) {
      return Promise.resolve(overrides.listDeworming?.() ?? jsonResponse(deworming));
    }
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function calls(
  fetchMock: ReturnType<typeof vi.fn>,
  suffix: string,
  method: string
): RecordedCall[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url = resolveRequestUrl(input as RequestInfo | URL);
      const callMethod = (init as RequestInit | undefined)?.method ?? "GET";
      return url.endsWith(suffix) && callMethod === method;
    })
    .map(([input, init]) => {
      const raw = (init as RequestInit | undefined)?.body;
      return {
        url: resolveRequestUrl(input as RequestInfo | URL),
        method,
        body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
      };
    });
}

function renderRecords(
  options: { readonly permissions?: readonly string[] } = {}
): ReturnType<typeof render> {
  return render(
    <TestWrapper>
      <ClinicalRecordsSection patientId={PATIENT_ID} permissions={options.permissions} />
    </TestWrapper>
  );
}

async function openVaccinationForm(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Record vaccination" }));
}

async function openDewormingForm(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Record deworming" }));
}

describe("clinical record entry surface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the loading state for both lists", async () => {
    mockRecords({
      listVaccinations: () => new Promise<Response>(() => undefined),
      listDeworming: () => new Promise<Response>(() => undefined),
    });

    renderRecords();

    expect(await screen.findByText("Loading vaccinations...")).toBeInTheDocument();
    expect(await screen.findByText("Loading deworming treatments...")).toBeInTheDocument();
  });

  it("renders the empty state with a create affordance for both kinds", async () => {
    mockRecords();

    renderRecords();

    expect(
      await screen.findByText("No vaccinations recorded for this patient yet.")
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No deworming treatments recorded for this patient yet.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record vaccination" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record deworming" })).toBeInTheDocument();
  });

  it("lists a vaccination with its administered date and its due date", async () => {
    mockRecords({}, { vaccinations: [VACCINATION] });

    renderRecords();

    const list = await screen.findByTestId("vaccination-records");
    expect(await within(list).findByText("Rabies")).toBeInTheDocument();
    expect(within(list).getByText(formatRecordedDate(ADMINISTERED_AT))).toBeInTheDocument();
    expect(within(list).getByText(formatRecordedDate(DUE_AT))).toBeInTheDocument();
    expect(within(list).queryByText("No due date recorded")).not.toBeInTheDocument();
  });

  it("says a vaccination has no due date instead of rendering blank", async () => {
    mockRecords({}, { vaccinations: [{ ...VACCINATION, nextDueAt: null }] });

    renderRecords();

    const list = await screen.findByTestId("vaccination-records");
    expect(await within(list).findByText("No due date recorded")).toBeInTheDocument();
  });

  it("says a deworming treatment has no due date instead of rendering blank", async () => {
    mockRecords({}, { deworming: [DEWORMING] });

    renderRecords();

    const list = await screen.findByTestId("deworming-records");
    expect(await within(list).findByText("No due date recorded")).toBeInTheDocument();
    expect(within(list).getByText("Praziquantel")).toBeInTheDocument();
    expect(within(list).getByText(formatRecordedDate(ADMINISTERED_AT))).toBeInTheDocument();
  });

  it("surfaces a generic error for the vaccination list", async () => {
    mockRecords({
      listVaccinations: () => jsonResponse({ error: { code: "INTERNAL", message: "Boom" } }, 500),
    });

    renderRecords();

    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
  });

  it("surfaces a generic error for the deworming list", async () => {
    mockRecords({
      listDeworming: () =>
        jsonResponse({ error: { code: "INTERNAL", message: "Deworming broke" } }, 500),
    });

    renderRecords();

    expect(await screen.findByRole("alert")).toHaveTextContent("Deworming broke");
  });

  it("renders the permission-denied state for the vaccination list", async () => {
    mockRecords({
      listVaccinations: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderRecords();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to manage clinical records."
    );
  });

  it("renders the permission-denied state for the deworming list", async () => {
    mockRecords({
      listDeworming: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderRecords();

    const list = await screen.findByTestId("deworming-records");
    await waitFor(() => {
      expect(within(list).getByRole("alert")).toHaveTextContent(
        "You do not have permission to manage clinical records."
      );
    });
  });

  it("records a vaccination with a due date and lists the created row", async () => {
    const fetchMock = mockRecords();

    renderRecords();
    await openVaccinationForm();
    fireEvent.change(screen.getByLabelText("Vaccine"), { target: { value: "Rabies" } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.change(screen.getByLabelText("Next dose due (optional)"), {
      target: { value: "2027-10-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save vaccination" }));

    expect(await screen.findByText("Vaccination recorded.")).toBeInTheDocument();

    const created = calls(fetchMock, `/vaccinations`, "POST");
    expect(created).toHaveLength(1);
    // The wall-clock value the staff member typed is converted to an instant in
    // this browser before it leaves: no hand-rolled midnight UTC.
    expect(created[0]?.body).toEqual({
      vaccine: "Rabies",
      administeredAt: "2026-10-19T12:00:00.000Z",
      nextDueAt: "2027-10-19T12:00:00.000Z",
    });

    const list = await screen.findByTestId("vaccination-records");
    expect(await within(list).findByText("Rabies")).toBeInTheDocument();
    expect(
      within(list).getByText(formatRecordedDate("2027-10-19T12:00:00.000Z"))
    ).toBeInTheDocument();
  });

  it("omits nextDueAt when the vaccination due field is left empty", async () => {
    const fetchMock = mockRecords();

    renderRecords();
    await openVaccinationForm();
    fireEvent.change(screen.getByLabelText("Vaccine"), { target: { value: "Rabies" } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save vaccination" }));

    await waitFor(() => expect(calls(fetchMock, `/vaccinations`, "POST")).toHaveLength(1));

    const body = calls(fetchMock, `/vaccinations`, "POST")[0]?.body;
    // Omitted, not null: the create schema accepts an absent key as "no due
    // date" and rejects an explicit null (only UPDATE accepts null).
    expect(body).toEqual({
      vaccine: "Rabies",
      administeredAt: "2026-10-19T12:00:00.000Z",
    });
    expect(body).not.toHaveProperty("nextDueAt");

    const list = await screen.findByTestId("vaccination-records");
    expect(await within(list).findByText("No due date recorded")).toBeInTheDocument();
  });

  it("corrects a vaccination's due date and lists the new instant", async () => {
    const fetchMock = mockRecords({}, { vaccinations: [VACCINATION] });

    renderRecords();
    fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
    fireEvent.change(screen.getByLabelText("Vaccine"), { target: { value: "Rabies (booster)" } });
    fireEvent.change(screen.getByLabelText("Next dose due (optional)"), {
      target: { value: CORRECTED_DUE_INPUT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Vaccination corrected.")).toBeInTheDocument();

    const updated = calls(fetchMock, `/vaccinations/${VACCINATION_ID}`, "PUT");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.body).toEqual({
      vaccine: "Rabies (booster)",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: CORRECTED_DUE_AT,
    });

    const list = await screen.findByTestId("vaccination-records");
    expect(await within(list).findByText("Rabies (booster)")).toBeInTheDocument();
    expect(within(list).getByText(formatRecordedDate(CORRECTED_DUE_AT))).toBeInTheDocument();
  });

  it("clears a vaccination due date with an explicit null and shows the no-due state", async () => {
    const fetchMock = mockRecords({}, { vaccinations: [VACCINATION] });

    renderRecords();
    const list = await screen.findByTestId("vaccination-records");
    expect(await within(list).findByText(formatRecordedDate(DUE_AT))).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: "Correct" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));

    expect(await screen.findByText("Due date removed.")).toBeInTheDocument();

    const updated = calls(fetchMock, `/vaccinations/${VACCINATION_ID}`, "PUT");
    expect(updated).toHaveLength(1);
    // Exactly the clearing write: no name, no administered instant, and a JSON
    // null rather than an omitted key or an empty string.
    expect(updated[0]?.body).toEqual({ nextDueAt: null });

    await waitFor(() => {
      expect(within(list).getByText("No due date recorded")).toBeInTheDocument();
    });
    expect(within(list).queryByText(formatRecordedDate(DUE_AT))).not.toBeInTheDocument();
  });

  it("records a deworming treatment with a due date and lists it", async () => {
    const fetchMock = mockRecords();

    renderRecords();
    await openDewormingForm();
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Praziquantel" } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.change(screen.getByLabelText("Next treatment due (optional)"), {
      target: { value: "2027-01-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save deworming" }));

    expect(await screen.findByText("Deworming treatment recorded.")).toBeInTheDocument();

    const created = calls(fetchMock, `/deworming`, "POST");
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toEqual({
      product: "Praziquantel",
      administeredAt: "2026-10-19T12:00:00.000Z",
      nextDueAt: "2027-01-19T12:00:00.000Z",
    });

    const list = await screen.findByTestId("deworming-records");
    expect(await within(list).findByText("Praziquantel")).toBeInTheDocument();
  });

  it("clears a deworming due date with an explicit null", async () => {
    const fetchMock = mockRecords({}, { deworming: [{ ...DEWORMING, nextDueAt: DUE_AT }] });

    renderRecords();
    const list = await screen.findByTestId("deworming-records");
    expect(await within(list).findByText(formatRecordedDate(DUE_AT))).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: "Correct" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));

    await waitFor(() =>
      expect(calls(fetchMock, `/deworming/${DEWORMING_ID}`, "PUT")).toHaveLength(1)
    );
    expect(calls(fetchMock, `/deworming/${DEWORMING_ID}`, "PUT")[0]?.body).toEqual({
      nextDueAt: null,
    });

    await waitFor(() => {
      expect(within(list).getByText("No due date recorded")).toBeInTheDocument();
    });
  });

  it("hides the create and correct actions without the clinical write permissions", async () => {
    mockRecords({}, { vaccinations: [VACCINATION], deworming: [DEWORMING] });

    renderRecords({ permissions: ["vet.clinical.read"] });

    expect(await screen.findByText("Rabies")).toBeInTheDocument();
    expect(screen.getByText("Praziquantel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record vaccination" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record deworming" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Correct" })).not.toBeInTheDocument();
  });

  it("shows the create actions when the write permissions are granted", async () => {
    mockRecords();

    renderRecords({
      permissions: ["vet.clinical.read", "vet.clinical.create", "vet.clinical.update"],
    });

    expect(await screen.findByRole("button", { name: "Record vaccination" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record deworming" })).toBeInTheDocument();
  });

  it("keeps the actions when the caller's permissions are unknown, leaving the API authoritative", async () => {
    mockRecords();

    renderRecords();

    expect(await screen.findByRole("button", { name: "Record vaccination" })).toBeInTheDocument();
  });

  it("announces a refused create and withdraws the action", async () => {
    mockRecords({
      createVaccination: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderRecords();
    await openVaccinationForm();
    fireEvent.change(screen.getByLabelText("Vaccine"), { target: { value: "Rabies" } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save vaccination" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to manage clinical records."
    );
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Record vaccination" })).not.toBeInTheDocument();
    });
  });

  it("shows the server's validation message instead of a generic failure", async () => {
    mockRecords({
      createVaccination: () =>
        jsonResponse(
          { error: { code: "VALIDATION_FAILED", message: "Invalid vaccination body." } },
          400
        ),
    });

    renderRecords();
    await openVaccinationForm();
    fireEvent.change(screen.getByLabelText("Vaccine"), { target: { value: "Rabies" } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save vaccination" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid vaccination body.");
  });

  it("distinguishes a conflict from a validation failure in the surfaced copy", async () => {
    mockRecords({
      createDeworming: () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "The record changed elsewhere." } },
          409
        ),
    });

    renderRecords();
    await openDewormingForm();
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Praziquantel" } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save deworming" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The record changed elsewhere.");
    expect(alert).not.toHaveTextContent("Invalid");
  });

  it("sends only the record fields, with the patient anchor from the route", async () => {
    const fetchMock = mockRecords();

    renderRecords();
    await openVaccinationForm();
    // A tenant-looking value typed into the form is a NAME, never an authority.
    fireEvent.change(screen.getByLabelText("Vaccine"), { target: { value: TENANT_ID } });
    fireEvent.change(screen.getByLabelText("Administered on"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save vaccination" }));

    await waitFor(() => expect(calls(fetchMock, `/vaccinations`, "POST")).toHaveLength(1));

    const [created] = calls(fetchMock, `/vaccinations`, "POST");
    expect(created?.url).toBe(`/api/clinical/${PATIENT_ID}/vaccinations`);
    expect(created?.url).not.toContain(TENANT_ID);
    expect(Object.keys(created?.body ?? {}).sort()).toEqual(["administeredAt", "vaccine"]);
    expect(created?.body?.vaccine).toBe(TENANT_ID);
  });
});

describe("clinical record date helpers", () => {
  it("renders the stored instant as the calendar date staff chose", () => {
    expect(formatRecordedDate(ADMINISTERED_AT)).toBe("2026-10-19");
    expect(formatRecordedDate(ADMINISTERED_AT)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("pins a chosen date to noon UTC, so the TENANT day is the day staff typed", () => {
    expect(fromDateInput("2026-10-19")).toBe("2026-10-19T12:00:00.000Z");
    // The decisive assertion: whatever zone the BROWSER is in, the tenant-local
    // calendar date of the value that leaves this surface equals what was typed.
    const wire = fromDateInput("2026-11-18")!;
    const tenantDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(wire));
    expect(tenantDate).toBe("2026-11-18");
  });

  it("keeps the tenant day correct for other plausible tenant zones too", () => {
    // Noon UTC has twelve hours of margin either side, so any offset in (-12,+12)
    // keeps the tenant-local date equal to the chosen date.
    for (const timeZone of ["America/Asuncion", "UTC", "Asia/Tokyo", "America/New_York"]) {
      const wire = fromDateInput("2026-11-18")!;
      const tenantDate = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(wire));
      expect(tenantDate).toBe("2026-11-18");
    }
  });

  it("round-trips a chosen date through the stored instant", () => {
    expect(toDateInput(fromDateInput("2026-10-19")!)).toBe("2026-10-19");
    expect(toDateInput(ADMINISTERED_AT)).toBe("2026-10-19");
  });

  it("treats an empty or malformed date as no value at all", () => {
    expect(fromDateInput("")).toBeNull();
    expect(fromDateInput("   ")).toBeNull();
    expect(fromDateInput("not-a-date")).toBeNull();
    expect(fromDateInput("2026-13-01")).toBeNull();
    expect(fromDateInput("2026-10")).toBeNull();
  });
});
