import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_COLUMNS_REJECTION_CODES } from "@newsaas/imports";
import type { StoragePort } from "@newsaas/storage";
import { ImportPreviewHandler, type ImportPreviewPrisma } from "./preview.handler.js";

/**
 * IMP-002 worker handler suite.
 *
 * Driven against a hand-written Prisma double whose `updateMany` applies the SAME
 * conditional predicate the migration and the API's repository rely on — the state
 * the transition LEAVES is pinned — so "the claim is a compare-and-swap" and "a
 * settle writes `failed_at` exactly on `FAILED`" are asserted as writes rather than
 * as mock call counts.
 *
 * What this file exists to prove, in the Story's words:
 * - a previewed import ends `PREVIEWED` with its outcomes REPLACED and its counters;
 * - a missing row, a row that moved and an entity with no column map are refused
 *   without writing anything at all;
 * - an artefact that cannot be read FAILS the job instead of leaving it `PREVIEWING`;
 * - the tenant is the ROW's, and the duplicate lookup is scoped to it;
 * - a suspected duplicate is a warning on a row that is still `CREATE`;
 * - since [[IMP-004]] a `PATIENT` file takes the SAME pass: the same claim, the same
 *   counters, and a guardian reference that resolves to nobody (or to another tenant's
 *   customer) is a row error that creates nothing.
 */

type ImportJobState =
  "UPLOADED" | "PREVIEWING" | "PREVIEWED" | "COMMITTING" | "COMMITTED" | "FAILED" | "EXPIRED";

const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-0000000000bb";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const STORAGE_KEY = "import_0000000000000000000000";

const HEADERS = "display_name,kind,legal_name,tax_id,document_number,phone,email";

/** One valid individual with a document and both contacts, one valid company. */
const VALID_CSV = [
  HEADERS,
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  "Vet Co SA,COMPANY,Vet Co SA,80012345-6,,,",
].join("\n");

const PATIENT_HEADERS =
  "name,species,sex,breed,birth_date,guardian_document,guardian_phone,guardian_email";

/** Two valid patients: one guarded by a document, one by a phone, sex in two cases. */
const PATIENT_CSV = [
  PATIENT_HEADERS,
  "Luna,dog,FEMALE,Labrador,2021-04-09,DOC-9,,",
  "Michi,Cat,male,,,,0981123456,",
].join("\n");

/** One valid patient, one whose guardian reference resolves to nobody. */
const PATIENT_MIXED_CSV = [
  PATIENT_HEADERS,
  "Luna,dog,FEMALE,,,DOC-9,,",
  "Michi,cat,male,,,,NOBODY,",
].join("\n");

const SPECIES_DOG = "00000000-0000-4000-8000-0000000000a1";
const SPECIES_CAT = "00000000-0000-4000-8000-0000000000a2";
const BREED_LABRADOR = "00000000-0000-4000-8000-0000000000b1";
const CUSTOMER_ANA = "00000000-0000-4000-8000-0000000000c1";

/** The GLOBAL taxonomy: `code` and `name` both addressable, case-insensitively. */
const TAXONOMY = [
  { id: SPECIES_DOG, code: "DOG", name: "Dog" },
  { id: SPECIES_CAT, code: "CAT", name: "Cat" },
];
const BREEDS = [{ id: BREED_LABRADOR, speciesId: SPECIES_DOG, code: "LAB", name: "Labrador" }];

/** One valid individual, one row `createCustomerBody` refuses (COMPANY with no tax id). */
const MIXED_CSV = [
  HEADERS,
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  "Vet Co SA,COMPANY,Vet Co SA,,,0981123456,",
].join("\n");

interface JobRow {
  id: string;
  tenantId: string;
  entity: "CUSTOMER" | "PATIENT";
  state: ImportJobState;
  storageKey: string;
  previewedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdCount: number;
  failedCount: number;
  suspectedDuplicateCount: number;
}

interface OutcomeRow {
  tenantId: string;
  importId: string;
  rowNumber: number;
  status: "CREATE" | "FAILED";
  reasonCode: string | null;
  message: string | null;
  suspectedDuplicate: boolean;
}

interface AuditRow {
  action: string;
  actorType?: string;
  tenantId?: string;
  targetType?: string;
  targetId?: string;
  metadata: Record<string, unknown>;
}

/** One lookup the handler issued, captured so a test can assert its tenant scope. */
interface CapturedLookup {
  readonly delegate: string;
  readonly where: Record<string, unknown>;
}

/** One conditional write the handler issued, captured so a test can assert it. */
interface CapturedWrite {
  readonly where: Record<string, unknown>;
  readonly data: Record<string, unknown>;
}

/** One tenant customer, as both the duplicate heuristic and the guardian lookup read it. */
interface CustomerRow {
  readonly tenantId: string;
  readonly id: string;
  readonly documentNumber: string | null;
}

/** One tenant customer contact, carrying the customer it belongs to. */
interface ContactRow {
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: "PHONE" | "EMAIL";
  readonly value: string;
}

interface Setup {
  readonly handler: ImportPreviewHandler;
  readonly job: JobRow;
  readonly outcomes: OutcomeRow[];
  readonly audits: AuditRow[];
  readonly writes: CapturedWrite[];
  readonly lookups: CapturedLookup[];
  readonly storageReads: string[];
  readonly storageDeletes: string[];
  readonly customers: CustomerRow[];
  readonly contacts: ContactRow[];
  /** The taxonomy queries the handler issued, so a test can assert it read it once. */
  readonly catalogReads: number;
}

function setup(args: {
  readonly exists?: boolean;
  readonly state?: ImportJobState;
  readonly entity?: "CUSTOMER" | "PATIENT";
  readonly tenantId?: string;
  readonly csv?: string;
  readonly storageError?: boolean;
  readonly customers?: CustomerRow[];
  readonly contacts?: ContactRow[];
  readonly taxonomy?: { id: string; code: string; name: string }[];
  readonly breeds?: { id: string; speciesId: string; code: string; name: string }[];
  readonly existingOutcomes?: OutcomeRow[];
}): Setup {
  const tenantId = args.tenantId ?? TENANT_ID;
  const job: JobRow = {
    id: JOB_ID,
    tenantId,
    entity: args.entity ?? "CUSTOMER",
    state: args.state ?? "UPLOADED",
    storageKey: STORAGE_KEY,
    previewedAt: null,
    failedAt: null,
    failureReason: null,
    createdCount: 0,
    failedCount: 0,
    suspectedDuplicateCount: 0,
  };

  const exists = args.exists ?? true;
  const outcomes: OutcomeRow[] = [...(args.existingOutcomes ?? [])];
  const audits: AuditRow[] = [];
  const writes: CapturedWrite[] = [];
  const lookups: CapturedLookup[] = [];
  const storageReads: string[] = [];
  const storageDeletes: string[] = [];
  const customers = args.customers ?? [];
  const contacts = args.contacts ?? [];
  const taxonomy = args.taxonomy ?? [];
  const breeds = args.breeds ?? [];
  let catalogReads = 0;

  /** The conditional write: only a row matching EVERY predicate is changed. */
  const matchesJob = (where: Record<string, unknown>): boolean =>
    exists && where.id === job.id && where.tenantId === job.tenantId && where.state === job.state;

  const prisma = {
    importJob: {
      findFirst: ({ where }: { where: { id: string } }) =>
        Promise.resolve(exists && where.id === job.id ? { ...job } : null),
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        writes.push({ where, data });
        if (!matchesJob(where)) return Promise.resolve({ count: 0 });
        if (typeof data.state === "string") job.state = data.state as ImportJobState;
        if (data.previewedAt instanceof Date) job.previewedAt = data.previewedAt;
        if (data.failedAt instanceof Date) job.failedAt = data.failedAt;
        if (typeof data.failureReason === "string") job.failureReason = data.failureReason;
        if (typeof data.createdCount === "number") job.createdCount = data.createdCount;
        if (typeof data.failedCount === "number") job.failedCount = data.failedCount;
        if (typeof data.suspectedDuplicateCount === "number") {
          job.suspectedDuplicateCount = data.suspectedDuplicateCount;
        }
        return Promise.resolve({ count: 1 });
      },
    },
    importRowOutcome: {
      deleteMany: ({ where }: { where: { tenantId: string; importId: string } }) => {
        const before = outcomes.length;
        for (let index = outcomes.length - 1; index >= 0; index -= 1) {
          const row = outcomes[index];
          if (row.tenantId === where.tenantId && row.importId === where.importId) {
            outcomes.splice(index, 1);
          }
        }
        return Promise.resolve({ count: before - outcomes.length });
      },
      createMany: ({ data }: { data: readonly OutcomeRow[] }) => {
        outcomes.push(...data.map((row) => ({ ...row })));
        return Promise.resolve({ count: data.length });
      },
    },
    customer: {
      findMany: ({ where }: { where: { tenantId: string; documentNumber: { in: string[] } } }) => {
        lookups.push({ delegate: "customer", where });
        return Promise.resolve(
          customers
            .filter(
              (row) =>
                row.tenantId === where.tenantId &&
                row.documentNumber !== null &&
                where.documentNumber.in.includes(row.documentNumber)
            )
            // Ordered as the handler asks the database to order them: the FIRST
            // customer carrying a value is the one that wins.
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((row) => ({ id: row.id, documentNumber: row.documentNumber }))
        );
      },
    },
    customerContact: {
      findMany: ({ where }: { where: { tenantId: string; value: { in: string[] } } }) => {
        lookups.push({ delegate: "customerContact", where });
        return Promise.resolve(
          contacts
            .filter((row) => row.tenantId === where.tenantId && where.value.in.includes(row.value))
            .sort((left, right) => left.customerId.localeCompare(right.customerId))
            .map((row) => ({ customerId: row.customerId, kind: row.kind, value: row.value }))
        );
      },
    },
    species: {
      findMany: () => {
        catalogReads += 1;
        // The GLOBAL catalog read: species with their breeds, both by name — the shape
        // the handler asks for and the order that settles a `name` collision.
        return Promise.resolve(
          [...taxonomy]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((row) => ({
              ...row,
              breeds: breeds
                .filter((breed) => breed.speciesId === row.id)
                .sort((left, right) => left.name.localeCompare(right.name)),
            }))
        );
      },
    },
    auditLog: {
      create: ({ data }: { data: AuditRow }) => {
        audits.push(data);
        return Promise.resolve({ id: `audit-${audits.length}` });
      },
    },
    $transaction: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(prisma),
  };

  const storage: StoragePort = {
    get: ({ key }) => {
      storageReads.push(key);
      if (args.storageError) {
        return Promise.reject(new Error("object store unreachable for ana@example.com"));
      }
      return Promise.resolve({
        body: Buffer.from(args.csv ?? VALID_CSV, "utf8"),
        contentType: "text/csv",
      });
    },
    put: () => Promise.reject(new Error("not used")),
    delete: ({ key }) => {
      storageDeletes.push(key);
      return Promise.resolve();
    },
    signedUrl: () => Promise.reject(new Error("not used")),
  };

  return {
    handler: new ImportPreviewHandler(prisma as unknown as ImportPreviewPrisma, storage),
    job,
    outcomes,
    audits,
    writes,
    lookups,
    storageReads,
    storageDeletes,
    customers,
    contacts,
    get catalogReads(): number {
      return catalogReads;
    },
  };
}

describe("ImportPreviewHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims the row, replaces the outcomes and moves it to PREVIEWED with the counters", async () => {
    const fixture = setup({});
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    // The claim is pinned on UPLOADED and the settle on PREVIEWING: two conditional
    // writes, neither of which can replay.
    expect(fixture.writes.map((write) => write.where.state)).toEqual(["UPLOADED", "PREVIEWING"]);
    expect(fixture.job.state).toBe("PREVIEWED");
    expect(fixture.job.previewedAt).toBeInstanceOf(Date);
    expect(fixture.job.createdCount).toBe(2);
    expect(fixture.job.failedCount).toBe(0);
    expect(fixture.job.suspectedDuplicateCount).toBe(0);
    // The biconditionals: `FAILED` is the only state that may carry `failed_at`.
    expect(fixture.job.failedAt).toBeNull();
    expect(fixture.job.failureReason).toBeNull();

    expect(fixture.outcomes.map((row) => [row.rowNumber, row.status])).toEqual([
      [1, "CREATE"],
      [2, "CREATE"],
    ]);
    for (const row of fixture.outcomes) {
      expect(row.tenantId).toBe(TENANT_ID);
      expect(row.importId).toBe(JOB_ID);
      // A `CREATE` row carries no reason: there is nothing to explain.
      expect(row.reasonCode).toBeNull();
      expect(row.message).toBeNull();
    }

    // One row per transition, both co-committed, both attributing the JOB.
    expect(fixture.audits.map((row) => row.action)).toEqual([
      "import.previewing",
      "import.previewed",
    ]);
    for (const audit of fixture.audits) {
      expect(audit.actorType).toBe("SYSTEM");
      expect(audit.tenantId).toBe(TENANT_ID);
      expect(audit.targetType).toBe("import_job");
      expect(audit.targetId).toBe(JOB_ID);
    }
    expect(fixture.audits[1].metadata).toMatchObject({
      fromState: "PREVIEWING",
      rowCount: 2,
      createdCount: 2,
      failedCount: 0,
    });

    // The artefact is read ONCE, from the row's own key.
    expect(fixture.storageReads).toEqual([STORAGE_KEY]);
    expect(fixture.storageDeletes).toEqual([]);
  });

  it("counts a per-row refusal as failed, and keeps the row's own stable code", async () => {
    const fixture = setup({ csv: MIXED_CSV });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("PREVIEWED");
    expect(fixture.job.createdCount).toBe(1);
    expect(fixture.job.failedCount).toBe(1);
    expect(fixture.outcomes[1]).toMatchObject({
      rowNumber: 2,
      status: "FAILED",
      reasonCode: "CUSTOMER_ROW_INVALID",
      suspectedDuplicate: false,
    });
    // The message names the condition and never a value from the file.
    expect(fixture.outcomes[1].message).not.toContain("Vet Co");
  });

  it("refuses a missing row without touching the database, storage or the audit trail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({ exists: false });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.writes).toEqual([]);
    expect(fixture.outcomes).toEqual([]);
    expect(fixture.audits).toEqual([]);
    expect(fixture.storageReads).toEqual([]);
    expect(fixture.lookups).toEqual([]);
    // Refused, and SAID so — a silent return is a job nobody can account for.
    expect(warn).toHaveBeenCalled();
  });

  it("refuses an import whose state already moved, without writing anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({ state: "PREVIEWED" });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.writes).toEqual([]);
    expect(fixture.audits).toEqual([]);
    expect(fixture.storageReads).toEqual([]);
    expect(fixture.job.state).toBe("PREVIEWED");
    expect(warn).toHaveBeenCalled();
  });

  it("previews a PATIENT file through the SAME pass: claim, outcomes, counters", async () => {
    const fixture = setup({
      entity: "PATIENT",
      csv: PATIENT_CSV,
      taxonomy: TAXONOMY,
      breeds: BREEDS,
      // Luna is guarded by DOC-9, Michi by the phone number.
      customers: [{ tenantId: TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-9" }],
      contacts: [
        {
          tenantId: TENANT_ID,
          customerId: CUSTOMER_ANA,
          kind: "PHONE",
          value: "0981123456",
        },
      ],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    // The same two conditional writes as a customer preview, in the same order.
    expect(fixture.writes.map((write) => write.where.state)).toEqual(["UPLOADED", "PREVIEWING"]);
    expect(fixture.job.state).toBe("PREVIEWED");
    expect(fixture.job.createdCount).toBe(2);
    expect(fixture.job.failedCount).toBe(0);
    expect(fixture.job.suspectedDuplicateCount).toBe(0);
    expect(fixture.outcomes.map((row) => [row.rowNumber, row.status])).toEqual([
      [1, "CREATE"],
      [2, "CREATE"],
    ]);
    // The taxonomy is read ONCE for the whole file, not once per row.
    expect(fixture.catalogReads).toBe(1);
  });

  it("refuses a patient row whose guardian reference resolves to nobody, and creates nothing", async () => {
    const fixture = setup({
      entity: "PATIENT",
      csv: PATIENT_MIXED_CSV,
      taxonomy: TAXONOMY,
      // DOC-9 exists; "NOBODY" does not resolve to anything.
      customers: [{ tenantId: TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-9" }],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("PREVIEWED");
    expect(fixture.job.createdCount).toBe(1);
    expect(fixture.job.failedCount).toBe(1);
    expect(fixture.outcomes[1]).toMatchObject({
      rowNumber: 2,
      status: "FAILED",
      reasonCode: "PATIENT_ROW_GUARDIAN_PHONE_UNRESOLVED",
    });
  });

  it("resolves a guardian reference ONLY inside the row's tenant", async () => {
    const fixture = setup({
      entity: "PATIENT",
      csv: [PATIENT_HEADERS, "Luna,dog,FEMALE,,,DOC-9,,"].join("\n"),
      taxonomy: TAXONOMY,
      // The only customer carrying DOC-9 belongs to ANOTHER tenant.
      customers: [{ tenantId: OTHER_TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-9" }],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    // A cross-tenant reference is an unresolved reference: the row fails and nothing
    // is linked to another tenant's customer.
    expect(fixture.outcomes[0]).toMatchObject({
      status: "FAILED",
      reasonCode: "PATIENT_ROW_GUARDIAN_DOCUMENT_UNRESOLVED",
    });
    for (const lookup of fixture.lookups) {
      expect(lookup.where.tenantId).toBe(TENANT_ID);
    }
  });

  it("reads the GLOBAL taxonomy with no tenant predicate, and the references with it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({
      entity: "PATIENT",
      csv: [PATIENT_HEADERS, "Luna,dog,FEMALE,,,DOC-9,,"].join("\n"),
      taxonomy: TAXONOMY,
      customers: [{ tenantId: TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-9" }],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // Decision #2211: the taxonomy is shared, so its read carries no tenant at all.
    expect(fixture.catalogReads).toBe(1);
    const customerLookups = fixture.lookups.filter((lookup) => lookup.delegate === "customer");
    expect(customerLookups).toHaveLength(1);
    expect(customerLookups[0].where.tenantId).toBe(TENANT_ID);
  });

  it("fails the job when the artefact cannot be read, instead of leaving it PREVIEWING", async () => {
    const fixture = setup({ storageError: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("FAILED");
    expect(fixture.job.failedAt).toBeInstanceOf(Date);
    expect(fixture.job.failureReason).toContain("IMPORT_PREVIEW_FAILED");
    // The driver's own message is never stored: it is the text most likely to quote
    // what it was reading.
    expect(fixture.job.failureReason).not.toContain("ana@example.com");
    expect(fixture.job.failureReason).not.toContain("unreachable");
    expect(fixture.outcomes).toEqual([]);
    expect(fixture.audits.map((row) => row.action)).toEqual(["import.previewing", "import.failed"]);
    // The lookup is never consulted for a file that could not be read.
    expect(fixture.lookups).toEqual([]);
  });

  it("fails the job with the file's stable code when the header contract is not met", async () => {
    const fixture = setup({ csv: ["kind,phone", ",0981"].join("\n") });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("FAILED");
    expect(fixture.job.failedAt).toBeInstanceOf(Date);
    expect(fixture.job.failureReason).toContain(
      CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER
    );
    expect(fixture.job.failureReason).toContain("display_name");
    expect(fixture.outcomes).toEqual([]);
  });

  it("takes the tenant from the ROW: every write and every lookup is scoped to it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({
      tenantId: OTHER_TENANT_ID,
      customers: [{ tenantId: OTHER_TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-1" }],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    for (const write of fixture.writes) {
      expect(write.where.tenantId).toBe(OTHER_TENANT_ID);
    }
    for (const lookup of fixture.lookups) {
      expect(lookup.where.tenantId).toBe(OTHER_TENANT_ID);
    }
    for (const row of fixture.outcomes) {
      expect(row.tenantId).toBe(OTHER_TENANT_ID);
    }
    for (const audit of fixture.audits) {
      expect(audit.tenantId).toBe(OTHER_TENANT_ID);
    }
  });

  it("scopes the duplicate lookup to the row's tenant: another tenant's customer is not a match", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const foreign = setup({
      customers: [{ tenantId: OTHER_TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-1" }],
      contacts: [
        {
          tenantId: OTHER_TENANT_ID,
          customerId: CUSTOMER_ANA,
          kind: "PHONE",
          value: "0981123456",
        },
      ],
    });

    await foreign.handler.handle({ importJobId: JOB_ID });

    expect(foreign.job.suspectedDuplicateCount).toBe(0);
    expect(foreign.outcomes.map((row) => row.suspectedDuplicate)).toEqual([false, false]);
  });

  it("reports a suspected duplicate as a WARNING on a row that is still CREATE", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({
      customers: [{ tenantId: TENANT_ID, id: CUSTOMER_ANA, documentNumber: "DOC-1" }],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("PREVIEWED");
    expect(fixture.job.createdCount).toBe(2);
    expect(fixture.job.suspectedDuplicateCount).toBe(1);
    // DEC-069: the warning can never become a skip.
    expect(fixture.outcomes[0]).toMatchObject({ status: "CREATE", suspectedDuplicate: true });
    expect(fixture.outcomes[1]).toMatchObject({ status: "CREATE", suspectedDuplicate: false });
  });

  it("matches a contact on (kind, value): the same string under another kind is not a match", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({
      // The file's row 1 carries 0981123456 as a PHONE; this is an EMAIL.
      contacts: [
        { tenantId: TENANT_ID, customerId: CUSTOMER_ANA, kind: "EMAIL", value: "0981123456" },
      ],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.suspectedDuplicateCount).toBe(0);
  });

  it("REPLACES this job's outcomes instead of appending to them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stale: OutcomeRow = {
      tenantId: TENANT_ID,
      importId: JOB_ID,
      rowNumber: 99,
      status: "FAILED",
      reasonCode: "STALE",
      message: "from an earlier pass",
      suspectedDuplicate: false,
    };
    const foreignOutcome: OutcomeRow = {
      tenantId: TENANT_ID,
      importId: "00000000-0000-4000-8000-0000000000ff",
      rowNumber: 1,
      status: "CREATE",
      reasonCode: null,
      message: null,
      suspectedDuplicate: false,
    };
    const fixture = setup({ existingOutcomes: [stale, foreignOutcome] });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.outcomes.map((row) => row.rowNumber).sort()).toEqual([1, 1, 2]);
    expect(
      fixture.outcomes.filter((row) => row.importId === JOB_ID).map((row) => row.rowNumber)
    ).toEqual([1, 2]);
    // The OTHER import's row is untouched: deletion is scoped to this job.
    expect(fixture.outcomes.filter((row) => row.importId !== JOB_ID)).toHaveLength(1);
  });
});
