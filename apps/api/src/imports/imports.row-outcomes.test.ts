import { describe, expect, it } from "vitest";
import { RequestContextService } from "../context/request-context.service.js";
import { ImportRepository, type ImportRowOutcomeRow, type ImportTx } from "./imports.repository.js";

/**
 * IMP-003 repository contract for the summary's page.
 *
 * WHY THIS EXISTS AS ITS OWN SUITE. The API's integration suites run over the
 * in-memory boundary, whose `importRowOutcome.findMany` is a filter and does not
 * implement `take`/`skip` — so an HTTP assertion about `?limit=2&offset=1` could
 * only ever prove the page was ECHOED, never that the database was ASKED for a
 * bounded slice. A summary of a 100 000-row file that quietly reads every row and
 * slices in memory is the unbounded read [[TD-026]] forbids, so the bound is
 * asserted here, at the call the repository actually issues.
 */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";

function row(rowNumber: number, tenantId = TENANT_ID): ImportRowOutcomeRow {
  return {
    id: `outcome-${rowNumber}`,
    tenantId,
    importId: IMPORT_ID,
    rowNumber,
    status: "CREATE",
    reasonCode: null,
    message: null,
    suspectedDuplicate: false,
    createdAt: new Date("2026-10-19T12:00:00.000Z"),
  };
}

function harness(rows: readonly ImportRowOutcomeRow[] = [row(1), row(2)]) {
  const calls: {
    where: Record<string, unknown>;
    orderBy?: unknown;
    take?: number;
    skip?: number;
  }[] = [];

  const client = {
    importJob: {
      findFirst: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
      create: () => Promise.reject(new Error("not used")),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    importRowOutcome: {
      findMany: (args: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
        skip?: number;
      }) => {
        calls.push(args);
        return Promise.resolve([...rows]);
      },
      create: () => Promise.reject(new Error("not used")),
    },
    tenantMembership: { findFirst: () => Promise.resolve(null) },
  } as unknown as ImportTx;

  const context = new RequestContextService();
  const repository = new ImportRepository(client, context);

  const withContext = <T>(work: () => Promise<T>): Promise<T> =>
    context.run("req-summary", async () => {
      context.setTenantMembership({
        tenantId: TENANT_ID,
        membershipId: "33333333-3333-4333-8333-333333333333",
        roleId: "role-owner",
        roleCode: "OWNER",
      });
      return work();
    });

  return { repository, calls, withContext };
}

describe("ImportRepository.listRowOutcomes", () => {
  it("asks the DATABASE for a bounded page, in file order, scoped to the request's tenant", async () => {
    const { repository, calls, withContext } = harness();

    const rows = await withContext(() =>
      repository.listRowOutcomes(IMPORT_ID, { limit: 2, offset: 1 })
    );

    expect(rows.map((entry) => entry.rowNumber)).toEqual([1, 2]);
    // `take`/`skip` at the query, not a slice in memory: one page of an arbitrarily
    // long import must cost one page.
    expect(calls).toEqual([
      {
        where: { tenantId: TENANT_ID, importId: IMPORT_ID },
        orderBy: [{ rowNumber: "asc" }],
        take: 2,
        skip: 1,
      },
    ]);
  });

  it("never builds a query without the tenant predicate", async () => {
    const { repository, calls, withContext } = harness([]);

    // Another tenant's outcomes are not readable even for an import id the caller
    // guessed, because the predicate comes from the request context — never from an
    // argument.
    await withContext(() => repository.listRowOutcomes(IMPORT_ID, { limit: 100, offset: 0 }));

    expect(calls[0]?.where).toEqual({ tenantId: TENANT_ID, importId: IMPORT_ID });
  });

  it("refuses to run outside a request context rather than reading across tenants", async () => {
    const { repository } = harness();

    await expect(repository.listRowOutcomes(IMPORT_ID, { limit: 10, offset: 0 })).rejects.toThrow();
  });
});
