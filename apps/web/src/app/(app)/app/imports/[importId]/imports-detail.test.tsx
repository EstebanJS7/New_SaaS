import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportsDetail } from "./imports-detail";
import {
  IMPORT_SUMMARY_MAX_PAGE_SIZE,
  IMPORT_SUMMARY_PAGE_SIZE,
  type ImportJob,
  type ImportJobState,
  type ImportRowOutcome,
  type ImportSummary,
  type ImportSummaryPage,
} from "../imports-api";
import { summaryRowTotal } from "../imports-display";

/**
 * One import's detail screen ([[IMP-005]]).
 *
 * The cases are grouped by the four claims the Story makes about this screen, in
 * the order they can go wrong:
 *
 * 1. **The verdict is the server's** — the row table prints `rowNumber`,
 *    `status`, `reasonCode` and `message` exactly as stored, and an ERROR and a
 *    suspected-duplicate WARNING are distinguishable in TEXT rather than only by
 *    colour.
 * 2. **The table is bounded and paginated** — a page never exceeds the summary's
 *    own ceiling, and the pager asks for the next `offset` instead of rendering
 *    every row.
 * 3. **The summary survives a reload** — it renders from the stored outcomes on a
 *    fresh mount, not from whatever a mutation returned.
 * 4. **Polling stops** — the screen re-reads the import while it is `PREVIEWING`,
 *    and after the state becomes `PREVIEWED` it issues NO further reads. The stop
 *    is asserted against the request count, not against the absence of a spinner.
 *
 * The poll interval is shortened through the documented prop so the assertions do
 * not wait two seconds each, and they never read a clock.
 */

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";

/** Short enough for a fast test, long enough that a stray timer is observable. */
const POLL_MS = 20;

const BASE_JOB: ImportJob = {
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

const TOTALS = { createdCount: 3, failedCount: 1, suspectedDuplicateCount: 1 };

/**
 * The three verdicts every happy-path case below uses: an accepted row with a
 * suspected-duplicate WARNING, an accepted row with nothing to report, and a FAILED
 * row with its reason. The last two rows are the Story's distinction.
 */
const OUTCOMES: readonly ImportRowOutcome[] = [
  {
    importId: IMPORT_ID,
    rowNumber: 1,
    status: "CREATE",
    reasonCode: null,
    message: null,
    suspectedDuplicate: true,
  },
  {
    importId: IMPORT_ID,
    rowNumber: 2,
    status: "CREATE",
    reasonCode: null,
    message: null,
    suspectedDuplicate: false,
  },
  {
    importId: IMPORT_ID,
    rowNumber: 3,
    status: "FAILED",
    reasonCode: "CUSTOMER_ROW_DOCUMENT_DUPLICATE",
    message: "The document number already exists for another customer.",
    suspectedDuplicate: false,
  },
];

function jobWith(overrides: Partial<ImportJob>): ImportJob {
  return { ...BASE_JOB, ...overrides };
}

const PREVIEWED_JOB = jobWith({
  state: "PREVIEWED",
  createdCount: 3,
  failedCount: 1,
  suspectedDuplicateCount: 1,
  previewedAt: "2026-10-22T10:00:00.000Z",
});

function summaryWith(
  rows: readonly ImportRowOutcome[],
  overrides: Partial<ImportSummary> = {}
): ImportSummary {
  return {
    importId: IMPORT_ID,
    state: "PREVIEWED",
    totals: TOTALS,
    page: { limit: IMPORT_SUMMARY_PAGE_SIZE, offset: 0 },
    rows,
    ...overrides,
  };
}

/** A page of `size` generic accepted rows starting at the page's offset. */
function storedPage(page: ImportSummaryPage, total: number): readonly ImportRowOutcome[] {
  const size = Math.max(0, Math.min(page.limit, total - page.offset));
  return Array.from({ length: size }, (_, index) => ({
    importId: IMPORT_ID,
    rowNumber: page.offset + index + 1,
    status: "CREATE" as const,
    reasonCode: null,
    message: null,
    suspectedDuplicate: false,
  }));
}

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

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => (call as unknown as [string])[0]);
}

/** The reads of the import itself — the polls, not the summary. */
function detailReads(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return requestedUrls(fetchMock).filter((url) => url === `/api/imports/${IMPORT_ID}`);
}

function renderDetail(overrides: Partial<Parameters<typeof ImportsDetail>[0]> = {}): {
  readonly unmount: () => void;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <ImportsDetail importId={IMPORT_ID} pollIntervalMs={POLL_MS} {...overrides} />
    </QueryClientProvider>
  );
  return { unmount };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportsDetail · the stored verdicts", () => {
  it("renders the state, the counters and every row's number, status, reason and message", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    renderDetail();

    expect(await screen.findByTestId("imports-state")).toHaveTextContent("PREVIEWED");
    expect(screen.getByTestId("imports-entity")).toHaveTextContent("Customers");
    // The three counters are the import's own; a suspected duplicate is a SUBSET of
    // the created count and is never rendered as a fourth bucket.
    expect(screen.getByTestId("imports-created")).toHaveTextContent("3");
    expect(screen.getByTestId("imports-failed")).toHaveTextContent("1");
    expect(screen.getByTestId("imports-suspected")).toHaveTextContent("1");
    expect(screen.getByTestId("imports-created-at")).toHaveTextContent(BASE_JOB.createdAt);

    const rows = await screen.findAllByTestId("imports-outcome-row");
    expect(rows).toHaveLength(3);

    const failed = rows[2];
    expect(within(failed).getByTestId("imports-outcome-row-number")).toHaveTextContent("3");
    expect(within(failed).getByTestId("imports-outcome-status")).toHaveTextContent("FAILED");
    expect(within(failed).getByTestId("imports-outcome-reason")).toHaveTextContent(
      "CUSTOMER_ROW_DOCUMENT_DUPLICATE"
    );
    expect(within(failed).getByTestId("imports-outcome-message")).toHaveTextContent(
      "The document number already exists for another customer."
    );
  });

  it("distinguishes an ERROR from a suspected-duplicate WARNING in text, not in colour", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    renderDetail();
    const rows = await screen.findAllByTestId("imports-outcome-row");

    const flagged = rows[0];
    const failed = rows[2];

    // A flagged row was still CREATED, and it says so twice: the status is the
    // server's `CREATE` and the warning column spells the warning out.
    expect(within(flagged).getByTestId("imports-outcome-status")).toHaveTextContent("CREATE");
    expect(within(flagged).getByTestId("imports-outcome-warning")).toHaveTextContent(
      "Suspected duplicate (warning)"
    );
    expect(flagged).toHaveTextContent("Suspected duplicate");
    // It is not an error, and it carries no reason.
    expect(flagged).not.toHaveTextContent("FAILED");

    // A failed row is a different fact: a verdict, a reason code and a message.
    expect(within(failed).getByTestId("imports-outcome-status")).toHaveTextContent("FAILED");
    expect(failed).toHaveTextContent("CUSTOMER_ROW_DOCUMENT_DUPLICATE");
    // …and it is not a duplicate warning.
    expect(failed).not.toHaveTextContent("Suspected duplicate");

    // An unflagged row reports neither fact.
    const plain = rows[1];
    expect(within(plain).getByTestId("imports-outcome-warning")).toHaveTextContent("—");
  });

  it("shows the message a failed import carries", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith([], { state: "FAILED", totals: TOTALS }));
      }
      return jsonResponse(
        jobWith({
          state: "FAILED",
          failedAt: "2026-10-22T10:02:00.000Z",
          failureReason: "The artifact could not be read.",
        })
      );
    });

    renderDetail();

    const reason = await screen.findByTestId("imports-failure-reason");
    expect(reason).toHaveTextContent("The artifact could not be read.");
    expect(screen.getByTestId("imports-state")).toHaveTextContent("FAILED");
  });

  it("says an unpreviewed import has no stored outcomes yet", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(
          summaryWith([], {
            state: "UPLOADED",
            totals: { createdCount: 0, failedCount: 0, suspectedDuplicateCount: 0 },
          })
        );
      }
      return jsonResponse(BASE_JOB);
    });

    renderDetail();

    expect(await screen.findByTestId("imports-summary-empty")).toHaveTextContent(
      "the file has not been previewed"
    );
    expect(screen.queryByTestId("imports-outcome-row")).not.toBeInTheDocument();
  });
});

describe("ImportsDetail · the bounded table", () => {
  it("asks for one page inside the summary's ceiling and pages by offset", async () => {
    // The page size this surface asks for must never exceed the API's own ceiling:
    // an oversized limit is REFUSED there rather than truncated, so a page size
    // above it would be a permanently broken screen.
    expect(IMPORT_SUMMARY_PAGE_SIZE).toBeLessThanOrEqual(IMPORT_SUMMARY_MAX_PAGE_SIZE);

    const totals = { createdCount: 250, failedCount: 5, suspectedDuplicateCount: 0 };
    const total = summaryRowTotal(totals);
    const fetchMock = installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        const search = new URLSearchParams(url.slice(url.indexOf("?") + 1));
        const page = {
          limit: Number(search.get("limit")),
          offset: Number(search.get("offset")),
        };
        return jsonResponse({
          importId: IMPORT_ID,
          state: "COMMITTED",
          totals,
          page,
          rows: storedPage(page, total),
        });
      }
      return jsonResponse(jobWith({ state: "COMMITTED", ...totals }));
    });

    renderDetail();

    // A 255-row import renders ONE page of it, never 255 rows.
    await waitFor(() => {
      expect(screen.getAllByTestId("imports-outcome-row")).toHaveLength(IMPORT_SUMMARY_PAGE_SIZE);
    });
    expect(requestedUrls(fetchMock)).toContain(
      `/api/imports/${IMPORT_ID}/summary?limit=${IMPORT_SUMMARY_PAGE_SIZE}&offset=0`
    );
    expect(screen.getByTestId("imports-summary-page")).toHaveTextContent("Rows 1–100 of 255");
    expect(screen.getByTestId("imports-summary-previous")).toBeDisabled();

    fireEvent.click(screen.getByTestId("imports-summary-next"));

    await waitFor(() => {
      expect(requestedUrls(fetchMock)).toContain(
        `/api/imports/${IMPORT_ID}/summary?limit=${IMPORT_SUMMARY_PAGE_SIZE}&offset=100`
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("imports-summary-page")).toHaveTextContent("Rows 101–200 of 255");
    });
    expect(screen.getAllByTestId("imports-outcome-row")).toHaveLength(IMPORT_SUMMARY_PAGE_SIZE);
    expect(screen.getByTestId("imports-summary-previous")).toBeEnabled();
  });

  it("disables the next page once the last stored row is on screen", async () => {
    const totals = { createdCount: 12, failedCount: 1, suspectedDuplicateCount: 0 };
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        const search = new URLSearchParams(url.slice(url.indexOf("?") + 1));
        const page = { limit: Number(search.get("limit")), offset: Number(search.get("offset")) };
        return jsonResponse({
          importId: IMPORT_ID,
          state: "COMMITTED",
          totals,
          page,
          rows: storedPage(page, summaryRowTotal(totals)),
        });
      }
      return jsonResponse(jobWith({ state: "COMMITTED", ...totals }));
    });

    renderDetail();

    await screen.findAllByTestId("imports-outcome-row");
    expect(screen.getByTestId("imports-summary-next")).toBeDisabled();
    expect(screen.getByTestId("imports-summary-page")).toHaveTextContent("Rows 1–13 of 13");
  });
});

describe("ImportsDetail · the summary is stored data", () => {
  it("renders the row table again on a fresh mount, because it reads the stored outcomes", async () => {
    const fetchMock = installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    const first = renderDetail();
    expect(await screen.findAllByTestId("imports-outcome-row")).toHaveLength(3);
    first.unmount();

    // A reload is a fresh component with no in-memory state: everything on screen
    // had to come from the API, which is what makes the summary readable after the
    // artefact is gone.
    renderDetail();
    const rows = await screen.findAllByTestId("imports-outcome-row");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent("CUSTOMER_ROW_DOCUMENT_DUPLICATE");

    const summaryReads = requestedUrls(fetchMock).filter((url) =>
      url.startsWith(`/api/imports/${IMPORT_ID}/summary`)
    );
    expect(summaryReads).toHaveLength(2);
  });
});

describe("ImportsDetail · polling", () => {
  it("polls while PREVIEWING and STOPS once the state is PREVIEWED", async () => {
    let state: ImportJobState = "PREVIEWING";
    const fetchMock = installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(jobWith({ state }));
    });

    renderDetail();

    // The live region states the phase and that the screen is watching.
    const polling = await screen.findByTestId("imports-polling");
    expect(polling).toHaveTextContent("Previewing the file");

    // It polls: more than the first read reaches the API.
    await waitFor(() => {
      expect(detailReads(fetchMock).length).toBeGreaterThanOrEqual(2);
    });

    // The worker's claim lands, and the next poll observes it.
    state = "PREVIEWED";
    await waitFor(() => {
      expect(screen.getByTestId("imports-state")).toHaveTextContent("PREVIEWED");
    });
    // The watch is over, and the screen says nothing about a phase any more.
    expect(screen.queryByTestId("imports-polling")).not.toBeInTheDocument();

    const settledReads = detailReads(fetchMock).length;
    // Several intervals' worth of wall clock with NO further request: the timer is
    // cleared, not merely paused. This is the Story's "does not poll forever".
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));
    expect(detailReads(fetchMock)).toHaveLength(settledReads);
  });

  it("starts watching as soon as the API accepts the preview command", async () => {
    const state: ImportJobState = "UPLOADED";
    const fetchMock = installFetch((url, init) => {
      if (url === `/api/imports/${IMPORT_ID}/preview` && init?.method === "POST") {
        return jsonResponse({ importId: IMPORT_ID, state: "PREVIEWING" }, 202);
      }
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(
          summaryWith([], {
            state,
            totals: { createdCount: 0, failedCount: 0, suspectedDuplicateCount: 0 },
          })
        );
      }
      return jsonResponse(jobWith({ state }));
    });

    renderDetail();

    // An `UPLOADED` import is waiting for an OPERATOR, so it is not polled.
    const preview = await screen.findByTestId("imports-preview");
    expect(screen.queryByTestId("imports-polling")).not.toBeInTheDocument();

    fireEvent.click(preview);

    // The accepted phase is seeded from the API's own answer, so the screen is
    // already watching while the row itself still reads `UPLOADED` upstream.
    expect(await screen.findByTestId("imports-polling")).toHaveTextContent("Previewing the file");
    // …and the command that would replay it is gone.
    expect(screen.queryByTestId("imports-preview")).not.toBeInTheDocument();

    // The poller then reads again, which is what will observe the terminal state.
    await waitFor(() => {
      expect(detailReads(fetchMock).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("does not poll an import that is waiting for the operator", async () => {
    const fetchMock = installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    renderDetail();

    await screen.findByTestId("imports-commit");
    const reads = detailReads(fetchMock).length;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));
    expect(detailReads(fetchMock)).toHaveLength(reads);
  });
});

describe("ImportsDetail · the commands", () => {
  it("offers preview on UPLOADED and commit on PREVIEWED", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(
          summaryWith([], {
            state: "UPLOADED",
            totals: { createdCount: 0, failedCount: 0, suspectedDuplicateCount: 0 },
          })
        );
      }
      return jsonResponse(BASE_JOB);
    });

    renderDetail();
    expect(await screen.findByTestId("imports-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("imports-commit")).not.toBeInTheDocument();
  });

  it("offers no command on a terminal import", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES, { state: "COMMITTED" }));
      }
      return jsonResponse(jobWith({ state: "COMMITTED", ...TOTALS }));
    });

    renderDetail();

    await screen.findAllByTestId("imports-outcome-row");
    expect(screen.queryByTestId("imports-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("imports-commit")).not.toBeInTheDocument();
  });

  it("hides the commands without imports.run and still renders the outcomes", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    renderDetail({ permissions: ["imports.read"] });

    await screen.findAllByTestId("imports-outcome-row");
    // HIDDEN, not disabled — and the read itself is unaffected.
    expect(screen.queryByTestId("imports-commit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("imports-preview")).not.toBeInTheDocument();
  });

  it("shows the API's own message when the command is refused", async () => {
    installFetch((url, init) => {
      if (url === `/api/imports/${IMPORT_ID}/commit` && init?.method === "POST") {
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
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(summaryWith(OUTCOMES));
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    renderDetail();

    fireEvent.click(await screen.findByTestId("imports-commit"));

    const alert = await screen.findByTestId("imports-command-error");
    expect(alert).toHaveTextContent("The import is not in a state that allows this transition.");
    // Nothing is optimistically advanced on a command the API rejected.
    expect(screen.getByTestId("imports-state")).toHaveTextContent("PREVIEWED");
  });
});

describe("ImportsDetail · the read states", () => {
  it("shows the API's own message when the import cannot be read", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Import not found." } }, 404)
    );

    renderDetail();

    const alert = await screen.findByTestId("imports-error");
    expect(alert).toHaveTextContent("Import not found.");
  });

  it("shows a permission-denied panel when the API refuses the read", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions for this operation." } },
        403
      )
    );

    renderDetail();

    expect(await screen.findByTestId("imports-permission-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("imports-error")).not.toBeInTheDocument();
  });

  it("asks the API for nothing without imports.read", async () => {
    const fetchMock = installFetch(() => jsonResponse(PREVIEWED_JOB));

    renderDetail({ permissions: [] });

    expect(await screen.findByTestId("imports-permission-denied")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's own message when the outcomes cannot be read", async () => {
    installFetch((url) => {
      if (url.startsWith(`/api/imports/${IMPORT_ID}/summary`)) {
        return jsonResponse(
          { error: { code: "INTERNAL_ERROR", message: "The summary could not be read." } },
          500
        );
      }
      return jsonResponse(PREVIEWED_JOB);
    });

    renderDetail();

    const alert = await screen.findByTestId("imports-summary-error");
    expect(alert).toHaveTextContent("The summary could not be read.");
    // The import's own card is still on screen: one failed read does not blank the
    // page it shares with a successful one.
    expect(screen.getByTestId("imports-state")).toHaveTextContent("PREVIEWED");
  });
});
