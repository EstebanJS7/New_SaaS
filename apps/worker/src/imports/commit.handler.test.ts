import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_COLUMNS_REJECTION_CODES } from "@newsaas/imports";
import type { StoragePort } from "@newsaas/storage";
import { ImportCommitHandler, type ImportCommitPrisma } from "./commit.handler.js";

/**
 * IMP-003 worker handler suite.
 *
 * Driven against a hand-written Prisma double that behaves like a database in the
 * two ways this handler depends on:
 *
 * - `$transaction` is REAL nested scope: a write is applied to a journal at the
 *   current depth and is UNDONE when the work throws, so "the customer, its
 *   contacts and their audit rows commit together" and "a failure in the middle of
 *   a row leaves no half-created customer" are assertions about state, not about
 *   mock call counts;
 * - `updateMany` applies the conditional predicate, so "the claim is a
 *   compare-and-swap pinned on `PREVIEWED`" is a write that either changes the row
 *   or matches nothing.
 *
 * What this file exists to prove, in the Story's words:
 * - the tenant comes from the ROW, and every write and audit row is scoped to it;
 * - a per-row failure is recorded on that row and the run CONTINUES;
 * - the import ends `COMMITTED` with the counters, or `FAILED` with a reason;
 * - a `PATIENT` job writes the patient AND its primary guardian inside the one
 *   transaction `createPatient` opens, and a guardian that cannot be linked rolls the
 *   whole row back ([[IMP-004]], [[DEC-070]]);
 * - a replayed job (already `COMMITTING`) is skipped and writes no record.
 */

type ImportJobState =
  "UPLOADED" | "PREVIEWING" | "PREVIEWED" | "COMMITTING" | "COMMITTED" | "FAILED" | "EXPIRED";

const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-0000000000bb";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-0000000000c1";
const ACTOR_ID = "00000000-0000-4000-8000-0000000000d1";
const STORAGE_KEY = "import_0000000000000000000000";

const HEADERS = "display_name,kind,legal_name,tax_id,document_number,phone,email";

const PATIENT_HEADERS =
  "name,species,sex,breed,birth_date,guardian_document,guardian_phone,guardian_email";

/** Two accepted patients: the first guarded by a document, the second by a phone. */
const PATIENT_CSV = [
  PATIENT_HEADERS,
  "Luna,dog,FEMALE,,2021-04-09,DOC-9,,",
  "Michi,cat,male,,,,0986655443,",
].join("\n");

/**
 * Three patient rows: accepted, accepted with a reference that resolves to nobody, and
 * accepted — the middle one is refused by the row contract, so the COMMIT never sees a
 * payload for it (the preview would never have marked it `CREATE`).
 */
const PATIENT_MIXED_CSV = [
  PATIENT_HEADERS,
  "Luna,dog,FEMALE,,,DOC-9,,",
  "Michi,cat,male,,,,NOBODY,",
  "Toby,dog,male,,,DOC-9,,",
].join("\n");

const SPECIES_DOG = "00000000-0000-4000-8000-0000000000a1";
const SPECIES_CAT = "00000000-0000-4000-8000-0000000000a2";
const GUARDIAN_ID = "00000000-0000-4000-8000-0000000000c1";
const SECOND_GUARDIAN_ID = "00000000-0000-4000-8000-0000000000c2";

/** Two accepted individuals, each with a phone and an e-mail. */
const VALID_CSV = [
  HEADERS,
  "Ana Pérez,,,,DOC-1,0981123456,ana@example.com",
  "Bruno Díaz,,,,DOC-2,0986655443,bruno@example.com",
].join("\n");

interface JobRow {
  id: string;
  tenantId: string;
  entity: "CUSTOMER" | "PATIENT";
  state: ImportJobState;
  storageKey: string;
  createdByMembershipId: string;
  committedAt: Date | null;
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

interface CustomerRowRecord {
  tenantId: string;
  displayName: string;
  documentNumber: string | null;
}

interface PatientRowRecord {
  tenantId: string;
  name: string;
  speciesId: string;
  breedId: string | null;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  birthDate: Date | null;
  isActive: boolean;
}

interface PatientGuardianRowRecord {
  tenantId: string;
  patientId: string;
  customerId: string;
  isPrimary: boolean;
  isActive: boolean;
  position: number;
}

/** A tenant customer, as the guardian prefetch reads it. */
interface LookupCustomerRecord {
  tenantId: string;
  id: string;
  documentNumber: string | null;
}

/** A tenant customer contact, as the guardian prefetch reads it. */
interface LookupContactRecord {
  tenantId: string;
  customerId: string;
  kind: "PHONE" | "EMAIL";
  value: string;
}

interface ContactRowRecord {
  tenantId: string;
  customerId: string;
  kind: "PHONE" | "EMAIL";
  value: string;
  isPrimary: boolean;
}

interface AuditRow {
  action: string;
  actorType?: string;
  actorUserProfileId?: string;
  tenantId?: string;
  targetType?: string;
  targetId?: string;
  metadata: Record<string, unknown>;
}

/** One journaled write, with the transaction depth it was made at. */
interface JournalEntry {
  readonly depth: number;
  readonly undo: () => void;
}

interface Setup {
  readonly handler: ImportCommitHandler;
  readonly job: JobRow;
  readonly outcomes: OutcomeRow[];
  readonly customers: CustomerRowRecord[];
  readonly contacts: ContactRowRecord[];
  readonly patients: PatientRowRecord[];
  readonly patientGuardians: PatientGuardianRowRecord[];
  readonly audits: AuditRow[];
  readonly journal: JournalEntry[];
  readonly writes: { where: Record<string, unknown>; data: Record<string, unknown> }[];
  readonly storageReads: string[];
}

function setup(args: {
  readonly exists?: boolean;
  readonly state?: ImportJobState;
  readonly entity?: "CUSTOMER" | "PATIENT";
  readonly tenantId?: string;
  readonly csv?: string;
  readonly storageError?: boolean;
  readonly outcomes?: readonly OutcomeRow[];
  /** Display names whose insert throws, simulating a constraint violation. */
  readonly customerFailsOn?: readonly string[];
  /** Contact values whose insert throws, so a row fails AFTER its customer insert. */
  readonly contactFailsOn?: readonly string[];
  /** Patient names whose insert throws, simulating a constraint violation. */
  readonly patientFailsOn?: readonly string[];
  readonly membershipMissing?: boolean;
  /** The tenant customers a guardian reference may resolve to. */
  readonly lookupCustomers?: readonly LookupCustomerRecord[];
  /** The tenant customer contacts a guardian reference may resolve to. */
  readonly lookupContacts?: readonly LookupContactRecord[];
  readonly taxonomy?: readonly { id: string; code: string; name: string }[];
  readonly breeds?: readonly { id: string; speciesId: string; code: string; name: string }[];
}): Setup {
  const tenantId = args.tenantId ?? TENANT_ID;
  const job: JobRow = {
    id: JOB_ID,
    tenantId,
    entity: args.entity ?? "CUSTOMER",
    state: args.state ?? "PREVIEWED",
    storageKey: STORAGE_KEY,
    createdByMembershipId: MEMBERSHIP_ID,
    committedAt: null,
    failedAt: null,
    failureReason: null,
    createdCount: 0,
    failedCount: 0,
    suspectedDuplicateCount: 0,
  };

  const exists = args.exists ?? true;
  const outcomes: OutcomeRow[] = [...(args.outcomes ?? [])];
  const customers: CustomerRowRecord[] = [];
  const contacts: ContactRowRecord[] = [];
  const patients: PatientRowRecord[] = [];
  const patientGuardians: PatientGuardianRowRecord[] = [];
  const lookupCustomers = [...(args.lookupCustomers ?? [])];
  const lookupContacts = [...(args.lookupContacts ?? [])];
  const taxonomy = args.taxonomy ?? [];
  const breeds = args.breeds ?? [];
  const audits: AuditRow[] = [];
  const journal: JournalEntry[] = [];
  const writes: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const storageReads: string[] = [];
  let depth = 0;

  const record = (undo: () => void): void => {
    journal.push({ depth, undo });
  };

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

        const previous = { ...job };
        if (typeof data.state === "string") job.state = data.state as ImportJobState;
        if (data.committedAt instanceof Date) job.committedAt = data.committedAt;
        if (data.failedAt instanceof Date) job.failedAt = data.failedAt;
        if (typeof data.failureReason === "string") job.failureReason = data.failureReason;
        if (typeof data.createdCount === "number") job.createdCount = data.createdCount;
        if (typeof data.failedCount === "number") job.failedCount = data.failedCount;
        if (typeof data.suspectedDuplicateCount === "number") {
          job.suspectedDuplicateCount = data.suspectedDuplicateCount;
        }
        record(() => Object.assign(job, previous));
        return Promise.resolve({ count: 1 });
      },
    },
    importRowOutcome: {
      findMany: ({ where }: { where: { tenantId: string; importId: string } }) =>
        Promise.resolve(
          outcomes
            .filter((row) => row.tenantId === where.tenantId && row.importId === where.importId)
            .sort((left, right) => left.rowNumber - right.rowNumber)
            .map((row) => ({ ...row }))
        ),
      updateMany: ({
        where,
        data,
      }: {
        where: { tenantId: string; importId: string; rowNumber: number };
        data: Record<string, unknown>;
      }) => {
        const target = outcomes.find(
          (row) =>
            row.tenantId === where.tenantId &&
            row.importId === where.importId &&
            row.rowNumber === where.rowNumber
        );
        if (!target) return Promise.resolve({ count: 0 });

        const previous = { ...target };
        if (typeof data.status === "string") target.status = data.status as "CREATE" | "FAILED";
        if (data.reasonCode !== undefined) target.reasonCode = data.reasonCode as string | null;
        if (data.message !== undefined) target.message = data.message as string | null;
        record(() => Object.assign(target, previous));
        return Promise.resolve({ count: 1 });
      },
    },
    customer: {
      create: ({ data }: { data: CustomerRowRecord }) => {
        if (args.customerFailsOn?.includes(data.displayName) === true) {
          return Promise.reject(new Error(`duplicate key value for ${data.displayName}`));
        }
        const created = { ...data };
        customers.push(created);
        record(() => customers.splice(customers.indexOf(created), 1));
        return Promise.resolve({ id: `cust-${customers.length}`, ...data });
      },
      /** The guardian resolution's document-number batch. */
      findMany: ({ where }: { where: { tenantId: string; documentNumber: { in: string[] } } }) =>
        Promise.resolve(
          lookupCustomers
            .filter(
              (row) =>
                row.tenantId === where.tenantId &&
                row.documentNumber !== null &&
                where.documentNumber.in.includes(row.documentNumber)
            )
            .map((row) => ({ id: row.id, documentNumber: row.documentNumber }))
        ),
      /** `createPatient`'s own guard on the guardian link: id AND tenant. */
      findFirst: ({ where }: { where: { id: string; tenantId: string } }) =>
        Promise.resolve(
          lookupCustomers.some((row) => row.id === where.id && row.tenantId === where.tenantId)
            ? { id: where.id }
            : null
        ),
    },
    customerContact: {
      create: ({
        data,
      }: {
        data: Omit<ContactRowRecord, "customerId"> & { customerId: string };
      }) => {
        if (args.contactFailsOn?.includes(data.value) === true) {
          return Promise.reject(new Error(`contact insert failed for ${data.value}`));
        }
        const created: ContactRowRecord = { ...data };
        contacts.push(created);
        record(() => contacts.splice(contacts.indexOf(created), 1));
        return Promise.resolve({ id: `contact-${contacts.length}` });
      },
      /** The guardian resolution's contact-value batch (the import's own read). */
      findMany: ({ where }: { where: { tenantId: string; value: { in: string[] } } }) =>
        Promise.resolve(
          lookupContacts
            .filter((row) => row.tenantId === where.tenantId && where.value.in.includes(row.value))
            .map((row) => ({ customerId: row.customerId, kind: row.kind, value: row.value }))
        ),
    },
    species: {
      findMany: () =>
        Promise.resolve(
          [...taxonomy]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((row) => ({
              ...row,
              breeds: breeds.filter((breed) => breed.speciesId === row.id),
            }))
        ),
    },
    patient: {
      create: ({ data }: { data: PatientRowRecord }) => {
        if (args.patientFailsOn?.includes(data.name) === true) {
          return Promise.reject(new Error(`insert or update violates constraint for ${data.name}`));
        }
        const created = { ...data };
        patients.push(created);
        record(() => patients.splice(patients.indexOf(created), 1));
        return Promise.resolve({
          ...data,
          id: `patient-${patients.length}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      },
    },
    patientGuardian: {
      findFirst: ({
        where,
      }: {
        where: {
          tenantId: string;
          patientId: string;
          customerId?: string;
          isPrimary?: boolean;
          isActive?: boolean;
        };
      }) => {
        const found = patientGuardians.find(
          (row) =>
            row.tenantId === where.tenantId &&
            row.patientId === where.patientId &&
            (where.customerId === undefined || row.customerId === where.customerId) &&
            (where.isPrimary === undefined || row.isPrimary === where.isPrimary) &&
            (where.isActive === undefined || row.isActive === where.isActive)
        );
        return Promise.resolve(found === undefined ? null : { id: "link", ...found });
      },
      create: ({ data }: { data: PatientGuardianRowRecord }) => {
        const created = { ...data };
        patientGuardians.push(created);
        record(() => patientGuardians.splice(patientGuardians.indexOf(created), 1));
        return Promise.resolve({ id: `guardian-${patientGuardians.length}`, ...data });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; tenantId: string; patientId: string };
        data: { isPrimary?: boolean; isActive?: boolean };
      }) => {
        const target = patientGuardians.find(
          (row) =>
            row.tenantId === where.tenantId &&
            row.patientId === where.patientId &&
            `guardian-${patientGuardians.indexOf(row) + 1}` === where.id
        );
        if (target === undefined) return Promise.resolve({ count: 0 });
        const previous = { ...target };
        if (data.isPrimary !== undefined) target.isPrimary = data.isPrimary;
        if (data.isActive !== undefined) target.isActive = data.isActive;
        record(() => Object.assign(target, previous));
        return Promise.resolve({ count: 1 });
      },
    },
    tenantMembership: {
      findFirst: ({ where }: { where: { id: string; tenantId: string } }) => {
        const resolved =
          args.membershipMissing !== true &&
          where.id === MEMBERSHIP_ID &&
          where.tenantId === job.tenantId;
        return Promise.resolve(resolved ? { userProfileId: ACTOR_ID } : null);
      },
    },
    auditLog: {
      create: ({ data }: { data: AuditRow }) => {
        const created: AuditRow = { ...data };
        audits.push(created);
        record(() => audits.splice(audits.indexOf(created), 1));
        return Promise.resolve({ id: `audit-${audits.length}` });
      },
    },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      depth += 1;
      const before = journal.length;
      try {
        return await work(prisma);
      } catch (error) {
        // ROLLBACK: every write made inside this transaction is undone, newest first,
        // which is what makes the per-row boundary observable as state.
        for (let index = journal.length - 1; index >= before; index -= 1) {
          journal[index]?.undo();
        }
        journal.length = before;
        throw error;
      } finally {
        depth -= 1;
      }
    },
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
    delete: () => Promise.reject(new Error("not used")),
    signedUrl: () => Promise.reject(new Error("not used")),
  };

  return {
    handler: new ImportCommitHandler(prisma as unknown as ImportCommitPrisma, storage),
    job,
    outcomes,
    customers,
    contacts,
    patients,
    patientGuardians,
    audits,
    journal,
    writes,
    storageReads,
  };
}

/**
 * The patient fixture's argument set: the taxonomy, and the customer each reference
 * resolves to.
 *
 * `DOC-9` belongs to the first guardian and `0986655443` to the second, so a test can
 * tell a document match from a contact match. Both live in the ROW's tenant, which is
 * what makes them resolvable at all.
 */
function patientFixture(overrides: { readonly csv?: string } = {}): Parameters<typeof setup>[0] {
  return {
    entity: "PATIENT",
    csv: overrides.csv ?? PATIENT_CSV,
    taxonomy: [
      { id: SPECIES_DOG, code: "DOG", name: "Dog" },
      { id: SPECIES_CAT, code: "CAT", name: "Cat" },
    ],
    breeds: [],
    lookupCustomers: [
      { tenantId: TENANT_ID, id: GUARDIAN_ID, documentNumber: "DOC-9" },
      { tenantId: TENANT_ID, id: SECOND_GUARDIAN_ID, documentNumber: "DOC-10" },
    ],
    lookupContacts: [
      {
        tenantId: TENANT_ID,
        customerId: SECOND_GUARDIAN_ID,
        kind: "PHONE",
        value: "0986655443",
      },
    ],
  };
}

/** One accepted outcome per data row of {@link VALID_CSV}. */
function accepted(rowNumbers: readonly number[], duplicate = false): OutcomeRow[] {
  return rowNumbers.map((rowNumber) => ({
    tenantId: TENANT_ID,
    importId: JOB_ID,
    rowNumber,
    status: "CREATE",
    reasonCode: null,
    message: null,
    suspectedDuplicate: duplicate && rowNumber === rowNumbers[0],
  }));
}

describe("ImportCommitHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims, writes one customer per accepted row with its contacts, and commits with the counters", async () => {
    const fixture = setup({ outcomes: accepted([1, 2]) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    // The claim is pinned on PREVIEWED and the settle on COMMITTING: two
    // conditional writes, neither of which can replay.
    expect(fixture.writes.map((write) => write.where.state)).toEqual(["PREVIEWED", "COMMITTING"]);
    expect(fixture.job.state).toBe("COMMITTED");
    expect(fixture.job.committedAt).toBeInstanceOf(Date);
    expect(fixture.job.createdCount).toBe(2);
    expect(fixture.job.failedCount).toBe(0);
    expect(fixture.job.suspectedDuplicateCount).toBe(0);
    // The biconditionals: `FAILED` is the only state that may carry `failed_at`.
    expect(fixture.job.failedAt).toBeNull();
    expect(fixture.job.failureReason).toBeNull();

    // The records go through `createCustomer`, so the customer and its contacts
    // are one write path — including the phone the row carried.
    expect(fixture.customers.map((row) => row.displayName)).toEqual(["Ana Pérez", "Bruno Díaz"]);
    expect(fixture.contacts.map((row) => [row.kind, row.value])).toEqual([
      ["PHONE", "0981123456"],
      ["EMAIL", "ana@example.com"],
      ["PHONE", "0986655443"],
      ["EMAIL", "bruno@example.com"],
    ]);

    // The import's own transitions are audited; the customer rows carry their own
    // `customer.created` / `customer_contact.created` trails from the domain call.
    expect(fixture.audits.map((row) => row.action)).toEqual([
      "import.committing",
      "customer.created",
      "customer_contact.created",
      "customer_contact.created",
      "customer.created",
      "customer_contact.created",
      "customer_contact.created",
      "import.committed",
    ]);
    expect(fixture.audits.at(-1)?.metadata).toMatchObject({
      fromState: "COMMITTING",
      createdCount: 2,
      failedCount: 0,
      suspectedDuplicateCount: 0,
    });

    // The artefact is read ONCE, from the row's own key — the SAME key the preview
    // read ([[DEC-072]]: `import_job.storage_key`).
    expect(fixture.storageReads).toEqual([STORAGE_KEY]);
  });

  it("writes the customer, its contacts and their audit rows in ONE transaction per row", async () => {
    const fixture = setup({ outcomes: accepted([1]) });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // Every customer/contact/audit write of the row happened at depth 1 and the
    // transaction that owns them also wrote the customer's row — a customer can
    // never commit without its contacts or its trail.
    const rowWrites = fixture.journal.filter((entry) => entry.depth === 1);
    expect(rowWrites.length).toBeGreaterThanOrEqual(4);
    expect(
      fixture.journal.filter((entry) => entry.depth === 0 && entry.depth !== undefined)
    ).toEqual([]);
  });

  it("rolls the whole ROW back when a contact fails, records it, and CONTINUES to the next row", async () => {
    const fixture = setup({
      outcomes: accepted([1, 2]),
      contactFailsOn: ["0981123456"],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("COMMITTED");
    // Row 1's customer insert was rolled back with the failed contact: no
    // half-created customer survives, which is the Story's row-level invariant.
    expect(fixture.customers.map((row) => row.displayName)).toEqual(["Bruno Díaz"]);
    expect(fixture.contacts.map((row) => row.value)).toEqual(["0986655443", "bruno@example.com"]);
    expect(fixture.job.createdCount).toBe(1);
    expect(fixture.job.failedCount).toBe(1);
    // The failed row says so, with a bounded reason that quotes nothing.
    expect(fixture.outcomes.find((row) => row.rowNumber === 1)).toMatchObject({
      status: "FAILED",
      reasonCode: "IMPORT_ROW_COMMIT_FAILED",
    });
    expect(fixture.outcomes.find((row) => row.rowNumber === 1)?.message).not.toContain("Ana");
    expect(JSON.stringify(fixture.outcomes)).not.toContain("contact insert failed");
  });

  it("counts the preview's refusals in `failed` and never writes those rows", async () => {
    const fixture = setup({
      outcomes: [
        { ...accepted([1])[0] },
        {
          tenantId: TENANT_ID,
          importId: JOB_ID,
          rowNumber: 2,
          status: "FAILED",
          reasonCode: "CUSTOMER_ROW_INVALID",
          message: "The row does not satisfy the customer create contract.",
          suspectedDuplicate: false,
        },
      ],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.customers.map((row) => row.displayName)).toEqual(["Ana Pérez"]);
    expect(fixture.job.createdCount).toBe(1);
    expect(fixture.job.failedCount).toBe(1);
  });

  it("carries the suspected-duplicate warning into the counters of a row it created", async () => {
    const fixture = setup({ outcomes: accepted([1, 2], true) });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // DEC-069: the warned row is still CREATED, and the warning survives the
    // commit so the summary can report it.
    expect(fixture.job.createdCount).toBe(2);
    expect(fixture.job.suspectedDuplicateCount).toBe(1);
    expect(fixture.customers).toHaveLength(2);
  });

  it("commits a PATIENT file: the patient AND its primary guardian in one transaction", async () => {
    const fixture = setup({ ...patientFixture(), outcomes: accepted([1]) });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // The same two conditional writes as a customer commit, pinned on the same states.
    expect(fixture.writes.map((write) => write.where.state)).toEqual(["PREVIEWED", "COMMITTING"]);
    expect(fixture.job.state).toBe("COMMITTED");
    expect(fixture.job.createdCount).toBe(1);
    expect(fixture.job.failedCount).toBe(0);

    // The patient, resolved through the GLOBAL catalog from the file's own words.
    expect(fixture.patients).toHaveLength(1);
    const patient = fixture.patients[0];
    expect(patient.tenantId).toBe(TENANT_ID);
    expect(patient.name).toBe("Luna");
    expect(patient.speciesId).toBe(SPECIES_DOG);
    expect(patient.breedId).toBeNull();
    expect(patient.sex).toBe("FEMALE");
    expect(patient.birthDate?.toISOString()).toBe("2021-04-09T12:00:00.000Z");
    // ACTIVE: the import never takes `isActive` from the file ([[IMP-004]]).
    expect(patient.isActive).toBe(true);

    // The guardian: ACTIVE, PRIMARY, and the customer the reference resolved to.
    expect(fixture.patientGuardians).toHaveLength(1);
    expect(fixture.patientGuardians[0]).toMatchObject({
      tenantId: TENANT_ID,
      patientId: "patient-1",
      customerId: GUARDIAN_ID,
      isPrimary: true,
      isActive: true,
    });

    // Patient, link and both audit rows are written INSIDE one transaction — the one
    // `createPatient` opened — which is what the deferred
    // `patient_exactly_one_primary_guardian` trigger requires.
    const rowWrites = fixture.journal.filter((entry) => entry.depth === 1);
    expect(rowWrites.length).toBeGreaterThanOrEqual(4);
    expect(fixture.audits.map((row) => row.action)).toEqual([
      "import.committing",
      "patient.created",
      "patient_guardian.created",
      "import.committed",
    ]);
    expect(fixture.audits[1].actorUserProfileId).toBe(ACTOR_ID);
  });

  it("resolves a patient's guardian through a CONTACT value when the file names no document", async () => {
    const fixture = setup({
      ...patientFixture({ csv: [PATIENT_HEADERS, "Michi,cat,male,,,,0986655443,"].join("\n") }),
      outcomes: accepted([1]),
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.patients[0].speciesId).toBe(SPECIES_CAT);
    expect(fixture.patientGuardians[0].customerId).toBe(SECOND_GUARDIAN_ID);
  });

  it("never reaches the commit for a row whose guardian did not resolve: the preview refused it", async () => {
    const fixture = setup({
      ...patientFixture({ csv: PATIENT_MIXED_CSV }),
      // The preview accepted rows 1 and 3 and refused row 2 (its reference resolved to
      // nobody), which is what the stored outcomes say.
      outcomes: [
        { ...accepted([1])[0] },
        {
          tenantId: TENANT_ID,
          importId: JOB_ID,
          rowNumber: 2,
          status: "FAILED",
          reasonCode: "PATIENT_ROW_GUARDIAN_PHONE_UNRESOLVED",
          message: 'The "guardian_phone" value matches no customer in this tenant.',
          suspectedDuplicate: false,
        },
        { ...accepted([3])[0] },
      ],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // The refused row produced no patient at all — not a half-created one.
    expect(fixture.patients.map((row) => row.name)).toEqual(["Luna", "Toby"]);
    expect(fixture.patientGuardians).toHaveLength(2);
    expect(fixture.job.createdCount).toBe(2);
    expect(fixture.job.failedCount).toBe(1);
  });

  it("rolls a patient ROW back when its guardian cannot be linked, and CONTINUES", async () => {
    const fixture = setup({
      // The second row's reference resolves to nobody, so `createPatient`'s guardian
      // guard refuses it AFTER the patient insert inside the same transaction.
      ...patientFixture({
        csv: [PATIENT_HEADERS, "Luna,dog,FEMALE,,,DOC-9,,", "Michi,cat,male,,,,NOBODY,"].join("\n"),
      }),
      outcomes: accepted([1, 2]),
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // The half-created patient of row 2 is GONE: the transaction that inserted it
    // rolled back when the guardian link threw.
    expect(fixture.patients.map((row) => row.name)).toEqual(["Luna"]);
    expect(fixture.patientGuardians).toHaveLength(1);
    expect(fixture.job.state).toBe("COMMITTED");
    expect(fixture.job.createdCount).toBe(1);
    expect(fixture.job.failedCount).toBe(1);
    expect(fixture.outcomes.find((row) => row.rowNumber === 2)).toMatchObject({
      status: "FAILED",
      reasonCode: "IMPORT_ROW_COMMIT_FAILED",
    });
    // Nothing about the failure quotes the record it was writing.
    expect(JSON.stringify(fixture.outcomes)).not.toContain("Customer was not found");
  });

  it("SKIPS a replayed job: a row that is already COMMITTING writes no second record", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({ state: "COMMITTING", outcomes: accepted([1]) });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.writes).toEqual([]);
    expect(fixture.customers).toEqual([]);
    expect(fixture.storageReads).toEqual([]);
    expect(fixture.job.state).toBe("COMMITTING");
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a terminal import and a missing row without touching anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const committed = setup({ state: "COMMITTED", outcomes: accepted([1]) });
    const missing = setup({ exists: false, outcomes: accepted([1]) });

    await committed.handler.handle({ importJobId: JOB_ID });
    await missing.handler.handle({ importJobId: JOB_ID });

    for (const fixture of [committed, missing]) {
      expect(fixture.writes).toEqual([]);
      expect(fixture.customers).toEqual([]);
      expect(fixture.audits).toEqual([]);
      expect(fixture.storageReads).toEqual([]);
    }
    expect(committed.job.state).toBe("COMMITTED");
    expect(warn).toHaveBeenCalled();
  });

  it("fails the job and writes nothing when the preview accepted no row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({
      outcomes: [
        {
          tenantId: TENANT_ID,
          importId: JOB_ID,
          rowNumber: 1,
          status: "FAILED",
          reasonCode: "CUSTOMER_ROW_INVALID",
          message: "The row does not satisfy the customer create contract.",
          suspectedDuplicate: false,
        },
      ],
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    // Committing nothing is not a partial success; the artefact is not even read.
    expect(fixture.job.state).toBe("FAILED");
    expect(fixture.job.failedAt).toBeInstanceOf(Date);
    expect(fixture.job.failureReason).toContain("IMPORT_COMMIT_NO_VALID_ROWS");
    expect(fixture.customers).toEqual([]);
    expect(fixture.job.createdCount).toBe(0);
    expect(fixture.storageReads).toEqual([]);
    expect(fixture.audits.map((row) => row.action)).toEqual(["import.committing", "import.failed"]);
  });

  it("fails the job when the artefact cannot be read, instead of leaving it COMMITTING", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({ storageError: true, outcomes: accepted([1]) });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("FAILED");
    expect(fixture.job.failedAt).toBeInstanceOf(Date);
    expect(fixture.job.failureReason).toContain("IMPORT_COMMIT_FAILED");
    // The driver's own message is never stored: it is the text most likely to quote
    // what it was reading.
    expect(fixture.job.failureReason).not.toContain("ana@example.com");
    expect(fixture.customers).toEqual([]);
  });

  it("fails the job with the file's stable code when the header contract is not met", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = setup({
      csv: ["kind,phone", ",0981"].join("\n"),
      outcomes: accepted([1]),
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    expect(fixture.job.state).toBe("FAILED");
    expect(fixture.job.failureReason).toContain(
      CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER
    );
    expect(fixture.customers).toEqual([]);
  });

  it("takes the tenant from the ROW: every write, record and audit row is scoped to it", async () => {
    const fixture = setup({
      tenantId: OTHER_TENANT_ID,
      outcomes: accepted([1]).map((row) => ({ ...row, tenantId: OTHER_TENANT_ID })),
    });

    await fixture.handler.handle({ importJobId: JOB_ID });

    for (const write of fixture.writes) {
      expect(write.where.tenantId).toBe(OTHER_TENANT_ID);
    }
    for (const customer of fixture.customers) {
      expect(customer.tenantId).toBe(OTHER_TENANT_ID);
    }
    for (const contact of fixture.contacts) {
      expect(contact.tenantId).toBe(OTHER_TENANT_ID);
    }
    for (const audit of fixture.audits) {
      expect(audit.tenantId).toBe(OTHER_TENANT_ID);
    }
    // The customer's own trail is attributed to the row's uploader, not to SYSTEM:
    // a person asked for this record.
    const customerAudit = fixture.audits.find((row) => row.action === "customer.created");
    expect(customerAudit?.actorUserProfileId).toBe(ACTOR_ID);
  });

  it("propagates a missing uploader BEFORE the claim, so the retry is honest", async () => {
    const fixture = setup({ membershipMissing: true, outcomes: accepted([1]) });

    await expect(fixture.handler.handle({ importJobId: JOB_ID })).rejects.toThrow(
      /uploading membership could not be resolved/
    );

    // Nothing was claimed: the row is still PREVIEWED and can be retried.
    expect(fixture.job.state).toBe("PREVIEWED");
    expect(fixture.writes).toEqual([]);
    expect(fixture.customers).toEqual([]);
  });
});
