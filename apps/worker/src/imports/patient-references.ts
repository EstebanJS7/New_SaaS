import {
  createPatientCatalogIndex,
  parseCsv,
  resolvePatientColumns,
  type GuardianLookup,
  type PatientCatalogIndex,
  type PatientCatalogSnapshot,
} from "@newsaas/imports";

/**
 * The patient references one import phase prefetches (EPIC-19 [[IMP-004]]).
 *
 * BOTH PHASES NEED THE SAME TWO ANSWERS, and they need them the same way:
 *
 * - the GLOBAL species/breed taxonomy, so a file's human-typed `species`/`breed` word
 *   becomes a catalog id (`createPatientCatalogIndex` in `@newsaas/imports` owns the
 *   matching rule); and
 * - the tenant's EXISTING customers, so a row's guardian reference resolves to a
 *   `customerId` ([[DEC-070]]).
 *
 * The preview needs them to decide each row's verdict; the commit needs them to
 * rebuild the SAME payloads for the rows the preview accepted, because
 * `import_row_outcome` stores neither the catalog ids nor the guardian. Deriving them
 * twice from two copies of this logic is how a commit could resolve a different
 * guardian than the verdict it is honouring — so the prefetch exists once, here, and
 * both handlers call it.
 *
 * EVERY CUSTOMER QUERY CARRIES THE ROW'S TENANT. The taxonomy one does not, because
 * the catalog is global and must never be tenant-filtered (Decision #2211). That
 * asymmetry is the whole tenant story of this file: a reference belonging to another
 * tenant resolves to NOTHING, which is the row error the Story requires.
 */

/**
 * How wide one reference-lookup query goes.
 *
 * Both lookups are PREFETCHES, because `GuardianLookup` answers SYNCHRONOUSLY (the
 * row contract is a pure function and cannot await) and `createPatientCatalogIndex`
 * builds its maps in one pass. A file can carry more candidate values than a single
 * statement should bind, so the values are asked about in bounded batches: memory
 * stays flat and the parameter count stays far below the driver's limit, at the cost
 * of one round trip per batch.
 */
export const REFERENCE_LOOKUP_CHUNK_SIZE = 500;

/**
 * One tenant customer carrying a document number.
 *
 * `id` is what the guardian resolution answers with; the duplicate heuristic reads the
 * same rows and only needs to know that SOMETHING matched.
 */
export interface ImportCustomerRow {
  readonly id: string;
  readonly documentNumber: string | null;
}

/** One tenant customer contact. `customerId` is the guardian answer for a contact. */
export interface ImportCustomerContactRow {
  readonly customerId: string;
  readonly kind: "PHONE" | "EMAIL";
  readonly value: string;
}

/** One GLOBAL species row with its breeds, as ONE query returns them. */
export interface PatientSpeciesCatalogRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly breeds: readonly {
    readonly id: string;
    readonly speciesId: string;
    readonly code: string;
    readonly name: string;
  }[];
}

/** The `where`/`select`/`orderBy` one document-number batch asks with. */
export interface CustomerDocumentQuery {
  readonly where: {
    readonly tenantId: string;
    readonly documentNumber: { readonly in: string[] };
  };
  readonly select: { readonly id: true; readonly documentNumber: true };
  readonly orderBy: { readonly createdAt: "asc" | "desc" };
}

/** The `where`/`select`/`orderBy` one contact-value batch asks with. */
export interface CustomerContactQuery {
  readonly where: { readonly tenantId: string; readonly value: { readonly in: string[] } };
  readonly select: { readonly customerId: true; readonly kind: true; readonly value: true };
  readonly orderBy: { readonly createdAt: "asc" | "desc" };
}

/**
 * The delegates these prefetches issue, structurally.
 *
 * Declared once so the preview handler and the commit handler cannot disagree about
 * the shape of the two queries they share — and so a test double satisfies one
 * interface rather than two nearly identical ones.
 */
export interface ImportPatientReferencePrisma {
  customer: {
    findMany(args: CustomerDocumentQuery): Promise<ImportCustomerRow[]>;
  };
  customerContact: {
    findMany(args: CustomerContactQuery): Promise<ImportCustomerContactRow[]>;
  };
  /** GLOBAL catalog read: NO tenant predicate (Decision #2211). */
  species: {
    findMany(args: {
      readonly orderBy: { readonly name: "asc" | "desc" };
      readonly include: {
        readonly breeds: { readonly orderBy: { readonly name: "asc" | "desc" } };
      };
    }): Promise<PatientSpeciesCatalogRecord[]>;
  };
}

/**
 * The GLOBAL species/breed taxonomy, in ONE prefetch, in the two shapes the callers
 * need: `lookup` resolves the file's words, `catalog` is what `createPatient`
 * validates the resulting ids against.
 *
 * It is a small, seeded, tenant-agnostic table, so the whole of it is read once per
 * job rather than once per row — the same shape (species with their breeds included,
 * both ordered by name) the API's `PatientsCatalogService` uses. The ordering is not
 * cosmetic: `name` is not unique by constraint, so which row wins a name collision is
 * settled by this order (the row contract keeps the first).
 */
export async function loadPatientCatalog(
  prisma: ImportPatientReferencePrisma
): Promise<PatientCatalogIndex> {
  const species = await prisma.species.findMany({
    orderBy: { name: "asc" },
    include: { breeds: { orderBy: { name: "asc" } } },
  });

  const snapshot: PatientCatalogSnapshot = {
    species: species.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    breeds: species.flatMap((row) =>
      row.breeds.map((breed) => ({
        id: breed.id,
        speciesId: breed.speciesId,
        code: breed.code,
        name: breed.name,
      }))
    ),
  };

  return createPatientCatalogIndex(snapshot);
}

/**
 * The `GuardianLookup`, implemented over Prisma and scoped to the ROW's tenant
 * ([[DEC-070]]).
 *
 * WHAT A MATCH MEANS, and nothing more: any customer of this tenant carrying the
 * document number, or any contact of this tenant carrying the `(kind, value)` pair.
 * There is deliberately NO `isActive` predicate on either query, because
 * `createPatient`'s own guard (`assertTenantCustomer`) accepts an inactive customer
 * too — a resolution stricter than the write it feeds would refuse a reference the
 * create contract allows, and whether a customer is still active is a business
 * judgement the import does not make.
 *
 * A document number is NOT unique in this database, so both queries are ordered by
 * `createdAt` ascending and the FIRST customer carrying the value wins: the tie is
 * settled by a stated rule (the earliest record) rather than by whatever order the
 * planner happened to return.
 */
export async function loadGuardians(
  prisma: ImportPatientReferencePrisma,
  tenantId: string,
  csvText: string
): Promise<GuardianLookup> {
  const candidates = collectGuardianCandidates(csvText);
  const byDocumentNumber = new Map<string, string>();
  const byContact = new Map<string, string>();

  for (const chunk of chunked(candidates.documentNumbers, REFERENCE_LOOKUP_CHUNK_SIZE)) {
    const found = await prisma.customer.findMany({
      where: { tenantId, documentNumber: { in: chunk } },
      select: { id: true, documentNumber: true },
      orderBy: { createdAt: "asc" },
    });
    for (const row of found) {
      if (row.documentNumber === null) continue;
      if (!byDocumentNumber.has(row.documentNumber)) {
        byDocumentNumber.set(row.documentNumber, row.id);
      }
    }
  }

  for (const chunk of chunked(candidates.contactValues, REFERENCE_LOOKUP_CHUNK_SIZE)) {
    const found = await prisma.customerContact.findMany({
      where: { tenantId, value: { in: chunk } },
      select: { customerId: true, kind: true, value: true },
      orderBy: { createdAt: "asc" },
    });
    for (const row of found) {
      const key = contactKey(row.kind, row.value);
      if (!byContact.has(key)) byContact.set(key, row.customerId);
    }
  }

  return {
    byDocumentNumber: (value) => byDocumentNumber.get(value) ?? null,
    byContactValue: (kind, value) => byContact.get(contactKey(kind, value)) ?? null,
  };
}

/** A contact's identity is the PAIR: two kinds may carry the same string. */
function contactKey(kind: "PHONE" | "EMAIL", value: string): string {
  return `${kind}\u0000${value}`;
}

/**
 * The guardian reference values one patient file asks about.
 *
 * It reuses the package's reader and the PATIENT header contract, so this file names
 * no column: a file the reader refuses, or one whose headers do not match the
 * contract, yields no candidates — its phase will refuse it before asking about a
 * single value. Cells are trimmed exactly as the row contract trims them, so the value
 * asked about is the value the planner will ask about.
 *
 * Document numbers and contact values are collected separately because they are
 * different questions: a document number is matched on `customer`, a contact on
 * `customer_contact`. The CONTACT's kind comes from which COLUMN carried the value, so
 * one query answers both guardian contact columns and the `(kind, value)` pair keeps a
 * phone number and an e-mail apart.
 */
function collectGuardianCandidates(csvText: string): {
  readonly documentNumbers: string[];
  readonly contactValues: string[];
} {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { documentNumbers: [], contactValues: [] };

  const columns = resolvePatientColumns(parsed.headers);
  if (!columns.ok) return { documentNumbers: [], contactValues: [] };

  const documentColumn = columns.layout.index.guardianDocument;
  const phoneColumn = columns.layout.index.guardianPhone;
  const emailColumn = columns.layout.index.guardianEmail;

  const documentNumbers = new Set<string>();
  const contactValues = new Set<string>();

  for (const cells of parsed.rows) {
    for (const [column, target] of [
      [documentColumn, documentNumbers],
      [phoneColumn, contactValues],
      [emailColumn, contactValues],
    ] as const) {
      if (column === undefined) continue;
      const cell = (cells[column] ?? "").trim();
      if (cell !== "") target.add(cell);
    }
  }

  return { documentNumbers: [...documentNumbers], contactValues: [...contactValues] };
}

/** Bounds the batch, not the answers: every candidate is still asked about. */
function chunked(values: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
