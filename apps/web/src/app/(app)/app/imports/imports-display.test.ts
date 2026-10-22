import { describe, expect, it } from "vitest";
import { IMPORT_JOB_STATES, type ImportJobState, type ImportRowOutcome } from "./imports-api";
import {
  IMPORTS_READ_PERMISSION,
  IMPORTS_RUN_PERMISSION,
  importPhaseNotice,
  importRowMessageText,
  importRowReasonText,
  importRowWarningText,
  isImportJobState,
  isPollingImportState,
  isTerminalImportState,
  nextImportAction,
  permissionGranted,
  pollIntervalForState,
  summaryPageLabel,
  summaryRowTotal,
} from "./imports-display";

/**
 * The imports surface's presentation rules ([[IMP-005]]).
 *
 * These cases pin the four decisions the two screens must not take separately:
 * which phases poll, which states have a next action, how a warning READS, and how
 * a permission gates an action. They are asserted on the pure functions rather
 * than through a rendered tree so a wrong rule fails here instead of hiding behind
 * a passing render.
 */

const OUTCOME: ImportRowOutcome = {
  importId: "11111111-1111-4111-8111-111111111111",
  rowNumber: 4,
  status: "FAILED",
  reasonCode: "CUSTOMER_ROW_INVALID",
  message: "The row is missing a required value.",
  suspectedDuplicate: false,
};

describe("the import state vocabulary", () => {
  it("accepts exactly the seven lifecycle tokens", () => {
    for (const state of IMPORT_JOB_STATES) {
      expect(isImportJobState(state), state).toBe(true);
    }

    for (const value of ["", "previewed", "RUNNING", "UPLOAD", 7, null, undefined]) {
      expect(isImportJobState(value), String(value)).toBe(false);
    }
  });

  it("polls only the two phases a worker is expected to move", () => {
    for (const state of IMPORT_JOB_STATES) {
      expect(isPollingImportState(state), state).toBe(
        state === "PREVIEWING" || state === "COMMITTING"
      );
    }
    // An unknown state is not something to poll for.
    expect(isPollingImportState(undefined)).toBe(false);
  });

  it("treats exactly the three terminal states as finished", () => {
    for (const state of IMPORT_JOB_STATES) {
      expect(isTerminalImportState(state), state).toBe(
        state === "COMMITTED" || state === "FAILED" || state === "EXPIRED"
      );
    }
  });
});

describe("the polling contract", () => {
  it("returns the interval while a phase runs and false everywhere else", () => {
    const interval = 25;

    expect(pollIntervalForState("PREVIEWING", interval)).toBe(interval);
    expect(pollIntervalForState("COMMITTING", interval)).toBe(interval);

    // `false` is what CLEARS the timer: this is the Story's "does not poll
    // forever", stated as one expression rather than as prose in a component.
    for (const state of ["UPLOADED", "PREVIEWED", "COMMITTED", "FAILED", "EXPIRED"] as const) {
      expect(pollIntervalForState(state, interval), state).toBe(false);
    }
    expect(pollIntervalForState(undefined, interval)).toBe(false);
  });

  it("announces the two in-flight phases in words and announces nothing else", () => {
    expect(importPhaseNotice("PREVIEWING")).toContain("Previewing");
    expect(importPhaseNotice("COMMITTING")).toContain("Committing");
    // The notice names the watching, because the screen is deliberately not
    // blocking on the import.
    expect(importPhaseNotice("PREVIEWING")).toContain("Watching for changes");

    for (const state of ["UPLOADED", "PREVIEWED", "COMMITTED", "FAILED", "EXPIRED"] as const) {
      expect(importPhaseNotice(state), state).toBeNull();
    }
    expect(importPhaseNotice(undefined)).toBeNull();
  });
});

describe("the next action of each state", () => {
  it("offers preview on UPLOADED and commit on PREVIEWED, and nothing else", () => {
    const actions = Object.fromEntries(
      IMPORT_JOB_STATES.map((state) => [state, nextImportAction(state)])
    ) as Readonly<Record<ImportJobState, "preview" | "commit" | null>>;

    expect(actions).toEqual({
      UPLOADED: "preview",
      PREVIEWING: null,
      PREVIEWED: "commit",
      COMMITTING: null,
      COMMITTED: null,
      FAILED: null,
      EXPIRED: null,
    });
  });
});

describe("how a row outcome reads", () => {
  it("states a suspected duplicate as a warning, on a row that was still created", () => {
    const warning = importRowWarningText(true);

    // The Story's accessible-text requirement: the distinction from an error is in
    // the words, not only in the colour of a cell.
    expect(warning).toBe("Suspected duplicate (warning)");
    expect(warning).toContain("warning");
    // An unflagged row says nothing at all rather than "no warning".
    expect(importRowWarningText(false)).toBe("");
  });

  it("keeps a failed row's reason and message printable, and prints a dash when absent", () => {
    expect(importRowReasonText(OUTCOME)).toBe("CUSTOMER_ROW_INVALID");
    expect(importRowMessageText(OUTCOME)).toBe("The row is missing a required value.");

    const accepted: ImportRowOutcome = {
      ...OUTCOME,
      status: "CREATE",
      reasonCode: null,
      message: null,
      suspectedDuplicate: true,
    };
    expect(importRowReasonText(accepted)).toBe("—");
    expect(importRowMessageText(accepted)).toBe("—");
    // The two facts a row can carry are independent: accepted with a warning reads
    // as CREATE plus the warning sentence, which is not what FAILED plus a reason
    // reads like.
    expect(importRowWarningText(accepted.suspectedDuplicate)).toContain("Suspected duplicate");
  });
});

describe("the paged summary", () => {
  it("counts the stored outcomes from the API's own counters", () => {
    expect(summaryRowTotal({ createdCount: 12, failedCount: 3, suspectedDuplicateCount: 2 })).toBe(
      15
    );
    expect(summaryRowTotal({ createdCount: 0, failedCount: 0, suspectedDuplicateCount: 0 })).toBe(
      0
    );
  });

  it("captions the page with the rows on screen out of the whole import", () => {
    const firstPage = { limit: 100, offset: 0 };
    const secondPage = { limit: 100, offset: 100 };
    const totals = { createdCount: 250, failedCount: 5, suspectedDuplicateCount: 1 };

    expect(summaryPageLabel(firstPage, totals, 100)).toBe("Rows 1–100 of 255");
    expect(summaryPageLabel(secondPage, totals, 100)).toBe("Rows 101–200 of 255");
    // A short last page reports the rows that are actually there, not the page
    // size it asked for.
    expect(
      summaryPageLabel(
        secondPage,
        { createdCount: 120, failedCount: 0, suspectedDuplicateCount: 0 },
        20
      )
    ).toBe("Rows 101–120 of 120");
  });

  it("says an import has no outcomes instead of printing a backwards range", () => {
    expect(
      summaryPageLabel(
        { limit: 100, offset: 0 },
        { createdCount: 0, failedCount: 0, suspectedDuplicateCount: 0 },
        0
      )
    ).toBe("No row outcomes are stored for this import.");
  });
});

describe("the UX permission gate", () => {
  it("shows an action when the claims are unknown, which is the shell's state today", () => {
    expect(permissionGranted(undefined, IMPORTS_RUN_PERMISSION)).toBe(true);
    expect(permissionGranted(undefined, IMPORTS_READ_PERMISSION)).toBe(true);
  });

  it("hides an action only when a known claim set omits the key", () => {
    expect(permissionGranted([IMPORTS_RUN_PERMISSION], IMPORTS_RUN_PERMISSION)).toBe(true);
    expect(permissionGranted([IMPORTS_READ_PERMISSION], IMPORTS_RUN_PERMISSION)).toBe(false);
    expect(permissionGranted([], IMPORTS_RUN_PERMISSION)).toBe(false);
  });
});
