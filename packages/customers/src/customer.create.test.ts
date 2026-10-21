import { describe, expect, it } from "vitest";
import type { AuditAppendInput, AuditAppendTx } from "@newsaas/database";
import { createCustomer, toCustomerResponse } from "./customer.create.js";
import type {
  CustomerAuditAppender,
  CustomerCreateDb,
  CustomerCreateTransaction,
  CustomerRow,
} from "./customer.create.js";
import { createCustomerBody } from "./customer.zod.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = new Date("2026-10-19T12:00:00.000Z");

interface RecordedAppend {
  readonly input: AuditAppendInput;
  readonly tx: AuditAppendTx | undefined;
}

/**
 * A stub of the narrow contracts, and nothing else: no Nest module, no request
 * context, no database. If `createCustomer` ever needs one of those, this test
 * stops compiling — which is the point of the interface ([[DEC-073]]).
 */
function makeHarness(appenderError?: Error) {
  const rows: CustomerRow[] = [];
  const appends: RecordedAppend[] = [];

  const tx: CustomerCreateTransaction = {
    customer: {
      create: ({ data }) => {
        const created: CustomerRow = {
          id: `cust-${rows.length + 1}`,
          tenantId: data.tenantId,
          kind: data.kind,
          displayName: data.displayName,
          legalName: data.legalName ?? null,
          taxId: data.taxId ?? null,
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
          documentNumber: data.documentNumber ?? null,
          isActive: true,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        rows.push(created);
        return Promise.resolve(created);
      },
    },
    auditLog: { create: () => Promise.resolve({ id: "audit-1" }) },
  };

  const db: CustomerCreateDb = {
    $transaction: <T>(work: (scope: CustomerCreateTransaction) => Promise<T>): Promise<T> =>
      work(tx),
  };

  const audit: CustomerAuditAppender = {
    append: (input, txArg) => {
      if (appenderError !== undefined) return Promise.reject(appenderError);
      appends.push({ input, tx: txArg });
      return Promise.resolve({ id: "audit-1" });
    },
  };

  return { rows, appends, tx, db, audit };
}

describe("createCustomer", () => {
  it("creates an INDIVIDUAL customer and co-commits its audit row", async () => {
    const { rows, appends, tx, db, audit } = makeHarness();

    const created = await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: {
        kind: "INDIVIDUAL",
        displayName: "Ana García",
        firstName: "Ana",
        lastName: "García",
      },
    });

    expect(created).toMatchObject({
      tenantId: TENANT_ID,
      kind: "INDIVIDUAL",
      displayName: "Ana García",
      legalName: null,
      taxId: null,
      isActive: true,
    });
    expect(rows).toHaveLength(1);
    expect(appends).toHaveLength(1);
    expect(appends[0]?.input).toMatchObject({
      action: "customer.created",
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      targetType: "customer",
      targetId: created.id,
      metadata: {
        schemaVersion: 1,
        changedFields: ["kind", "displayName", "firstName", "lastName"],
      },
    });
    // The appender receives the SAME transaction: the audit row cannot commit
    // apart from the customer it describes.
    expect(appends[0]?.tx).toBe(tx);
  });

  it("creates a COMPANY customer with the company columns and no individual ones", async () => {
    const { db, audit } = makeHarness();

    const created = await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: {
        kind: "COMPANY",
        displayName: "Paws S.A.",
        legalName: "Paws Sociedad Anónima",
        taxId: "80012345-6",
      },
    });

    expect(created).toMatchObject({
      kind: "COMPANY",
      legalName: "Paws Sociedad Anónima",
      taxId: "80012345-6",
      firstName: null,
      lastName: null,
      documentNumber: null,
    });
  });

  it("never writes an audit row carrying CONFIDENTIAL values", async () => {
    const { appends, db, audit } = makeHarness();

    await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: { kind: "INDIVIDUAL", displayName: "Ana García", documentNumber: "12345678" },
    });

    expect(appends[0]?.input.metadata).toEqual({
      schemaVersion: 1,
      changedFields: ["kind", "displayName", "documentNumber"],
    });
  });

  it("fails the whole create when the audit append fails", async () => {
    const { db, audit } = makeHarness(new Error("audit unavailable"));

    await expect(
      createCustomer({
        db,
        audit,
        tenantId: TENANT_ID,
        actorUserProfileId: ACTOR_ID,
        input: { kind: "INDIVIDUAL", displayName: "Ana" },
      })
    ).rejects.toThrow("audit unavailable");
  });

  it("maps a stored row to the allowlisted response", () => {
    const response = toCustomerResponse({
      id: "cust-1",
      tenantId: TENANT_ID,
      kind: "INDIVIDUAL",
      displayName: "Ana",
      legalName: null,
      taxId: null,
      firstName: "Ana",
      lastName: null,
      documentNumber: null,
      isActive: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(Object.keys(response).sort()).toEqual(
      [
        "id",
        "tenantId",
        "kind",
        "displayName",
        "legalName",
        "taxId",
        "firstName",
        "lastName",
        "documentNumber",
        "createdAt",
        "updatedAt",
        "isActive",
      ].sort()
    );
    expect(response.createdAt).toBe(CREATED_AT.toISOString());
  });
});

describe("the create schema stays the single source of the rules", () => {
  it("rejects a kind-mismatched company field on an INDIVIDUAL", () => {
    expect(
      createCustomerBody.safeParse({ kind: "INDIVIDUAL", displayName: "Ana", taxId: "123" }).success
    ).toBe(false);
  });

  it("accepts the minimal valid payload the create function is called with", () => {
    expect(createCustomerBody.safeParse({ kind: "INDIVIDUAL", displayName: "Ana" }).success).toBe(
      true
    );
  });
});
