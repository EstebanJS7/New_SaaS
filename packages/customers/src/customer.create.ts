import type { AuditAppendInput, AuditAppendTx } from "@newsaas/database";
import { CONTACT_DTO_SCHEMA_VERSION } from "./customer-contact.zod.js";
import type { CreateCustomerContactInput } from "./customer-contact.zod.js";
import { CUSTOMER_DTO_SCHEMA_VERSION } from "./customer.zod.js";
import type { CreateCustomerInput, CustomerKind } from "./customer.zod.js";
import type { CustomerResponse } from "./customer.dto.js";

/**
 * The customer create contract, callable from anywhere [[DEC-073]].
 *
 * The API answers `POST /customers` with it and the import worker will create
 * its customers with the SAME call, so the validation rules in `customer.zod.ts`,
 * the response mapper and the audit row's action/metadata exist exactly once.
 *
 * **What this boundary deliberately does NOT do:** it never resolves a tenant
 * from an ambient context, never touches an HTTP request, never imports Nest and
 * never picks its own transaction boundary — the caller passes the tenant, the
 * audit appender and the client, and this function opens the one transaction.
 * What keeps the API safe is that its service resolves `tenantId` from
 * `RequestContextService` and never from a caller-supplied argument.
 */

/** Tenant-scoped Customer row as read from the client, before DTO mapping. */
export interface CustomerRow {
  id: string;
  tenantId: string;
  kind: CustomerKind;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Exactly the columns `create` writes; no field is ever defaulted by the client. */
export interface CustomerCreateData {
  readonly tenantId: string;
  readonly kind: CustomerKind;
  readonly displayName: string;
  readonly legalName?: string | null;
  readonly taxId?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly documentNumber?: string | null;
}

/**
 * The ONE statement the create path issues. Narrow on purpose: a caller from a
 * non-request context (the import worker) has to be able to satisfy it with its
 * own client, and a test has to be able to stub it without a database — so it
 * names the single operation instead of borrowing a whole generated delegate.
 */
export interface CustomerCreateDelegate {
  create: (args: { data: CustomerCreateData }) => Promise<CustomerRow>;
}

/**
 * Exactly the columns one contact create writes, mirroring
 * `CustomersService.createContact`'s payload field for field.
 *
 * THAT MAPPING NOW EXISTS TWICE, and the duplication is deliberate rather than
 * overlooked: the API's endpoint builds the same six values from the same
 * contract, and [[IMP-003]] needs them here because the import creates contacts
 * without a request. Collapsing the two would mean `POST /customers/:id/contacts`
 * delegating to this module, which is a change to a surface this Story does not
 * own — so the RULE lives in `customer-contact.zod.ts` (one home, one copy) and
 * the two mappings over it are each covered by their own suite. NOTHING ASSERTS
 * THE TWO MAPPINGS AGREE; a change to one is a change the reviewer must mirror in
 * the other, or an imported contact stops being indistinguishable from a
 * hand-added one.
 */
export interface CustomerContactCreateData {
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: "EMAIL" | "PHONE";
  readonly label?: string | null;
  readonly value: string;
  readonly isPrimary?: boolean;
}

/**
 * The ONE statement a contact create issues. Narrow for the same reason as
 * {@link CustomerCreateDelegate}: a caller outside a request has to be able to
 * satisfy it with its own client, and a test with a plain object.
 *
 * Only the id is read back, because only the id is needed: the contact's audit
 * row names it and the created columns are already what the caller passed.
 */
export interface CustomerContactCreateDelegate {
  create: (args: { data: CustomerContactCreateData }) => Promise<{ id: string }>;
}

/**
 * The transaction this function opens. `auditLog` is present because the audit
 * appender joins the caller's transaction through it — the create path itself
 * never writes an audit row by hand; it hands this handle to the appender.
 *
 * `customerContact` is part of the transaction, and not optional, because a
 * customer's contacts are written by the SAME atomicity guarantee as the
 * customer: a record imported with a phone number must not be able to exist
 * without it.
 */
export interface CustomerCreateTransaction {
  customer: CustomerCreateDelegate;
  customerContact: CustomerContactCreateDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

/**
 * What `createCustomer` needs from the client: the ability to open the one
 * transaction. Narrow for the same reason as the delegate above.
 */
export interface CustomerCreateDb {
  $transaction: <T>(work: (tx: CustomerCreateTransaction) => Promise<T>) => Promise<T>;
}

/**
 * The audit appender as an INTERFACE, not a class.
 *
 * The append primitive is `@newsaas/database`'s `appendAuditLog`; the API wraps
 * it in `AuditWriter` to add server-owned request correlation, and a caller
 * outside a request (the import worker) supplies its own thin writer over the
 * same primitive. Typing the parameter as this interface — the primitive's own
 * input and transaction types — is what lets both pass without either one
 * leaking into the package, and what lets a test assert the audit row without a
 * database.
 */
export interface CustomerAuditAppender {
  append(input: AuditAppendInput, tx?: AuditAppendTx): Promise<unknown>;
}

export interface CreateCustomerArgs {
  db: CustomerCreateDb;
  audit: CustomerAuditAppender;
  /**
   * Resolved by the CALLER: in the API from `RequestContextService`, in the
   * worker from the `import_job` row it owns. Never from request input.
   */
  tenantId: string;
  actorUserProfileId: string;
  input: CreateCustomerInput;
  /**
   * Contacts to create WITH the customer, in ONE transaction ([[IMP-003]]).
   *
   * Additive and optional: `POST /customers` passes nothing and keeps behaving
   * exactly as before — a customer created there has no contact, and the two
   * endpoints keep their own shapes. An import row, which carries phone and
   * e-mail cells, passes them here so the record cannot land without them.
   *
   * Each contact is created with the SAME payload
   * (`CustomerContactCreateData`) and the SAME audit action
   * (`customer_contact.created`) `POST /customers/:id/contacts` writes, so an
   * imported contact is indistinguishable from one added by hand.
   */
  contacts?: readonly CreateCustomerContactInput[];
}

/** Maps a stored row to the allowlisted response. CONFIDENTIAL values stay in the DTO. */
export function toCustomerResponse(row: CustomerRow): CustomerResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    displayName: row.displayName,
    legalName: row.legalName,
    taxId: row.taxId,
    firstName: row.firstName,
    lastName: row.lastName,
    documentNumber: row.documentNumber,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildCreateData(tenantId: string, input: CreateCustomerInput): CustomerCreateData {
  if (input.kind === "COMPANY") {
    return {
      tenantId,
      kind: "COMPANY",
      displayName: input.displayName,
      legalName: input.legalName,
      taxId: input.taxId,
      firstName: null,
      lastName: null,
      documentNumber: null,
    };
  }

  return {
    tenantId,
    kind: "INDIVIDUAL",
    displayName: input.displayName,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    documentNumber: input.documentNumber ?? null,
    legalName: null,
    taxId: null,
  };
}

/**
 * The contact create payload, byte for byte what `CustomersService.createContact`
 * builds: a blank cell is ABSENT upstream (never `""`), so `label` and
 * `isPrimary` fall back here and nowhere else.
 */
export function buildContactCreateData(
  tenantId: string,
  customerId: string,
  input: CreateCustomerContactInput
): CustomerContactCreateData {
  return {
    tenantId,
    customerId,
    kind: input.kind,
    label: input.label ?? null,
    value: input.value,
    isPrimary: input.isPrimary ?? false,
  };
}

/** The changed-field list of the contact create, in the endpoint's order. */
export function changedFieldsForContactCreate(input: CreateCustomerContactInput): string[] {
  const fields: string[] = ["kind", "value"];
  if (input.label !== undefined) fields.push("label");
  if (input.isPrimary !== undefined) fields.push("isPrimary");
  return fields;
}

function changedFieldsForCreate(input: CreateCustomerInput): string[] {
  const fields: string[] = ["kind", "displayName"];
  if (input.kind === "INDIVIDUAL") {
    if (input.firstName !== undefined) fields.push("firstName");
    if (input.lastName !== undefined) fields.push("lastName");
    if (input.documentNumber !== undefined) fields.push("documentNumber");
  } else {
    fields.push("legalName", "taxId");
  }
  return fields;
}

/**
 * Creates one Customer, its contacts and their audit rows in ONE transaction,
 * so a Customer can never be committed without its trail or without the
 * contacts it was created with.
 *
 * The transaction stays INSIDE this function: a worker that opened its own would
 * be a second, differently-shaped atomicity guarantee for the same write — and
 * a contact written in a second transaction could survive a customer that never
 * committed, or vanish from one that did.
 *
 * The order is customer, then its audit row, then contacts in the order the
 * caller supplied them (`phone` then `e-mail` for an import row), each with its
 * own audit row. Every row is written inside the same transaction handle, so a
 * failure anywhere leaves nothing at all.
 */
export function createCustomer({
  db,
  audit,
  tenantId,
  actorUserProfileId,
  input,
  contacts = [],
}: CreateCustomerArgs): Promise<CustomerRow> {
  return db.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: buildCreateData(tenantId, input),
    });

    await audit.append(
      {
        action: "customer.created",
        tenantId,
        actorUserProfileId,
        targetType: "customer",
        targetId: created.id,
        metadata: {
          schemaVersion: CUSTOMER_DTO_SCHEMA_VERSION,
          changedFields: changedFieldsForCreate(input),
        },
      },
      tx
    );

    for (const contact of contacts) {
      const createdContact = await tx.customerContact.create({
        data: buildContactCreateData(tenantId, created.id, contact),
      });

      await audit.append(
        {
          action: "customer_contact.created",
          tenantId,
          actorUserProfileId,
          targetType: "customer_contact",
          targetId: createdContact.id,
          metadata: {
            schemaVersion: CONTACT_DTO_SCHEMA_VERSION,
            changedFields: changedFieldsForContactCreate(contact),
            customerId: created.id,
          },
        },
        tx
      );
    }

    return created;
  });
}
