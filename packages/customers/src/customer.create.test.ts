import { describe, expect, it } from "vitest";
import type { AuditAppendInput, AuditAppendTx } from "@newsaas/database";
import { createCustomer, toCustomerResponse } from "./customer.create.js";
import type {
  CustomerAuditAppender,
  CustomerContactCreateData,
  CustomerCreateDb,
  CustomerCreateTransaction,
  CustomerRow,
} from "./customer.create.js";
import { createCustomerBody, updateCustomerBody } from "./customer.zod.js";

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
  const contacts: ({ id: string } & CustomerContactCreateData)[] = [];

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
          fiscalOperationType: data.fiscalOperationType ?? null,
          isActive: true,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        rows.push(created);
        return Promise.resolve(created);
      },
    },
    customerContact: {
      create: ({ data }) => {
        const created = { id: `contact-${contacts.length + 1}`, ...data };
        contacts.push(created);
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

  return { rows, appends, contacts, tx, db, audit };
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

  it("creates the customer's contacts in the SAME transaction, each with its own audit row", async () => {
    const { rows, appends, contacts, tx, db, audit } = makeHarness();

    const created = await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: { kind: "INDIVIDUAL", displayName: "Ana García" },
      contacts: [
        { kind: "PHONE", value: "0981123456", isPrimary: true },
        { kind: "EMAIL", value: "ana@example.com", isPrimary: true },
      ],
    });

    // IMP-003: a customer imported with a phone number must not be able to exist
    // without it, so the contact rows are written inside the customer's own
    // transaction — the SAME handle the audit appender receives.
    expect(rows).toHaveLength(1);
    expect(contacts).toEqual([
      {
        id: "contact-1",
        tenantId: TENANT_ID,
        customerId: created.id,
        kind: "PHONE",
        label: null,
        value: "0981123456",
        isPrimary: true,
      },
      {
        id: "contact-2",
        tenantId: TENANT_ID,
        customerId: created.id,
        kind: "EMAIL",
        label: null,
        value: "ana@example.com",
        isPrimary: true,
      },
    ]);

    // The audit trail names the customer first and then each contact, with the
    // endpoint's own action, target type and changed-field list.
    expect(appends.map((entry) => entry.input.action)).toEqual([
      "customer.created",
      "customer_contact.created",
      "customer_contact.created",
    ]);
    expect(appends[1]?.input).toMatchObject({
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      targetType: "customer_contact",
      targetId: "contact-1",
      metadata: {
        schemaVersion: 1,
        changedFields: ["kind", "value", "isPrimary"],
        customerId: created.id,
      },
    });
    expect(appends[2]?.input.targetId).toBe("contact-2");
    for (const append of appends) {
      expect(append.tx).toBe(tx);
    }
    // No contact value reaches an audit row: the metadata names fields only.
    expect(JSON.stringify(appends.map((entry) => entry.input))).not.toContain("0981123456");
    expect(JSON.stringify(appends.map((entry) => entry.input))).not.toContain("ana@example.com");
  });

  it("writes the declared fiscal operation type and names it in the create audit row", async () => {
    const { rows, appends, db, audit } = makeHarness();

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
        fiscalOperationType: "B2B",
      },
    });

    // DEC-057 Q2: `iTiOpe` is the tenant's declaration, so the row carries it
    // verbatim and the response reports it back to the endpoint's caller.
    expect(rows[0]?.fiscalOperationType).toBe("B2B");
    expect(toCustomerResponse(created).fiscalOperationType).toBe("B2B");
    expect(appends[0]?.input.metadata).toMatchObject({
      changedFields: ["kind", "displayName", "legalName", "taxId", "fiscalOperationType"],
    });
    // The audit row names the field, never the declared value's neighbours.
    expect(JSON.stringify(appends[0]?.input)).not.toContain("Paws Sociedad");
  });

  it("leaves the operation type undeclared when the create payload omits it", async () => {
    const { rows, appends, db, audit } = makeHarness();

    const created = await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: { kind: "INDIVIDUAL", displayName: "Ana García" },
    });

    // No default is invented from `kind` and no value is guessed: null is the
    // intentional "not declared" state the issuance read refuses on.
    expect(rows[0]?.fiscalOperationType).toBeNull();
    expect(toCustomerResponse(created).fiscalOperationType).toBeNull();
    expect(appends[0]?.input.metadata).toMatchObject({
      changedFields: ["kind", "displayName"],
    });
  });

  it("keeps an explicitly null declaration undeclared", async () => {
    const { rows, db, audit } = makeHarness();

    await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: { kind: "INDIVIDUAL", displayName: "Ana García", fiscalOperationType: null },
    });

    expect(rows[0]?.fiscalOperationType).toBeNull();
  });

  it("behaves exactly as before when no contacts are given", async () => {
    const { appends, contacts, db, audit } = makeHarness();

    const created = await createCustomer({
      db,
      audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: { kind: "INDIVIDUAL", displayName: "Ana" },
    });

    // `POST /customers` passes nothing here, and its one audit row is the only
    // difference it can observe.
    expect(created.displayName).toBe("Ana");
    expect(contacts).toEqual([]);
    expect(appends).toHaveLength(1);
    expect(appends[0]?.input.action).toBe("customer.created");
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
      fiscalOperationType: "B2G",
      isActive: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(response.fiscalOperationType).toBe("B2G");
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
        "fiscalOperationType",
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

  it.each(["B2B", "B2C", "B2G", "B2F"] as const)(
    "accepts the declared fiscal operation type %s on either kind",
    (fiscalOperationType) => {
      expect(
        createCustomerBody.safeParse({
          kind: "INDIVIDUAL",
          displayName: "Ana",
          fiscalOperationType,
        }).success
      ).toBe(true);
      expect(
        createCustomerBody.safeParse({
          kind: "COMPANY",
          displayName: "Paws S.A.",
          legalName: "Paws Sociedad Anónima",
          taxId: "80012345-6",
          fiscalOperationType,
        }).success
      ).toBe(true);
    }
  );

  it("rejects a fiscal operation type the schema does not define", () => {
    expect(
      createCustomerBody.safeParse({
        kind: "INDIVIDUAL",
        displayName: "Ana",
        fiscalOperationType: "B2X",
      }).success
    ).toBe(false);
    expect(updateCustomerBody.safeParse({ fiscalOperationType: "b2b" }).success).toBe(false);
  });

  it("keeps an absent declaration absent and an explicit null nullable on update", () => {
    const omitted = updateCustomerBody.parse({ displayName: "Ana" });
    expect(omitted).not.toHaveProperty("fiscalOperationType");
    expect(updateCustomerBody.parse({ fiscalOperationType: null })).toEqual({
      fiscalOperationType: null,
    });
  });
});
