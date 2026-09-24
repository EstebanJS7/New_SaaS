import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClinicalWorkspace } from "./clinical-workspace";
import type { ClinicalEncounter } from "./clinical-api";

/**
 * The WU4A clinical client validates every patient and encounter id as a
 * canonical UUID before it builds a proxy path, so the workspace fixtures must
 * be valid identifiers rather than the earlier `patient-1` / `enc-1` placeholders.
 */
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";
const AMENDMENT_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";

/** Small autosave debounce so the real timer can be asserted without fake timers. */
const AUTOSAVE_MS = 30;

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

const DRAFT: ClinicalEncounter = {
  id: ENCOUNTER_ID,
  tenantId: TENANT_ID,
  patientId: PATIENT_ID,
  status: "DRAFT",
  version: 1,
  reasonForVisit: "Limping",
  anamnesis: "Started two days ago",
  diagnosis: "Soft tissue injury",
  treatmentPlan: "Rest and NSAIDs",
  internalNotes: "Owner non-compliance note",
  clientSummary: "Mild sprain summary",
  amendsEncounterId: null,
  amendmentReason: null,
  closedAt: null,
  closedByUserProfileId: null,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

const CLOSED: ClinicalEncounter = {
  ...DRAFT,
  status: "CLOSED",
  closedAt: "2026-09-12T01:00:00.000Z",
};

type Handler = (body?: Record<string, unknown>) => Response | Promise<Response>;

interface WorkflowOverrides {
  readonly list?: Handler;
  readonly create?: Handler;
  readonly save?: Handler;
  readonly close?: Handler;
  readonly amend?: Handler;
}

/**
 * URL + method aware fetch double for the staff clinical workspace. Default
 * handlers render one DRAFT encounter; overrides exercise loading/empty/error,
 * permission denial, conflicts and the close/amend commands without touching
 * the real proxy or API. The default handlers mutate a per-test in-memory
 * encounter list so a save/close/create round trip is reflected by the next
 * list read, mirroring a real server.
 */
function mockClinical(overrides: WorkflowOverrides = {}): ReturnType<typeof vi.fn> {
  const state: ClinicalEncounter[] = [{ ...DRAFT }];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (url.endsWith(`/encounters/${DRAFT.id}/close`) && method === "POST") {
      if (overrides.close) return Promise.resolve(overrides.close());
      state[0] = { ...CLOSED };
      return Promise.resolve(jsonResponse(CLOSED));
    }
    if (url.endsWith(`/encounters/${DRAFT.id}/amendments`) && method === "POST") {
      return Promise.resolve(
        overrides.amend?.() ?? jsonResponse({ ...CLOSED, id: AMENDMENT_ID }, 201)
      );
    }
    if (url.endsWith(`/encounters/${DRAFT.id}`) && method === "PUT") {
      if (overrides.save) return Promise.resolve(overrides.save(body));
      const updated: ClinicalEncounter = {
        ...DRAFT,
        ...(body as Partial<ClinicalEncounter>),
        status: state[0]?.status ?? "DRAFT",
        version: (state[0]?.version ?? 1) + 1,
      };
      state[0] = updated;
      return Promise.resolve(jsonResponse(updated));
    }
    if (url.endsWith("/encounters") && method === "POST") {
      if (overrides.create) return Promise.resolve(overrides.create(body));
      state.push({ ...DRAFT });
      return Promise.resolve(jsonResponse(DRAFT, 201));
    }
    if (url.endsWith("/encounters")) {
      return Promise.resolve(overrides.list?.() ?? jsonResponse(state));
    }
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function saveCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      resolveRequestUrl(input as RequestInfo | URL).endsWith(
        `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`
      ) && (init as RequestInit | undefined)?.method === "PUT"
  );
}

function renderWorkspace(
  options: { readonly autosaveDelayMs?: number } = {}
): ReturnType<typeof render> {
  return render(
    <TestWrapper>
      <ClinicalWorkspace
        patientId={PATIENT_ID}
        autosaveDelayMs={options.autosaveDelayMs ?? AUTOSAVE_MS}
      />
    </TestWrapper>
  );
}

/**
 * Runs the pending debounce timer inside `act` so the autosave mutation and its
 * resulting state updates are flushed before assertions.
 */
async function flushAutosave(delayMs = AUTOSAVE_MS): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs + 15));
  });
}

async function selectEncounter(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /Limping/ }));
}

describe("ClinicalWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the loading state for the encounter list", async () => {
    mockClinical({ list: () => new Promise<Response>(() => undefined) });

    renderWorkspace();

    expect(await screen.findByText("Loading clinical records...")).toBeInTheDocument();
  });

  it("renders the empty state with a create affordance", async () => {
    mockClinical({ list: () => jsonResponse([]) });

    renderWorkspace();

    expect(await screen.findByText("No clinical encounters yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New encounter" })).toBeEnabled();
  });

  it("renders a draft encounter and its status badge", async () => {
    mockClinical();

    renderWorkspace();

    expect(await screen.findByText("Limping")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("surfaces a generic API error state", async () => {
    mockClinical({
      list: () => jsonResponse({ error: { code: "INTERNAL", message: "Boom" } }, 500),
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    });
  });

  it("renders the permission-denied state on 403 FORBIDDEN", async () => {
    mockClinical({
      list: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to manage clinical records.")
      ).toBeInTheDocument();
    });
  });

  it("creates a draft encounter and opens its editor", async () => {
    const encounters: ClinicalEncounter[] = [];
    mockClinical({
      list: () => jsonResponse(encounters),
      create: () => {
        encounters.push(DRAFT);
        return jsonResponse(DRAFT, 201);
      },
    });

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "New encounter" }));

    expect(await screen.findByText("Draft encounter created.")).toBeInTheDocument();
    expect(await screen.findByText(`Encounter ${ENCOUNTER_ID.slice(0, 8)}`)).toBeInTheDocument();
  });

  it("announces create success in a live status region", async () => {
    mockClinical({ list: () => jsonResponse([]) });

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "New encounter" }));

    const status = await screen.findByText("Draft encounter created.");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("marks the selected encounter with aria-current", async () => {
    mockClinical();

    renderWorkspace();

    const item = await screen.findByRole("button", { name: /Limping/ });
    expect(item).not.toHaveAttribute("aria-current");

    fireEvent.click(item);

    expect(item).toHaveAttribute("aria-current", "true");
  });

  it("autosaves a draft after the debounce with the last-read version", async () => {
    const fetchMock = mockClinical();

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "Updated diagnosis" },
    });

    // No write happens before the debounce window closes.
    expect(saveCalls(fetchMock)).toHaveLength(0);

    await flushAutosave();

    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    const calls = saveCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0]?.[1] as RequestInit).body as string)).toMatchObject({
      version: 1,
      diagnosis: "Updated diagnosis",
    });
    expect(screen.getByLabelText("Diagnosis")).toHaveValue("Updated diagnosis");
  });

  it("coalesces rapid edits into a single autosave", async () => {
    const fetchMock = mockClinical();

    renderWorkspace();
    await selectEncounter();
    const diagnosis = await screen.findByLabelText("Diagnosis");
    fireEvent.change(diagnosis, { target: { value: "One" } });
    fireEvent.change(diagnosis, { target: { value: "Two" } });
    fireEvent.change(diagnosis, { target: { value: "Three" } });

    await flushAutosave();

    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(1);
  });

  it("does not autosave when the draft is reverted to the server value", async () => {
    const fetchMock = mockClinical();

    renderWorkspace();
    await selectEncounter();
    const diagnosis = await screen.findByLabelText("Diagnosis");
    fireEvent.change(diagnosis, { target: { value: "Temporary" } });
    fireEvent.change(diagnosis, { target: { value: "Soft tissue injury" } });

    await flushAutosave();

    expect(saveCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("surfaces an autosave conflict, preserves edits, and clears it on reload", async () => {
    let version = 1;
    let attempt = 0;
    let diagnosis: string | null = "Soft tissue injury";
    mockClinical({
      list: () => jsonResponse([{ ...DRAFT, version }]),
      save: (body) => {
        attempt += 1;
        if (attempt === 1) {
          return jsonResponse(
            {
              error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
            },
            409
          );
        }
        version = 2;
        diagnosis = (body?.diagnosis as string | undefined) ?? diagnosis;
        return jsonResponse({ ...DRAFT, version, diagnosis });
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "Unsaved diagnosis" },
    });
    await flushAutosave();

    expect(
      await screen.findByText(
        "This record changed on the server. Reload the latest version before saving again."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis")).toHaveValue("Unsaved diagnosis");

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() => {
      expect(
        screen.queryByText(
          "This record changed on the server. Reload the latest version before saving again."
        )
      ).not.toBeInTheDocument();
    });

    await flushAutosave();

    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("suspends autosave across a delayed conflict reload and adopts the refreshed version", async () => {
    let serverVersion = 1;
    let listCalls = 0;
    let releaseReload: (() => void) | undefined;
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    let saveAttempts = 0;
    const savedBodies: Record<string, unknown>[] = [];

    const fetchMock = mockClinical({
      list: async () => {
        listCalls += 1;
        if (listCalls > 1) await reloadGate;
        return jsonResponse([{ ...DRAFT, version: serverVersion }]);
      },
      save: (body) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          // A concurrent writer advanced the server version before our write.
          serverVersion = 2;
          return jsonResponse(
            {
              error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
            },
            409
          );
        }
        savedBodies.push(body ?? {});
        serverVersion += 1;
        return jsonResponse({
          ...DRAFT,
          version: serverVersion,
          diagnosis: body?.diagnosis as string | null,
        });
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "Edited locally" },
    });
    await flushAutosave();

    expect(await screen.findByText(/changed on the server/)).toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    // The refetch is still pending: no stale-version write may fire yet.
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      releaseReload?.();
      await reloadGate;
      await Promise.resolve();
    });

    await flushAutosave();
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(2));
    expect(savedBodies[0]).toMatchObject({ version: 2, diagnosis: "Edited locally" });
  });

  it("cancels a pending autosave when the editor unmounts", async () => {
    const fetchMock = mockClinical();
    const view = renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "Never persisted" },
    });

    view.unmount();
    await flushAutosave();

    expect(saveCalls(fetchMock)).toHaveLength(0);
  });

  it("does not clobber a newer local edit when a save resolves in flight", async () => {
    // A single mutable server row backs both doubles, so a refetch after a save
    // returns what the save wrote instead of an unrelated seed row. That makes
    // the test assert the guard, not a contradiction between its own doubles.
    let serverRow: ClinicalEncounter = { ...DRAFT };
    let saveAttempts = 0;
    let releaseFirstSave: (() => void) | undefined;
    let releaseSecondSave: (() => void) | undefined;
    const savedBodies: Record<string, unknown>[] = [];

    const fetchMock = mockClinical({
      list: () => jsonResponse([{ ...serverRow }]),
      save: (body) => {
        saveAttempts += 1;
        const submitted = body ?? {};
        if (saveAttempts === 1) {
          return new Promise<Response>((resolve) => {
            releaseFirstSave = () => {
              serverRow = {
                ...serverRow,
                version: serverRow.version + 1,
                diagnosis: submitted.diagnosis as string | null,
              };
              resolve(jsonResponse({ ...serverRow }));
            };
          });
        }
        savedBodies.push(submitted);
        // Gate the follow-up save so the assertion below cannot race its echo
        // and refetch: it is released only after the field is asserted.
        return new Promise<Response>((resolve) => {
          releaseSecondSave = () => {
            serverRow = {
              ...serverRow,
              version: serverRow.version + 1,
              diagnosis: submitted.diagnosis as string | null,
            };
            resolve(jsonResponse({ ...serverRow }));
          };
        });
      },
    });

    renderWorkspace();
    await selectEncounter();
    const diagnosis = await screen.findByLabelText("Diagnosis");
    fireEvent.change(diagnosis, { target: { value: "First edit" } });
    await flushAutosave();

    expect(saveCalls(fetchMock)).toHaveLength(1);

    // A newer local edit lands while the first write is still in flight.
    fireEvent.change(diagnosis, { target: { value: "Second edit" } });

    await act(async () => {
      releaseFirstSave?.();
      await Promise.resolve();
    });

    // Wait for the first save's echo to be processed, then assert the stale echo
    // ("First edit") did not replace the newer local edit. The follow-up save is
    // still gated, so this cannot be satisfied by a later write restoring it.
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis")).toHaveValue("Second edit");

    await flushAutosave();
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(2));
    await act(async () => {
      releaseSecondSave?.();
      await Promise.resolve();
    });
    expect(savedBodies[0]).toMatchObject({ diagnosis: "Second edit", version: 2 });
  });

  it("does not revert the draft when an older-version refetch lands after a newer save", async () => {
    const staleRow: ClinicalEncounter = { ...DRAFT, version: 1 };
    let listCalls = 0;
    let releaseStaleRefetch: (() => void) | undefined;
    const staleRefetchGate = new Promise<void>((resolve) => {
      releaseStaleRefetch = resolve;
    });

    mockClinical({
      // The first read seeds the draft. The post-save refetch is held open and
      // then resolves with the pre-save row, simulating an out-of-order response
      // that is older than the version the save already applied.
      list: async () => {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse([{ ...DRAFT }]);
        await staleRefetchGate;
        return jsonResponse([{ ...staleRow }]);
      },
      save: (body) =>
        jsonResponse({
          ...DRAFT,
          version: 2,
          diagnosis: body?.diagnosis as string | null,
        }),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "Edited locally" },
    });
    await flushAutosave();

    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    // The save echo advanced the editor to version 2.
    await waitFor(() => expect(screen.getByText(/Version 2/)).toBeInTheDocument());
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));

    await act(async () => {
      releaseStaleRefetch?.();
      await staleRefetchGate;
    });

    // The stale refetch regressed the query data back to version 1...
    await waitFor(() => expect(screen.getByText(/Version 1/)).toBeInTheDocument());
    // ...but the monotonic guard must keep the newer draft in place.
    expect(screen.getByLabelText("Diagnosis")).toHaveValue("Edited locally");
  });

  it("sends the newer applied version on the next edit after an older-version refetch", async () => {
    const staleRow: ClinicalEncounter = { ...DRAFT, version: 1 };
    let listCalls = 0;
    let releaseStaleRefetch: (() => void) | undefined;
    const staleRefetchGate = new Promise<void>((resolve) => {
      releaseStaleRefetch = resolve;
    });
    const savedBodies: Record<string, unknown>[] = [];

    mockClinical({
      // Same out-of-order refetch as the test above: the post-save read is held
      // and then resolves with the pre-save row.
      list: async () => {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse([{ ...DRAFT }]);
        await staleRefetchGate;
        return jsonResponse([{ ...staleRow }]);
      },
      save: (body) => {
        savedBodies.push(body ?? {});
        return jsonResponse({
          ...DRAFT,
          version: 2,
          diagnosis: body?.diagnosis as string | null,
        });
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "First edit" },
    });
    await flushAutosave();

    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Version 2/)).toBeInTheDocument());
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));

    await act(async () => {
      releaseStaleRefetch?.();
      await staleRefetchGate;
    });

    // The stale refetch regressed the LIST row back to version 1...
    await waitFor(() => expect(screen.getByText(/Version 1/)).toBeInTheDocument());

    // ...but the next edit must NOT submit that stale version: the ref the
    // mutation reads stayed at the applied version 2.
    fireEvent.change(screen.getByLabelText("Diagnosis"), {
      target: { value: "Second edit" },
    });
    await flushAutosave();

    await waitFor(() => expect(savedBodies).toHaveLength(2));
    expect(savedBodies[1]).toMatchObject({ version: 2, diagnosis: "Second edit" });
  });

  it("refuses to install an older-version row on a conflict reload", async () => {
    // The list answers differ per read: the seed (v1), the post-save echo (v2),
    // and the conflict reload, whose out-of-order fetch resolves with a row
    // OLDER than the version the successful save already applied. The reload is
    // only reachable through the conflict flow, so the plain refetch tests above
    // cannot exercise it.
    const autosaveDelayMs = 120;
    let listCalls = 0;
    let saveAttempts = 0;
    const conflictBody = {
      error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
    };

    const fetchMock = mockClinical({
      list: () => {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse([{ ...DRAFT }]); // seed: version 1
        if (listCalls === 2) {
          return jsonResponse([{ ...DRAFT, version: 2, diagnosis: "Saved edit" }]);
        }
        // Conflict reload: same id, OLDER version and older content.
        if (listCalls === 3) {
          return jsonResponse([{ ...DRAFT, diagnosis: "Stale server text" }]);
        }
        return jsonResponse([{ ...DRAFT, version: 3, diagnosis: "Saved edit" }]);
      },
      save: (body) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return jsonResponse({
            ...DRAFT,
            version: 2,
            diagnosis: body?.diagnosis as string | null,
          });
        }
        // A concurrent writer advanced the server before our version-2 write.
        return jsonResponse(conflictBody, 409);
      },
    });

    renderWorkspace({ autosaveDelayMs });
    await selectEncounter();

    // 1) A successful save advances the applied version to 2 and makes
    //    "Saved edit" the clean baseline.
    fireEvent.change(await screen.findByLabelText("Diagnosis"), {
      target: { value: "Saved edit" },
    });
    await flushAutosave(autosaveDelayMs);
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Version 2/)).toBeInTheDocument());

    // 2) The next autosave loses the race and surfaces a conflict.
    fireEvent.change(screen.getByLabelText("Diagnosis"), { target: { value: "Pending edit" } });
    await flushAutosave(autosaveDelayMs);
    expect(await screen.findByText(/changed on the server/)).toBeInTheDocument();

    // The user discards the losing edit, so the draft is clean against the
    // applied baseline; autosave stays suspended while the conflict remains.
    fireEvent.change(screen.getByLabelText("Diagnosis"), { target: { value: "Saved edit" } });
    expect(screen.getByLabelText("Diagnosis")).toHaveValue("Saved edit");

    // 3) The conflict reload resolves with an OLDER version-1 row. The monotonic
    // guard must refuse to install it as the baseline: adopting the stale content
    // would make the clean draft look dirty and trigger a spurious write.
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() => expect(screen.getByText(/Version 1/)).toBeInTheDocument());

    await flushAutosave(autosaveDelayMs);

    // Only the successful save and the losing one were ever sent: the stale row
    // did not regress the baseline, so the draft never became dirty again.
    expect(saveCalls(fetchMock)).toHaveLength(2);
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis")).toHaveValue("Saved edit");
  });

  it("renders a denied create as permission-aware UX and disables the action", async () => {
    mockClinical({
      list: () => jsonResponse([]),
      create: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    const createButton = await screen.findByRole("button", { name: "New encounter" });
    fireEvent.click(createButton);

    expect(
      await screen.findByText("You do not have permission to manage clinical records.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New encounter" })).toBeDisabled();
  });

  it("renders a denied entitlement as permission-aware UX", async () => {
    mockClinical({
      list: () => jsonResponse([]),
      create: () =>
        jsonResponse({ error: { code: "FEATURE_NOT_ENTITLED", message: "Not entitled" } }, 403),
    });

    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "New encounter" }));

    expect(
      await screen.findByText("The veterinary module is not enabled for this tenant.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New encounter" })).toBeDisabled();
  });

  it("renders a denied draft autosave as permission-aware UX and stops retrying", async () => {
    const fetchMock = mockClinical({
      save: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnosis"), { target: { value: "Nope" } });
    await flushAutosave();

    expect(
      await screen.findByText("You do not have permission to manage clinical records.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnosis")).toBeDisabled();

    const attempts = saveCalls(fetchMock).length;
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(attempts);
  });

  it("renders a denied close as permission-aware UX and disables the action", async () => {
    mockClinical({
      close: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Close encounter" }));

    expect(
      await screen.findByText("You do not have permission to manage clinical records.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close encounter" })).toBeDisabled();
  });

  it("renders a denied amendment as permission-aware UX and disables the action", async () => {
    mockClinical({
      list: () => jsonResponse([CLOSED]),
      amend: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Amendment reason"), {
      target: { value: "Correct the diagnosis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record amendment" }));

    expect(
      await screen.findByText("You do not have permission to manage clinical records.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record amendment" })).toBeDisabled();
    expect(screen.getByLabelText("Amendment reason")).toBeDisabled();
  });

  it("closes a draft encounter and swaps to the amendment form", async () => {
    let status: ClinicalEncounter["status"] = "DRAFT";
    const fetchMock = mockClinical({
      list: () => jsonResponse([{ ...DRAFT, status }]),
      close: () => {
        status = "CLOSED";
        return jsonResponse(CLOSED);
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Close encounter" }));

    expect(await screen.findByText("Encounter closed.")).toBeInTheDocument();
    expect(await screen.findByText("Amend closed encounter")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/close`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("records an amendment for a closed encounter", async () => {
    const fetchMock = mockClinical({ list: () => jsonResponse([CLOSED]) });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Amendment reason"), {
      target: { value: "Correct the diagnosis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record amendment" }));

    expect(await screen.findByText("Amendment recorded.")).toBeInTheDocument();

    const amendCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        resolveRequestUrl(input as RequestInfo | URL).endsWith(
          `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/amendments`
        ) && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(amendCall).toBeDefined();
    expect(JSON.parse((amendCall?.[1] as RequestInit).body as string)).toEqual({
      reason: "Correct the diagnosis",
    });
  });

  it("keeps staff internal notes out of the client summary region", async () => {
    mockClinical();

    renderWorkspace();
    await selectEncounter();

    const staffNotes = await screen.findByTestId("staff-internal-notes");
    expect(within(staffNotes).getByDisplayValue("Owner non-compliance note")).toBeInTheDocument();

    const summary = screen.getByLabelText("Client summary");
    expect(summary).toHaveValue("Mild sprain summary");
    expect(summary).not.toHaveValue("Owner non-compliance note");
  });
});
