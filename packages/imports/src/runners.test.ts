import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { planCustomerCommit } from "./commit.js";
import {
  COMMIT_NO_VALID_ROWS_CODE,
  COMMIT_ROW_FAILURE_CODE,
  runImportCommit,
  type CommitCounts,
  type CommitPersistence,
  type CommitWriter,
  type StoredOutcome,
} from "./commit-runner.js";
import type { DuplicateLookup } from "./duplicates.js";
import { createPatientCatalogIndex } from "./patient-row.js";
import type { GuardianLookup } from "./patient-row.js";
import { planPatientCommit } from "./patient-commit.js";
import { planPatientPreview } from "./patient-preview.js";
import type { ImportPayloadPlan, ImportPlan, ImportPreviewRow, ImportRowPayload } from "./plan.js";
import { planCustomerPreview } from "./preview.js";
import {
  runImportPreview,
  type PreviewArtefact,
  type PreviewPersistence,
} from "./preview-runner.js";

/**
 * The generalised runners ([[IMP-004]]).
 *
 * WHAT THIS FILE EXISTS TO PROVE, and it is the Story's sharpest requirement: the
 * claim-first behaviour and the partial-success loop are SHARED MACHINERY, not two
 * copies that happen to agree. So it runs BOTH entities through the SAME functions —
 * one `runImportPreview`, one `runImportCommit` — and asserts the identical call
 * sequence and the identical outcome for each, and then reads the two runner sources
 * to assert neither of them knows the name of an entity.
 *
 * A copy would pass a per-entity suite and fail this one: the second runner would not
 * be `runImportCommit`, and one of the two sources would have to say "customer" or
 * "patient" to know which loop it is running.
 */

const SPECIES_DOG = "00000000-0000-4000-8000-0000000000a1";
const GUARDIAN = "00000000-0000-4000-8000-0000000000c1";

const CUSTOMER_HEADERS = "display_name,kind,legal_name,tax_id,document_number,phone,email";

/** Row 2 is refused by `createCustomerBody`: a COMPANY with no tax id. */
const CUSTOMER_CSV = [
  CUSTOMER_HEADERS,
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  "Vet Co SA,COMPANY,Vet Co SA,,,0981123456,",
  "Bruno Díaz,,,,DOC-2,0986655443,bruno@example.com",
].join("\n");

const PATIENT_HEADERS =
  "name,species,sex,breed,birth_date,guardian_document,guardian_phone,guardian_email";

/** Row 2's guardian reference resolves to nobody, so the row contract refuses it. */
const PATIENT_CSV = [
  PATIENT_HEADERS,
  "Luna,dog,FEMALE,,2021-04-09,DOC-9,,",
  "Toby,dog,MALE,,,NOBODY,,",
  "Michi,cat,male,,,,0981123456,",
].join("\n");

const NOTHING_EXISTS: DuplicateLookup = {
  existsByDocumentNumber: () => false,
  existsByContactValue: () => false,
};

const CATALOG = createPatientCatalogIndex({
  species: [
    { id: SPECIES_DOG, code: "DOG", name: "Dog" },
    { id: "00000000-0000-4000-8000-0000000000a2", code: "CAT", name: "Cat" },
  ],
  breeds: [],
}).lookup;

const GUARDIANS: GuardianLookup = {
  byDocumentNumber: (value) => (value === "DOC-9" ? GUARDIAN : null),
  byContactValue: (kind, value) => (kind === "PHONE" && value === "0981123456" ? GUARDIAN : null),
};

/**
 * One entity, as the two runners see it: a PREVIEW planner, a PAYLOAD planner, and the
 * file both of them read. Nothing else differs.
 *
 * The payload planner is typed at the WIDEST row (`ImportRowPayload`) on purpose: the
 * runner needs nothing more than the row number from a payload, and proving that is
 * part of what makes the loop shared.
 */
interface Entity {
  readonly name: string;
  readonly csv: string;
  /** A file whose every row is refused, for the zero-valid-rows rule. */
  readonly refusedCsv: string;
  preview(csvText: string): ImportPlan;
  payloads(csvText: string): ImportPayloadPlan<ImportRowPayload>;
  /** The row whose payload the writer will throw on. */
  readonly failingRowNumber: number;
}

const ENTITIES: readonly Entity[] = [
  {
    name: "CUSTOMER",
    csv: CUSTOMER_CSV,
    refusedCsv: [CUSTOMER_HEADERS, "Vet Co SA,COMPANY,Vet Co SA,,,0981123456,"].join("\n"),
    preview: (csvText) => planCustomerPreview({ csvText, duplicates: NOTHING_EXISTS }),
    payloads: (csvText) => planCustomerCommit({ csvText }),
    failingRowNumber: 3,
  },
  {
    name: "PATIENT",
    csv: PATIENT_CSV,
    refusedCsv: [PATIENT_HEADERS, "Toby,dog,MALE,,,NOBODY,,"].join("\n"),
    preview: (csvText) => planPatientPreview({ csvText, catalog: CATALOG, guardians: GUARDIANS }),
    payloads: (csvText) => planPatientCommit({ csvText, catalog: CATALOG, guardians: GUARDIANS }),
    failingRowNumber: 3,
  },
];

interface PreviewFixture {
  readonly persistence: PreviewPersistence;
  readonly artefact: PreviewArtefact;
  readonly calls: string[];
  readonly completed: (readonly ImportPreviewRow[])[];
  readonly failures: string[];
}

function previewFixture(args: {
  readonly csvText: string;
  readonly claimResult?: boolean;
}): PreviewFixture {
  const calls: string[] = [];
  const completed: (readonly ImportPreviewRow[])[] = [];
  const failures: string[] = [];

  return {
    calls,
    completed,
    failures,
    persistence: {
      claim: () => {
        calls.push("claim");
        return Promise.resolve(args.claimResult ?? true);
      },
      complete: (rows) => {
        calls.push("complete");
        completed.push(rows);
        return Promise.resolve();
      },
      fail: (reason) => {
        calls.push("fail");
        failures.push(reason);
        return Promise.resolve();
      },
    },
    artefact: {
      read: () => {
        calls.push("read");
        return Promise.resolve(args.csvText);
      },
    },
  };
}

interface CommitFixture {
  readonly persistence: CommitPersistence;
  readonly artefact: PreviewArtefact;
  readonly calls: string[];
  readonly completed: CommitCounts[];
  readonly failures: string[];
  readonly failedRows: { rowNumber: number; code: string }[];
  readonly written: number[];
}

function commitFixture(args: {
  readonly csvText: string;
  readonly outcomes: readonly StoredOutcome[];
  readonly claimResult?: boolean;
  readonly writerFailsOn?: number;
}): CommitFixture {
  const calls: string[] = [];
  const completed: CommitCounts[] = [];
  const failures: string[] = [];
  const failedRows: { rowNumber: number; code: string }[] = [];
  const written: number[] = [];

  return {
    calls,
    completed,
    failures,
    failedRows,
    written,
    persistence: {
      claim: () => {
        calls.push("claim");
        return Promise.resolve(args.claimResult ?? true);
      },
      readOutcomes: () => {
        calls.push("readOutcomes");
        return Promise.resolve(args.outcomes);
      },
      failRow: (rowNumber, code) => {
        calls.push(`failRow:${String(rowNumber)}`);
        failedRows.push({ rowNumber, code });
        return Promise.resolve();
      },
      complete: (counts) => {
        calls.push("complete");
        completed.push(counts);
        return Promise.resolve();
      },
      fail: (reason) => {
        calls.push("fail");
        failures.push(reason);
        return Promise.resolve();
      },
    },
    artefact: {
      read: () => {
        calls.push("read");
        return Promise.resolve(args.csvText);
      },
    },
  };
}

/** The writer both entities get: it records the row and throws on ONE of them. */
function writerFor(fixture: CommitFixture, failsOn: number): CommitWriter<ImportRowPayload> {
  return {
    create: (row) => {
      if (row.rowNumber === failsOn) {
        return Promise.reject(new Error("any driver message, which must never be stored"));
      }
      fixture.written.push(row.rowNumber);
      return Promise.resolve();
    },
  };
}

function accepted(rowNumber: number): StoredOutcome {
  return {
    rowNumber,
    status: "CREATE",
    reasonCode: null,
    message: null,
    suspectedDuplicate: false,
  };
}

function previewRefused(rowNumber: number): StoredOutcome {
  return {
    rowNumber,
    status: "FAILED",
    reasonCode: "ANY_PREVIEW_CODE",
    message: "The row was refused by the preview.",
    suspectedDuplicate: false,
  };
}

describe("runImportPreview is ONE pass for every entity", () => {
  it("claims, reads, plans and completes identically for a customer and a patient file", async () => {
    for (const entity of ENTITIES) {
      const fixture = previewFixture({ csvText: entity.csv });

      const outcome = await runImportPreview({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.preview(csvText),
      });

      expect(outcome, entity.name).toBe("PREVIEWED");
      expect(fixture.calls, entity.name).toEqual(["claim", "read", "complete"]);
      expect(
        fixture.completed[0].map((row) => row.rowNumber),
        entity.name
      ).toEqual([1, 2, 3]);
      // Each file carries one refused row, and it is refused for a DIFFERENT reason —
      // which is the planner's business, not the pass's.
      expect(
        fixture.completed[0].map((row) => row.status),
        entity.name
      ).toEqual(["CREATE", "FAILED", "CREATE"]);
      expect(fixture.failures, entity.name).toEqual([]);
    }
  });

  it("writes NOTHING when the claim is refused, for either entity", async () => {
    for (const entity of ENTITIES) {
      const fixture = previewFixture({ csvText: entity.csv, claimResult: false });

      const outcome = await runImportPreview({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.preview(csvText),
      });

      expect(outcome, entity.name).toBe("SKIPPED");
      expect(fixture.calls, entity.name).toEqual(["claim"]);
      expect(fixture.completed, entity.name).toEqual([]);
      expect(fixture.failures, entity.name).toEqual([]);
    }
  });

  it("settles a refused FILE the same way, with the planner's own stable code", async () => {
    for (const entity of ENTITIES) {
      const fixture = previewFixture({ csvText: "" });

      const outcome = await runImportPreview({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.preview(csvText),
      });

      expect(outcome, entity.name).toBe("FAILED");
      expect(fixture.calls, entity.name).toEqual(["claim", "read", "fail"]);
      expect(fixture.failures[0], entity.name).toContain("CSV_EMPTY_FILE");
      expect(fixture.failures[0].length, entity.name).toBeLessThanOrEqual(400);
    }
  });
});

describe("runImportCommit is ONE loop for every entity", () => {
  it("writes the preview's accepted rows and continues past a refused one, identically", async () => {
    for (const entity of ENTITIES) {
      const fixture = commitFixture({
        csvText: entity.csv,
        outcomes: [accepted(1), previewRefused(2), accepted(3)],
      });

      const outcome = await runImportCommit<ImportRowPayload>({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.payloads(csvText),
        writer: writerFor(fixture, 0),
      });

      expect(outcome, entity.name).toBe("COMMITTED");
      expect(fixture.calls, entity.name).toEqual(["claim", "readOutcomes", "read", "complete"]);
      // The refused row is neither written nor re-judged: it is counted, and only it.
      expect(fixture.written, entity.name).toEqual([1, 3]);
      expect(fixture.completed, entity.name).toEqual([
        { created: 2, failed: 1, suspectedDuplicate: 0 },
      ]);
      expect(fixture.failedRows, entity.name).toEqual([]);
    }
  });

  it("records a mid-file failure on its own row and carries on, identically", async () => {
    for (const entity of ENTITIES) {
      const fixture = commitFixture({
        csvText: entity.csv,
        outcomes: [accepted(1), previewRefused(2), accepted(3)],
      });

      const outcome = await runImportCommit<ImportRowPayload>({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.payloads(csvText),
        writer: writerFor(fixture, entity.failingRowNumber),
      });

      expect(outcome, entity.name).toBe("COMMITTED");
      // Rows 1 and 2's outcome survive; row 3's failure is recorded on row 3 and the
      // run continues to the end rather than aborting the file.
      expect(fixture.written, entity.name).toEqual([1]);
      expect(fixture.failedRows, entity.name).toEqual([
        { rowNumber: 3, code: COMMIT_ROW_FAILURE_CODE },
      ]);
      expect(fixture.completed, entity.name).toEqual([
        { created: 1, failed: 2, suspectedDuplicate: 0 },
      ]);
      // Nothing about the driver's message reaches the outcome table.
      expect(JSON.stringify(fixture.completed), entity.name).not.toContain("driver");
    }
  });

  it("refuses a file with no accepted row BEFORE reading the artefact, identically", async () => {
    for (const entity of ENTITIES) {
      const fixture = commitFixture({
        csvText: entity.refusedCsv,
        outcomes: [previewRefused(1)],
      });

      const outcome = await runImportCommit<ImportRowPayload>({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.payloads(csvText),
        writer: writerFor(fixture, 0),
      });

      expect(outcome, entity.name).toBe("FAILED");
      expect(fixture.calls, entity.name).toEqual(["claim", "readOutcomes", "fail"]);
      expect(fixture.failures[0], entity.name).toContain(COMMIT_NO_VALID_ROWS_CODE);
      expect(fixture.written, entity.name).toEqual([]);
    }
  });

  it("skips a replayed job for either entity, writing no record", async () => {
    for (const entity of ENTITIES) {
      const fixture = commitFixture({
        csvText: entity.csv,
        outcomes: [accepted(1)],
        claimResult: false,
      });

      const outcome = await runImportCommit<ImportRowPayload>({
        persistence: fixture.persistence,
        artefact: fixture.artefact,
        plan: (csvText) => entity.payloads(csvText),
        writer: writerFor(fixture, 0),
      });

      expect(outcome, entity.name).toBe("SKIPPED");
      expect(fixture.calls, entity.name).toEqual(["claim"]);
      expect(fixture.written, entity.name).toEqual([]);
    }
  });

  it("puts the row number on the payload of BOTH entities' plans", () => {
    for (const entity of ENTITIES) {
      const plan = entity.payloads(entity.csv);
      const refused = entity.preview(entity.csv);

      // The payload exists exactly for the rows the preview accepted: that join is the
      // row number, and it is all the shared loop reads from a payload.
      expect(
        plan.rows.map((row) => row.rowNumber),
        entity.name
      ).toEqual(refused.rows.filter((row) => row.status === "CREATE").map((row) => row.rowNumber));
    }
  });
});

/**
 * The source with its comments removed.
 *
 * The runners' DOCS name the entities on purpose — they explain which planner each
 * phase runs — so "the runner does not know an entity" is a claim about its CODE.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the runners carry no entity of their own", () => {
  it("declares ONE runner per phase, and neither names an entity", async () => {
    const [previewSource, commitSource] = await Promise.all([
      readFile(new URL("./preview-runner.ts", import.meta.url), "utf8"),
      readFile(new URL("./commit-runner.ts", import.meta.url), "utf8"),
    ]);

    expect(previewSource).toContain("export async function runImportPreview");
    expect(commitSource).toContain("export async function runImportCommit");
    // ONE exported runner each: a second, entity-specific pass would show up here.
    expect(previewSource.match(/export async function run/g)).toHaveLength(1);
    expect(commitSource.match(/export async function run/g)).toHaveLength(1);

    for (const [name, source] of [
      ["preview-runner.ts", withoutComments(previewSource)],
      ["commit-runner.ts", withoutComments(commitSource)],
    ] as const) {
      // A runner that knows an entity name is a runner that can be branched per entity,
      // which is exactly the copy [[IMP-004]] refused.
      expect(source, name).not.toMatch(/customer/i);
      expect(source, name).not.toMatch(/patient/i);
    }
  });

  it("keeps the entity-specific part in a PLANNER, one per entity per phase", async () => {
    const [customerPlanner, patientPlanner] = await Promise.all([
      readFile(new URL("./preview.ts", import.meta.url), "utf8"),
      readFile(new URL("./patient-preview.ts", import.meta.url), "utf8"),
    ]);

    // The planners are where an entity is named, and they return the same plan type —
    // which is what lets the one pass walk both.
    expect(customerPlanner).toContain("export function planCustomerPreview");
    expect(patientPlanner).toContain("export function planPatientPreview");
    expect(customerPlanner).toContain("planFileRefusal");
    expect(patientPlanner).toContain("planFileRefusal");
  });
});
