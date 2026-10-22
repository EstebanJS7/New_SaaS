import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportsIndex } from "./imports-index";
import type { ImportJob } from "./imports-api";

/**
 * The imports index ([[IMP-005]]).
 *
 * What these cases pin, in the order an operator meets them: the file is uploaded
 * with the entity the selector names, the server's refusal is shown in ITS OWN
 * words, the history lists what happened and offers exactly the command the state
 * allows, the entity filter narrows the read, and the non-happy states (empty,
 * error, permission-denied, and a refused command) each render as themselves.
 * `imports.run` hides the upload and the commands; `imports.read` hides the
 * history.
 *
 * The surface is exercised against a STUBBED BFF, not a stubbed component: every
 * assertion below is about the request it builds and the state it renders, which
 * is the only way a component test can say anything true about either.
 */

/**
 * The API's by-name refusal of a spreadsheet, copied verbatim from
 * `IMPORT_ARTEFACT_SPREADSHEET_MESSAGE` in
 * `apps/api/src/imports/import-artefact.pipe.ts`. Asserted against the rendered
 * alert to prove the surface prints the SERVER's sentence and not a paraphrase of
 * its own.
 */
const SPREADSHEET_REFUSAL =
  "Spreadsheet uploads are not supported: export the data as CSV. The accepted format is CSV (text/csv).";

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const UPLOADED_JOB: ImportJob = {
  id: IMPORT_ID,
  entity: "CUSTOMER",
  state: "UPLOADED",
  contentType: "text/csv",
  byteSize: 120,
  createdCount: 0,
  failedCount: 0,
  suspectedDuplicateCount: 0,
  previewedAt: null,
  committedAt: null,
  failedAt: null,
  failureReason: null,
  artefactExpiresAt: "2026-10-25T10:00:00.000Z",
  artefactDeletedAt: null,
  createdAt: "2026-10-22T09:59:00.000Z",
  updatedAt: "2026-10-22T09:59:00.000Z",
};

const PREVIEWED_JOB: ImportJob = {
  ...UPLOADED_JOB,
  id: OTHER_ID,
  entity: "PATIENT",
  state: "PREVIEWED",
  createdCount: 3,
  failedCount: 1,
  suspectedDuplicateCount: 1,
  previewedAt: "2026-10-22T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function installFetch(handler: Handler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(resolveUrl(input), init))
  );
  global.fetch = fetchMock;
  return fetchMock;
}

/** The URLs the surface asked for, in order. */
function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => (call as unknown as [string])[0]);
}

function renderIndex(permissions?: readonly string[]): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ImportsIndex permissions={permissions} />
    </QueryClientProvider>
  );
}

/** Selects a file in the picker, the way a browser does. */
function chooseFile(name = "customers.csv"): File {
  const file = new File(["name,document_number\n"], name, { type: "text/csv" });
  fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportsIndex · the upload", () => {
  it("uploads the selected file for the chosen entity and links to the accepted import", async () => {
    let jobs: readonly ImportJob[] = [];
    const fetchMock = installFetch((url, init) => {
      if (init?.method === "POST" && url === "/api/imports") {
        jobs = [UPLOADED_JOB];
        return jsonResponse({ importId: IMPORT_ID, state: "UPLOADED" }, 201);
      }
      return jsonResponse(jobs);
    });

    renderIndex();

    // The history starts empty, and says so rather than rendering an empty table.
    expect(await screen.findByTestId("imports-empty")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Import entity"), { target: { value: "PATIENT" } });
    const file = chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    // The multipart body carries the entity the selector named and the file the
    // picker handed over. The browser writes the boundary; nothing here sets it.
    await waitFor(() => {
      expect(requestedUrls(fetchMock)).toContain("/api/imports");
    });
    // The list read is also `/api/imports`, so the upload is the call that also
    // declares a POST.
    const uploadCall = fetchMock.mock.calls.find((call) => {
      const [url, init] = call as unknown as [string, RequestInit | undefined];
      return url === "/api/imports" && init?.method === "POST";
    }) as unknown as [string, RequestInit];
    expect(uploadCall[1].method).toBe("POST");
    const body = uploadCall[1].body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("entity")).toBe("PATIENT");
    expect(((body as FormData).get("file") as File).name).toBe(file.name);
    // No hand-written content-type: `fetch` must write the multipart boundary.
    expect(uploadCall[1].headers).toBeUndefined();

    // The accepted panel states the phase the API answered with — never a summary
    // the request cannot have yet — and links to the import to watch.
    const accepted = await screen.findByTestId("imports-upload-accepted");
    expect(accepted).toHaveTextContent("UPLOADED");
    expect(screen.getByTestId("imports-upload-accepted-link")).toHaveAttribute(
      "href",
      `/app/imports/${IMPORT_ID}`
    );

    // The history is invalidated, so the new import appears without a reload.
    const row = await screen.findByTestId("imports-row");
    expect(within(row).getByTestId("imports-row-state")).toHaveTextContent("UPLOADED");
    expect(within(row).getByTestId("imports-row-action")).toHaveTextContent("Preview");
  });

  it("shows the server's own refusal verbatim instead of duplicating the rule", async () => {
    installFetch((_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(
          { error: { code: "VALIDATION_FAILED", message: SPREADSHEET_REFUSAL } },
          400
        );
      }
      return jsonResponse([]);
    });

    renderIndex();
    await screen.findByTestId("imports-empty");

    chooseFile("customers.xlsx");
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    const alert = await screen.findByTestId("imports-upload-error");
    // The exact sentence the API sends — "export the data as CSV" and all. A
    // client-side copy of the rule could only paraphrase it.
    expect(alert).toHaveTextContent(SPREADSHEET_REFUSAL);
  });

  it("keeps the upload disabled until a file is chosen", async () => {
    installFetch(() => jsonResponse([]));
    renderIndex();
    await screen.findByTestId("imports-empty");

    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    chooseFile();
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  });
});

describe("ImportsIndex · the history", () => {
  it("lists each import with its counters, instant and the next action its state allows", async () => {
    installFetch(() => jsonResponse([UPLOADED_JOB, PREVIEWED_JOB]));

    renderIndex();

    const rows = await screen.findAllByTestId("imports-row");
    expect(rows).toHaveLength(2);

    const uploaded = rows[0];
    expect(uploaded).toHaveTextContent("Customers");
    expect(within(uploaded).getByTestId("imports-row-state")).toHaveTextContent("UPLOADED");
    // The counters are the API's own numbers, printed as given.
    expect(within(uploaded).getByTestId("imports-row-created")).toHaveTextContent("0");
    expect(within(uploaded).getByTestId("imports-row-failed")).toHaveTextContent("0");
    expect(within(uploaded).getByTestId("imports-row-suspected")).toHaveTextContent("0");
    expect(uploaded).toHaveTextContent(UPLOADED_JOB.createdAt);
    expect(within(uploaded).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(within(uploaded).queryByRole("button", { name: "Commit" })).not.toBeInTheDocument();

    const previewed = rows[1];
    expect(previewed).toHaveTextContent("Patients");
    expect(within(previewed).getByTestId("imports-row-state")).toHaveTextContent("PREVIEWED");
    expect(within(previewed).getByTestId("imports-row-created")).toHaveTextContent("3");
    expect(within(previewed).getByTestId("imports-row-failed")).toHaveTextContent("1");
    // A suspected duplicate is a SUBSET of the created count, never a third bucket.
    expect(within(previewed).getByTestId("imports-row-suspected")).toHaveTextContent("1");
    expect(within(previewed).getByRole("button", { name: "Commit" })).toBeInTheDocument();
    expect(within(previewed).queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    // The row links to the import, which is where it is watched and read.
    expect(within(previewed).getByTestId("imports-row-open")).toHaveAttribute(
      "href",
      `/app/imports/${OTHER_ID}`
    );
  });

  it("issues the command the state allows and shows the phase it was accepted into", async () => {
    const fetchMock = installFetch((url, init) => {
      if (init?.method === "POST" && url === `/api/imports/${OTHER_ID}/commit`) {
        return jsonResponse({ importId: OTHER_ID, state: "COMMITTING" }, 202);
      }
      return jsonResponse([PREVIEWED_JOB]);
    });

    renderIndex();

    const row = await screen.findByTestId("imports-row");
    fireEvent.click(within(row).getByRole("button", { name: "Commit" }));

    // The command is the import's own sub-path: no body, no state parameter.
    const commitCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (entry) => (entry as unknown as [string])[0] === `/api/imports/${OTHER_ID}/commit`
      );
      expect(call).toBeDefined();
      return call as unknown as [string, RequestInit];
    });
    expect(commitCall[1].method).toBe("POST");
    expect(commitCall[1].body).toBeUndefined();

    // The row reads the phase the API ACCEPTED (the worker has not claimed it yet),
    // and the command that would replay it is gone.
    await waitFor(() => {
      expect(within(row).getByTestId("imports-row-state")).toHaveTextContent("COMMITTING");
    });
    expect(within(row).queryByRole("button", { name: "Commit" })).not.toBeInTheDocument();
  });

  it("offers no command on a terminal import", async () => {
    installFetch(() =>
      jsonResponse([
        { ...PREVIEWED_JOB, state: "COMMITTED", committedAt: "2026-10-22T10:05:00.000Z" },
      ])
    );

    renderIndex();

    const row = await screen.findByTestId("imports-row");
    expect(within(row).getByTestId("imports-row-state")).toHaveTextContent("COMMITTED");
    expect(within(row).queryByTestId("imports-row-action")).not.toBeInTheDocument();
    // The row is still reachable: the summary is what an operator keeps.
    expect(within(row).getByTestId("imports-row-open")).toBeInTheDocument();
  });

  it("narrows the read to one entity through ?entity=", async () => {
    const fetchMock = installFetch(() => jsonResponse([PREVIEWED_JOB]));

    renderIndex();
    await screen.findByTestId("imports-row");
    expect(fetchMock).toHaveBeenCalledWith("/api/imports", { cache: "no-store" });

    fireEvent.change(screen.getByLabelText("Filter by entity"), { target: { value: "PATIENT" } });

    // The filter is the API's own query parameter, so the narrowed list is what the
    // server says it is rather than what this screen would slice to.
    await waitFor(() => {
      expect(requestedUrls(fetchMock)).toContain("/api/imports?entity=PATIENT");
    });
  });

  it("says the tenant has no imports for a filtered entity", async () => {
    installFetch(() => jsonResponse([]));

    renderIndex();
    await screen.findByTestId("imports-empty");

    fireEvent.change(screen.getByLabelText("Filter by entity"), { target: { value: "PATIENT" } });

    await waitFor(() => {
      expect(screen.getByTestId("imports-empty")).toHaveTextContent(
        "This tenant has not run an import for Patients."
      );
    });
  });

  it("shows the API's own message when the history cannot be read", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "The imports could not be read." } },
        500
      )
    );

    renderIndex();

    const alert = await screen.findByTestId("imports-error");
    expect(alert).toHaveTextContent("The imports could not be read.");
  });

  it("shows a permission-denied panel when the API refuses the read", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions for this operation." } },
        403
      )
    );

    renderIndex();

    expect(await screen.findByTestId("imports-permission-denied")).toBeInTheDocument();
    // A refusal is not an outage: the generic error panel is not what is shown.
    expect(screen.queryByTestId("imports-error")).not.toBeInTheDocument();
  });

  it("shows the API's own message when a command is refused", async () => {
    installFetch((_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "The import is not in a state that allows this transition.",
            },
          },
          409
        );
      }
      return jsonResponse([PREVIEWED_JOB]);
    });

    renderIndex();

    const row = await screen.findByTestId("imports-row");
    fireEvent.click(within(row).getByRole("button", { name: "Commit" }));

    const alert = await screen.findByTestId("imports-command-error");
    expect(alert).toHaveTextContent("The import is not in a state that allows this transition.");
    // The refusal leaves the row exactly where it was: nothing is optimistically
    // advanced on a command the API rejected.
    expect(within(row).getByTestId("imports-row-state")).toHaveTextContent("PREVIEWED");
  });
});

describe("ImportsIndex · the permission gate", () => {
  it("hides the upload and the commands without imports.run, and still lists the history", async () => {
    installFetch(() => jsonResponse([UPLOADED_JOB, PREVIEWED_JOB]));

    renderIndex(["imports.read"]);

    const rows = await screen.findAllByTestId("imports-row");
    expect(rows).toHaveLength(2);
    // HIDDEN, not disabled: an operator who may not run an import is not shown a
    // control that would be refused.
    expect(screen.queryByTestId("imports-upload")).not.toBeInTheDocument();
    expect(screen.queryByTestId("imports-row-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    // The history itself is readable with only `imports.read`.
    expect(screen.getByTestId("imports-history")).toBeInTheDocument();
  });

  it("hides the history without imports.read and asks the API for nothing", async () => {
    const fetchMock = installFetch(() => jsonResponse([]));

    renderIndex(["imports.run"]);

    expect(await screen.findByTestId("imports-permission-denied")).toBeInTheDocument();
    // The upload is still available: running an import does not require reading the
    // whole history.
    expect(screen.getByTestId("imports-upload")).toBeInTheDocument();
    // No request is issued that the API would refuse anyway.
    expect(requestedUrls(fetchMock)).not.toContain("/api/imports");
  });
});
