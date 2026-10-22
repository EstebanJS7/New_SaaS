import { describe, expect, it } from "vitest";
import { CUSTOMER_COLUMNS_REJECTION_CODES } from "./customer-columns.js";
import type { CustomerRowReady } from "./commit.js";
import {
  COMMIT_FAILURE_CODE,
  COMMIT_FAILURE_MESSAGE,
  COMMIT_FAILURE_REASON_MAX_LENGTH,
  COMMIT_NO_VALID_ROWS_CODE,
  COMMIT_ROW_FAILURE_CODE,
  COMMIT_ROW_FAILURE_MESSAGE,
  runCustomerCommit,
  type CommitCounts,
  type CommitPersistence,
  type CommitWriter,
  type StoredOutcome,
} from "./commit-runner.js";
import type { PreviewArtefact } from "./preview-runner.js";

/**
 * IMP-003 commit runner suite.
 *
 * The rules this file exists to prove are the ones that decide whether BUSINESS
 * RECORDS exist, so each is asserted as a write that did or did not happen rather
 * than as a call count:
 *
 * - a refused claim writes nothing at all;
 * - only the rows the PREVIEW accepted are written, whatever the file says;
 * - a mid-file failure keeps the rows before it and continues past it ([[DEC-071]]);
 * - zero accepted rows commits nothing and fails the job with a reason;
 * - a replayed job is skipped without touching anything;
 * - the duplicate warning survives the commit;
 * - every reason is bounded and quotes nothing from the file.
 */

const HEADERS = "display_name,kind,legal_name,tax_id,document_number,phone,email";

/** Two accepted individuals, with a phone and an e-mail. */
const VALID_CSV = [
  HEADERS,
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  "Bruno Díaz,,,,DOC-2,0986655443,bruno@example.com",
].join("\n");

/** Three data rows: valid, refused by the row contract, valid. */
const MIXED_CSV = [
  HEADERS,
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  // COMPANY with no tax id: `createCustomerBody` refuses this row.
  "Vet Co SA,COMPANY,Vet Co SA,,,0981123456,",
  "Bruno Díaz,,,,DOC-2,0986655443,bruno@example.com",
].join("\n");

interface Recorded {
  readonly claims: number;
  readonly completed: CommitCounts[];
  readonly failures: string[];
  readonly failedRows: { rowNumber: number; code: string; message: string }[];
  /** Every call that reached the persistence, in order. */
  readonly calls: string[];
  /** The payloads the writer was asked to create, in order. */
  readonly written: CustomerRowReady[];
}

interface Setup {
  readonly persistence: CommitPersistence;
  readonly artefact: PreviewArtefact;
  readonly writer: CommitWriter;
  readonly recorded: Recorded;
}

function storedOutcome(
  rowNumber: number,
  status: "CREATE" | "FAILED",
  suspectedDuplicate = false
): StoredOutcome {
  return status === "CREATE"
    ? { rowNumber, status, reasonCode: null, message: null, suspectedDuplicate }
    : {
        rowNumber,
        status,
        reasonCode: "CUSTOMER_ROW_INVALID",
        message: "The row does not satisfy the customer create contract.",
        suspectedDuplicate: false,
      };
}

function setup(args: {
  readonly claimResult?: boolean;
  readonly outcomes?: readonly StoredOutcome[];
  readonly csvText?: string;
  readonly readError?: Error;
  readonly failRowError?: Error;
  readonly completeError?: Error;
  readonly failError?: Error;
  /** Row numbers whose `create` throws: the mid-file failure. */
  readonly writerFailsOn?: readonly number[];
}): Setup {
  const calls: string[] = [];
  const completed: CommitCounts[] = [];
  const failures: string[] = [];
  const failedRows: { rowNumber: number; code: string; message: string }[] = [];
  const written: CustomerRowReady[] = [];
  let claims = 0;

  const persistence: CommitPersistence = {
    claim: () => {
      calls.push("claim");
      claims += 1;
      return Promise.resolve(args.claimResult ?? true);
    },
    readOutcomes: () => {
      calls.push("readOutcomes");
      return Promise.resolve(
        args.outcomes ?? [storedOutcome(1, "CREATE"), storedOutcome(2, "CREATE")]
      );
    },
    failRow: (rowNumber, code, message) => {
      calls.push(`failRow:${rowNumber}`);
      if (args.failRowError) return Promise.reject(args.failRowError);
      failedRows.push({ rowNumber, code, message });
      return Promise.resolve();
    },
    complete: (counts) => {
      calls.push("complete");
      if (args.completeError) return Promise.reject(args.completeError);
      completed.push(counts);
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

  const writer: CommitWriter = {
    create: (row) => {
      if (args.writerFailsOn?.includes(row.rowNumber) === true) {
        return Promise.reject(new Error(`insert failed for ${row.input.displayName}`));
      }
      written.push(row);
      return Promise.resolve();
    },
  };

  return {
    persistence,
    artefact,
    writer,
    recorded: {
      get claims(): number {
        return claims;
      },
      completed,
      failures,
      failedRows,
      calls,
      written,
    },
  };
}

describe("runCustomerCommit", () => {
  it("claims first, then writes one record per PREVIEW-accepted row and completes with the counters", async () => {
    const { persistence, artefact, writer, recorded } = setup({});

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("COMMITTED");
    // The order is the contract: the claim takes the phase before anything is read
    // or written.
    expect(recorded.calls).toEqual(["claim", "readOutcomes", "read", "complete"]);
    expect(recorded.written.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(recorded.written[0]?.input).toMatchObject({
      kind: "INDIVIDUAL",
      displayName: "Ana Pérez",
      documentNumber: "DOC-1",
    });
    // The payload carries the row's contacts, in phone-then-e-mail order, because
    // the outcome table stores no personal data and the artefact is the only
    // place the payload can come from.
    expect(recorded.written[0]?.contacts).toEqual([
      { kind: "PHONE", value: "0981123456", isPrimary: true },
      { kind: "EMAIL", value: "ana@example.com", isPrimary: true },
    ]);
    expect(recorded.completed).toEqual([{ created: 2, failed: 0, suspectedDuplicate: 0 }]);
    expect(recorded.failures).toEqual([]);
    expect(recorded.failedRows).toEqual([]);
  });

  it("writes NOTHING when the claim is refused: a replayed job is not a second commit", async () => {
    const { persistence, artefact, writer, recorded } = setup({ claimResult: false });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("SKIPPED");
    // The claim is the only call. The outcomes are not even read, so an import
    // already `COMMITTING` or terminal cannot have a record written for it twice.
    expect(recorded.calls).toEqual(["claim"]);
    expect(recorded.written).toEqual([]);
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toEqual([]);
  });

  it("creates ONLY the rows the preview accepted: a refused row is never retried", async () => {
    // Both rows in the file are perfectly valid payloads. The PREVIEW refused the
    // second one, and that verdict is the authority: the commit does not get a
    // second opinion on a row it was told not to write.
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [storedOutcome(1, "CREATE"), storedOutcome(2, "FAILED")],
      csvText: VALID_CSV,
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("COMMITTED");
    expect(recorded.written.map((row) => row.rowNumber)).toEqual([1]);
    expect(recorded.failedRows).toEqual([]);
    expect(recorded.completed).toEqual([{ created: 1, failed: 1, suspectedDuplicate: 0 }]);
  });

  it("ignores a row of the file the preview never recorded an outcome for", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [storedOutcome(1, "CREATE"), storedOutcome(2, "CREATE")],
      csvText: [
        HEADERS,
        "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
        "Bruno Díaz,,,,DOC-2,0986655443,bruno@example.com",
        "Carla Ruiz,,,,DOC-3,0977888999,carla@example.com",
      ].join("\n"),
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("COMMITTED");
    expect(recorded.written.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(recorded.completed).toEqual([{ created: 2, failed: 0, suspectedDuplicate: 0 }]);
  });

  it("keeps the rows before a mid-file failure, records it, and CONTINUES to the next row", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [
        storedOutcome(1, "CREATE"),
        storedOutcome(2, "CREATE"),
        storedOutcome(3, "CREATE"),
      ],
      csvText: [
        HEADERS,
        "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
        "Bruno Díaz,,,,DOC-2,0986655443,bruno@example.com",
        "Carla Ruiz,,,,DOC-3,0977888999,carla@example.com",
      ].join("\n"),
      writerFailsOn: [2],
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("COMMITTED");
    // DEC-071's partial success: 1 and 3 committed, 2 is a failed ROW, and the
    // file did not stop at the failure.
    expect(recorded.written.map((row) => row.rowNumber)).toEqual([1, 3]);
    expect(recorded.failedRows).toEqual([
      { rowNumber: 2, code: COMMIT_ROW_FAILURE_CODE, message: COMMIT_ROW_FAILURE_MESSAGE },
    ]);
    expect(recorded.completed).toEqual([{ created: 2, failed: 1, suspectedDuplicate: 0 }]);
    // The writer's own error text is never stored: it is the field most likely to
    // quote the values it was writing.
    expect(JSON.stringify(recorded.failedRows)).not.toContain("Bruno");
    expect(JSON.stringify(recorded.failedRows)).not.toContain("insert failed");
  });

  it("commits NOTHING and fails the job when the preview accepted no row", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [storedOutcome(1, "FAILED"), storedOutcome(2, "FAILED")],
      csvText: MIXED_CSV,
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("FAILED");
    expect(recorded.written).toEqual([]);
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toHaveLength(1);
    // Committing nothing is not a partial success: the job says so, with a code an
    // operator can read, and the artefact was never even read.
    expect(recorded.failures[0]).toContain(COMMIT_NO_VALID_ROWS_CODE);
    expect(recorded.calls).toEqual(["claim", "readOutcomes", "fail"]);
  });

  it("carries the suspected-duplicate warning into the counters of a row it created", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [storedOutcome(1, "CREATE", true), storedOutcome(2, "CREATE", false)],
    });

    await runCustomerCommit({ persistence, artefact, writer });

    // DEC-069: the warning survives the commit, and the row was still CREATED.
    expect(recorded.completed).toEqual([{ created: 2, failed: 0, suspectedDuplicate: 1 }]);
    expect(recorded.written).toHaveLength(2);
  });

  it("drops a failed row from the duplicate total but never rewrites its warning", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [storedOutcome(1, "CREATE", true), storedOutcome(2, "CREATE", true)],
      writerFailsOn: [2],
    });

    await runCustomerCommit({ persistence, artefact, writer });

    // `suspectedDuplicate` stays a SUBSET of `created` (the aggregate's own
    // projection says so), and the failed row keeps its flag on its own outcome
    // row — `failRow` is never asked to clear it.
    expect(recorded.completed).toEqual([{ created: 1, failed: 1, suspectedDuplicate: 1 }]);
    expect(recorded.failedRows.map((row) => row.rowNumber)).toEqual([2]);
  });

  it("fails the job with the file's stable code when the artefact can no longer be read as the same file", async () => {
    const { persistence, artefact, writer, recorded } = setup({ csvText: "kind,phone\n,0981" });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("FAILED");
    expect(recorded.written).toEqual([]);
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures[0]).toContain(
      CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER
    );
    // The header contract's message names a COLUMN, never a value from the file.
    expect(recorded.failures[0]).not.toContain("0981");
  });

  it("records a commit-time failure for an accepted row the artefact no longer yields", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      outcomes: [
        storedOutcome(1, "CREATE"),
        storedOutcome(2, "CREATE"),
        storedOutcome(3, "CREATE"),
      ],
      csvText: VALID_CSV,
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("COMMITTED");
    // Row 3 is absent from the file: nothing was written for it, it is recorded as
    // failed, and the rows the file did yield were still committed.
    expect(recorded.written.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(recorded.failedRows.map((row) => row.rowNumber)).toEqual([3]);
    expect(recorded.completed).toEqual([{ created: 2, failed: 1, suspectedDuplicate: 0 }]);
  });

  it("fails the job when the artefact cannot be read, instead of leaving it COMMITTING", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      readError: new Error("object store unreachable for ana@example.com"),
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("FAILED");
    expect(recorded.calls).toEqual(["claim", "readOutcomes", "read", "fail"]);
    expect(recorded.failures).toEqual([`${COMMIT_FAILURE_CODE}: ${COMMIT_FAILURE_MESSAGE}`]);
    expect(recorded.failures[0]).not.toContain("ana@example.com");
    expect(recorded.failures[0]).not.toContain("unreachable");
  });

  it("fails the job when the persistence refuses the completion, rather than dropping it", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      completeError: new Error("updateMany timed out for Ana Pérez"),
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    expect(outcome).toBe("FAILED");
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toEqual([`${COMMIT_FAILURE_CODE}: ${COMMIT_FAILURE_MESSAGE}`]);
    expect(recorded.failures[0]).not.toContain("Ana");
  });

  it("settles the job when a row cannot even be recorded as failed", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      writerFailsOn: [2],
      failRowError: new Error("outcome write failed"),
    });

    const outcome = await runCustomerCommit({ persistence, artefact, writer });

    // The per-row record could not be written, so the partial result can no longer
    // be described: the job is failed rather than completed with a summary that
    // does not match the rows.
    expect(outcome).toBe("FAILED");
    expect(recorded.completed).toEqual([]);
    expect(recorded.failures).toEqual([`${COMMIT_FAILURE_CODE}: ${COMMIT_FAILURE_MESSAGE}`]);
  });

  it("bounds the reason it stores, whatever it was given", async () => {
    const { persistence, artefact, writer, recorded } = setup({
      csvText: `display_name,${"x".repeat(500)}\nAna,y\n`,
    });

    await runCustomerCommit({ persistence, artefact, writer });

    expect(recorded.failures).toHaveLength(1);
    expect(recorded.failures[0]).toContain(CUSTOMER_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER);
    expect(recorded.failures[0].length).toBeLessThanOrEqual(COMMIT_FAILURE_REASON_MAX_LENGTH);
    expect(recorded.failures[0]).not.toMatch(/[\r\n\t]/);
  });

  it("propagates a failure the persistence cannot even record", async () => {
    const { persistence, artefact, writer } = setup({
      readError: new Error("unreachable"),
      failError: new Error("database unreachable"),
    });

    // Nothing is left to do: the phase is claimed and its settlement cannot be
    // written, so the error is the caller's to report rather than a silent
    // `FAILED` that never reached the row.
    await expect(runCustomerCommit({ persistence, artefact, writer })).rejects.toThrow(
      "database unreachable"
    );
  });
});
