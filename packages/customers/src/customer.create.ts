import type { AuditAppendInput, AuditAppendTx } from "@newsaas/database";
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
 * The transaction this function opens. `auditLog` is present because the audit
 * appender joins the caller's transaction through it — the create path itself
 * never writes an audit row by hand; it hands this handle to the appender.
 */
export interface CustomerCreateTransaction {
  customer: CustomerCreateDelegate;
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
 * Creates one Customer and its `customer.created` audit row in ONE transaction,
 * so a Customer can never be committed without its trail.
 *
 * The transaction stays INSIDE this function: a worker that opened its own would
 * be a second, differently-shaped atomicity guarantee for the same write.
 */
export function createCustomer({
  db,
  audit,
  tenantId,
  actorUserProfileId,
  input,
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

    return created;
  });
}
