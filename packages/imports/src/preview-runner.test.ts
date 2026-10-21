import { describe, expect, it } from "vitest";
import { CSV_REJECTION_CODES } from "./csv.js";
import { CUSTOMER_COLUMNS_REJECTION_CODES } from "./customer-columns.js";
import type { DuplicateLookup } from "./duplicates.js";
import type { CustomerPreviewRow } from "./preview.js";
import {
  PREVIEW_FAILURE_CODE,
  PREVIEW_FAILURE_MESSAGE,
  PREVIEW_FAILURE_REASON_MAX_LENGTH,
  runCustomerPreview,
  type PreviewArtefact,
  type PreviewPersistence,
} from "./preview-runner.js";

const NOTHING_EXISTS: DuplicateLookup = {
  existsByDocumentNumber: () => false,
  existsByContactValue: () => false,
};

const VALID_CSV = [
  "display_name,kind,legal_name,tax_id,document_number,phone,email",
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  "Vet Co SA,COMPANY,Vet Co SA,80012345-6,,,",
].join("\n");

interface Recorded {
  readonly claims: number;
  readonly completed: (readonly CustomerPreviewRow[])[];
  readonly failures: string[];
}

interface Setup {
  readonly persistence: PreviewPersistence;
  readonly artefact: PreviewArtefact;
  readonly recorded: Recorded;
  /** Calls that reached the persistence, in order — the concurrency assertion reads this. */
  readonly calls: string[];
}

function setup(args: {
  readonly claimResult?: boolean;
  readonly csvText?: string;
  readonly readError?: Error;
  readonly completeError?: Error;
  readonly failError?: Error;
  readonly duplicates?: DuplicateLookup;
}): Setup {
  const calls: string[] = [];
  const completed: (readonly CustomerPreviewRow[])[] = [];
  const failures: string[] = [];
  let claims = 0;

  const persistence: PreviewPersistence = {
    claim: () => {
      calls.push("claim");
      claims += 1;
      return Promise.resolve(args.claimResult ?? true);
    },
    complete: (rows) => {
      calls.push("complete");
      if (args.completeError) return Promise.reject(args.completeError);
      completed.push(rows);
      return Promise.resolve();
    },
    fail: (reason) => {
      calls.push("fail");
      if (args.failError) return Promise.reject(args.failError);
      failures.push(reason);
      return Promise.resolve();
    },
  };

  const artefact: PreviewArtefact = {
    read: () => {
      calls.push("read");
      if (args.readError) return Promise.reject(args.readError);
      return Promise.resolve(args.csvText ?? VALID_CSV);
    },
  };

  return {
    persistence,
    artefact,
    recorded: {
      get claims(): number {
        return claims;
      },
      completed,
      failures,
    },
    calls,
  };
}

describe("runCustomerPreview", () => {
  it("completes the job with one outcome per row and the three counts", async () => {
    const { persistence, artefact, recorded, calls } = setup({});

    const outcome = await runCustomerPreview({
      persistence,
      artefact,
      duplicates: NOTHING_EXISTS,
    });

    expect(outcome).toBe("PREVIEWED");
    expect(calls).toEqual(["claim", "read", "complete"]);
    expect(recorded.completed).toHaveLength(1);
    expect(
      recorded.completed[0].map((row) => [row.rowNumber, row.status, row.suspectedDuplicate])
    ).toEqual([
      [1, "CREATE", false],
      [2, "CREATE", false],
    ]);
    expect(recorded.failures).toEqual([]);
  });

  it("writes NOTHING when the claim is refused: a lost race is not a second preview", async () => {
    const { persistence, artefact, recorded, calls } = setup({ claimResult: false });

    const outcome = await runCustomerPreview({
      persistence,
      artefact,
      duplicates: NOTHING_EXISTS,
    });

    expect(outcome).toBe("SKIPPED");
    // The claim is the only call: the artefact is never read, no outcome is
    // written and no failure is recorded against a row this runner does not own.
    expect(calls).toEqual(["claim"]);
    expect(recorded.claims).toBe(1);
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toEqual([]);
  });

  it("fails the job with the stable file code when the file itself is refused", async () => {
    const { persistence, artefact, recorded } = setup({ csvText: "" });

    const outcome = await runCustomerPreview({
      persistence,
      artefact,
      duplicates: NOTHING_EXISTS,
    });

    expect(outcome).toBe("FAILED");
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toHaveLength(1);
    expect(recorded.failures[0]).toContain(CSV_REJECTION_CODES.EMPTY_FILE);
    // A file-level refusal names the condition and never a value from the file.
    expect(recorded.failures[0]).not.toContain("Ana");
  });

  it("fails the job when the artefact cannot be read, instead of leaving it PREVIEWING", async () => {
    const { persistence, artefact, recorded, calls } = setup({
      readError: new Error("object store unreachable for ana@example.com"),
    });

    const outcome = await runCustomerPreview({
      persistence,
      artefact,
      duplicates: NOTHING_EXISTS,
    });

    expect(outcome).toBe("FAILED");
    expect(calls).toEqual(["claim", "read", "fail"]);
    expect(recorded.failures).toEqual([`${PREVIEW_FAILURE_CODE}: ${PREVIEW_FAILURE_MESSAGE}`]);
    // The thrown error's own text is never stored: it is the field most likely to
    // quote the record it was working on.
    expect(recorded.failures[0]).not.toContain("ana@example.com");
    expect(recorded.failures[0]).not.toContain("unreachable");
  });

  it("fails the job when the persistence refuses the completion, rather than dropping it", async () => {
    const { persistence, artefact, recorded } = setup({
      completeError: new Error("updateMany timed out for Ana Pérez"),
    });

    const outcome = await runCustomerPreview({
      persistence,
      artefact,
      duplicates: NOTHING_EXISTS,
    });

    expect(outcome).toBe("FAILED");
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toEqual([`${PREVIEW_FAILURE_CODE}: ${PREVIEW_FAILURE_MESSAGE}`]);
    expect(recorded.failures[0]).not.toContain("Ana");
  });

  it("bounds the reason it stores, whatever it was given", async () => {
    // A single unknown column whose normalized name is 500 characters long: the
    // column contract refuses the FILE and names the column, so the reason the
    // runner stores is as long as the operator's own header.
    const { persistence, artefact, recorded } = setup({
      csvText: `display_name,${"x".repeat(500)}\nAna,y\n`,
    });

    const outcome = await runCustomerPreview({
      persistence,
      artefact,
      duplicates: NOTHING_EXISTS,
    });

    expect(outcome).toBe("FAILED");
    expect(recorded.failures).toHaveLength(1);
    expect(recorded.failures[0]).toContain(CUSTOMER_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER);
    expect(recorded.failures[0].length).toBeLessThanOrEqual(PREVIEW_FAILURE_REASON_MAX_LENGTH);
    expect(recorded.failures[0]).not.toMatch(/[\r\n\t]/);
  });

  it("propagates a failure the persistence cannot even record", async () => {
    const { persistence, artefact } = setup({
      readError: new Error("unreachable"),
      failError: new Error("database unreachable"),
    });

    // There is nothing left to do: the phase is claimed and its settlement cannot
    // be written, so the error is the caller's to report rather than a silent
    // `FAILED` that never reached the row.
    await expect(
      runCustomerPreview({ persistence, artefact, duplicates: NOTHING_EXISTS })
    ).rejects.toThrow("database unreachable");
  });
});
