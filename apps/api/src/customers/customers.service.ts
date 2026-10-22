import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  buildContactCreateData,
  changedFieldsForContactCreate,
  createCustomer,
  toCustomerResponse,
} from "@newsaas/customers";
import type { CustomerCreateData, CustomerRow } from "@newsaas/customers";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { CUSTOMER_DTO_SCHEMA_VERSION, validateUpdateForKind } from "./customer.zod.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customer.zod.js";
import type { CustomerResponse } from "./customer.dto.js";
import { ADDRESS_DTO_SCHEMA_VERSION } from "./customer-address.zod.js";
import type {
  CreateCustomerAddressInput,
  UpdateCustomerAddressInput,
} from "./customer-address.zod.js";
import type { CustomerAddressResponse } from "./customer-address.dto.js";
import { CONTACT_DTO_SCHEMA_VERSION } from "./customer-contact.zod.js";
import type {
  CreateCustomerContactInput,
  UpdateCustomerContactInput,
} from "./customer-contact.zod.js";
import type { CustomerContactResponse } from "./customer-contact.dto.js";

// Re-exported so the API's existing importers — including the service test, which
// builds its fakes against these contracts — keep resolving them from this
// module; the definitions now live in `@newsaas/customers` ([[DEC-073]]).
// Collapsing these aliases is a separate cleanup.
export type { CustomerCreateData, CustomerRow } from "@newsaas/customers";

export interface CustomerUpdateData {
  displayName?: string;
  legalName?: string | null;
  taxId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  documentNumber?: string | null;
  isActive?: boolean;
}

export interface CustomerDelegate {
  findMany: (args: {
    where: { tenantId: string; isActive?: boolean };
    orderBy?: { displayName?: "asc" | "desc" };
  }) => Promise<CustomerRow[]>;
  findFirst: (args: { where: { id: string; tenantId: string } }) => Promise<CustomerRow | null>;
  create: (args: { data: CustomerCreateData }) => Promise<CustomerRow>;
  updateMany: (args: {
    where: { id: string; tenantId: string; isActive?: boolean };
    data: CustomerUpdateData;
  }) => Promise<{ count: number }>;
}

export interface CustomersTransaction {
  customer: CustomerDelegate;
  customerAddress: CustomerAddressDelegate;
  customerContact: CustomerContactDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

export interface CustomersPrisma {
  $transaction: <T>(work: (tx: CustomersTransaction) => Promise<T>) => Promise<T>;
  customer: CustomerDelegate;
  customerAddress: CustomerAddressDelegate;
  customerContact: CustomerContactDelegate;
}

export interface CustomerAddressRow {
  id: string;
  tenantId: string;
  customerId: string;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerAddressCreateData {
  readonly tenantId: string;
  readonly customerId: string;
  readonly label?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly city?: string | null;
  readonly state?: string | null;
  readonly postalCode?: string | null;
  readonly countryCode?: string | null;
}

export interface CustomerAddressUpdateData {
  label?: string | null;
  line1?: string;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  isActive?: boolean;
}

export interface CustomerAddressDelegate {
  findMany: (args: {
    where: { tenantId: string; customerId: string; isActive?: boolean };
    orderBy?: { createdAt?: "asc" | "desc" };
  }) => Promise<CustomerAddressRow[]>;
  findFirst: (args: {
    where: { id: string; tenantId: string; customerId: string };
  }) => Promise<CustomerAddressRow | null>;
  create: (args: { data: CustomerAddressCreateData }) => Promise<CustomerAddressRow>;
  updateMany: (args: {
    where: { id: string; tenantId: string; customerId: string; isActive?: boolean };
    data: CustomerAddressUpdateData;
  }) => Promise<{ count: number }>;
}

export interface CustomerContactRow {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "EMAIL" | "PHONE";
  label: string | null;
  value: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerContactCreateData {
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: "EMAIL" | "PHONE";
  readonly label?: string | null;
  readonly value: string;
  readonly isPrimary?: boolean;
}

export interface CustomerContactUpdateData {
  kind?: "EMAIL" | "PHONE";
  label?: string | null;
  value?: string;
  isPrimary?: boolean;
  isActive?: boolean;
}

export interface CustomerContactDelegate {
  findMany: (args: {
    where: { tenantId: string; customerId: string; isActive?: boolean };
    orderBy?: { createdAt?: "asc" | "desc" };
  }) => Promise<CustomerContactRow[]>;
  findFirst: (args: {
    where: { id: string; tenantId: string; customerId: string };
  }) => Promise<CustomerContactRow | null>;
  create: (args: { data: CustomerContactCreateData }) => Promise<CustomerContactRow>;
  updateMany: (args: {
    where: { id: string; tenantId: string; customerId: string; isActive?: boolean };
    data: CustomerContactUpdateData;
  }) => Promise<{ count: number }>;
}

function buildUpdateData(input: UpdateCustomerInput): CustomerUpdateData {
  const data: CustomerUpdateData = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.documentNumber !== undefined) data.documentNumber = input.documentNumber;
  if (input.legalName !== undefined) data.legalName = input.legalName;
  if (input.taxId !== undefined) data.taxId = input.taxId;
  return data;
}

function toCustomerAddressResponse(row: CustomerAddressRow): CustomerAddressResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildAddressCreateData(
  tenantId: string,
  customerId: string,
  input: CreateCustomerAddressInput
): CustomerAddressCreateData {
  return {
    tenantId,
    customerId,
    label: input.label ?? null,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    countryCode: input.countryCode ?? null,
  };
}

function buildAddressUpdateData(input: UpdateCustomerAddressInput): CustomerAddressUpdateData {
  const data: CustomerAddressUpdateData = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.line1 !== undefined) data.line1 = input.line1;
  if (input.line2 !== undefined) data.line2 = input.line2;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.countryCode !== undefined) data.countryCode = input.countryCode;
  return data;
}

function changedFieldsForAddressCreate(input: CreateCustomerAddressInput): string[] {
  const fields: string[] = ["line1"];
  if (input.label !== undefined) fields.push("label");
  if (input.line2 !== undefined) fields.push("line2");
  if (input.city !== undefined) fields.push("city");
  if (input.state !== undefined) fields.push("state");
  if (input.postalCode !== undefined) fields.push("postalCode");
  if (input.countryCode !== undefined) fields.push("countryCode");
  return fields;
}

function toCustomerContactResponse(row: CustomerContactRow): CustomerContactResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    kind: row.kind,
    label: row.label,
    value: row.value,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildContactUpdateData(input: UpdateCustomerContactInput): CustomerContactUpdateData {
  const data: CustomerContactUpdateData = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.label !== undefined) data.label = input.label;
  if (input.value !== undefined) data.value = input.value;
  if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
  return data;
}

/**
 * Tenant-scoped Customer lifecycle boundary.
 *
 * - Tenant identity comes exclusively from `RequestContextService`.
 * - Reads are filtered by tenant and default to active rows only.
 * - Mutations co-commit an `AuditLog` row inside the same transaction.
 * - Audit metadata carries only schema version and changed field names; no
 *   CONFIDENTIAL values are logged.
 * - Cross-tenant UUID access is surfaced as 404 byte-equivalent to missing.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: CustomersPrisma,
    private readonly requestContext: RequestContextService,
    private readonly audit: AuditWriter
  ) {}

  async list(): Promise<CustomerResponse[]> {
    const tenantId = this.requestContext.requireTenantId();
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, isActive: true },
      orderBy: { displayName: "asc" },
    });
    return rows.map(toCustomerResponse);
  }

  async get(id: string): Promise<CustomerResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const row = await this.findCustomerOrThrow(id, tenantId);
    return toCustomerResponse(row);
  }

  /**
   * Creates a Customer through `@newsaas/customers`'s create contract: the API
   * and the import worker validate and write a Customer the SAME way, and the
   * audit row (`customer.created`, same metadata) co-commits inside the package's
   * transaction ([[DEC-073]]).
   *
   * Tenant and actor are resolved HERE, from the request context, and handed to
   * the package as arguments. This method NEVER forwards request input as either
   * one: the tenant is server-owned here, and a package that accepted it from a
   * caller would be unsafe in both deployables.
   */
  async create(input: CreateCustomerInput): Promise<CustomerResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await createCustomer({
      db: this.prisma,
      audit: this.audit,
      tenantId,
      actorUserProfileId,
      input,
    });

    return toCustomerResponse(row);
  }

  async update(id: string, input: UpdateCustomerInput): Promise<CustomerResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const existing = await this.findCustomerOrThrow(id, tenantId);
    validateUpdateForKind(existing.kind, input);

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customer.updateMany({
        where: { id, tenantId },
        data: buildUpdateData(input),
      });
      if (count === 0) {
        throw new DomainError("NOT_FOUND", "Customer was not found.");
      }

      const updated = await tx.customer.findFirst({ where: { id, tenantId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Customer was not found.");
      }

      await this.audit.append(
        {
          action: "customer.updated",
          tenantId,
          actorUserProfileId,
          targetType: "customer",
          targetId: updated.id,
          metadata: {
            schemaVersion: CUSTOMER_DTO_SCHEMA_VERSION,
            changedFields: Object.keys(input),
          },
        },
        tx
      );

      return updated;
    });

    return toCustomerResponse(row);
  }

  async deactivate(id: string): Promise<CustomerResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customer.updateMany({
        where: { id, tenantId, isActive: true },
        data: { isActive: false },
      });

      if (count === 0) {
        const existing = await tx.customer.findFirst({ where: { id, tenantId } });
        if (!existing) {
          throw new DomainError("NOT_FOUND", "Customer was not found.");
        }

        await this.audit.append(
          {
            action: "customer.deactivated",
            tenantId,
            actorUserProfileId,
            targetType: "customer",
            targetId: existing.id,
            metadata: {
              schemaVersion: CUSTOMER_DTO_SCHEMA_VERSION,
              changedFields: [],
            },
          },
          tx
        );

        return existing;
      }

      const updated = await tx.customer.findFirst({ where: { id, tenantId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Customer was not found.");
      }

      await this.audit.append(
        {
          action: "customer.deactivated",
          tenantId,
          actorUserProfileId,
          targetType: "customer",
          targetId: updated.id,
          metadata: {
            schemaVersion: CUSTOMER_DTO_SCHEMA_VERSION,
            changedFields: ["isActive"],
          },
        },
        tx
      );

      return updated;
    });

    return toCustomerResponse(row);
  }

  // -------------------------------------------------------------------------
  // CustomerAddress boundary
  // -------------------------------------------------------------------------

  async listAddresses(customerId: string): Promise<CustomerAddressResponse[]> {
    const tenantId = this.requestContext.requireTenantId();
    await this.findCustomerOrThrow(customerId, tenantId);
    const rows = await this.prisma.customerAddress.findMany({
      where: { tenantId, customerId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toCustomerAddressResponse);
  }

  async getAddress(id: string, customerId: string): Promise<CustomerAddressResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const row = await this.findAddressOrThrow(id, customerId, tenantId);
    return toCustomerAddressResponse(row);
  }

  async createAddress(
    customerId: string,
    input: CreateCustomerAddressInput
  ): Promise<CustomerAddressResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.findCustomerOrThrow(customerId, tenantId);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerAddress.create({
        data: buildAddressCreateData(tenantId, customerId, input),
      });

      await this.audit.append(
        {
          action: "customer_address.created",
          tenantId,
          actorUserProfileId,
          targetType: "customer_address",
          targetId: created.id,
          metadata: {
            schemaVersion: ADDRESS_DTO_SCHEMA_VERSION,
            changedFields: changedFieldsForAddressCreate(input),
            customerId,
          },
        },
        tx
      );

      return created;
    });

    return toCustomerAddressResponse(row);
  }

  async updateAddress(
    id: string,
    customerId: string,
    input: UpdateCustomerAddressInput
  ): Promise<CustomerAddressResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.findAddressOrThrow(id, customerId, tenantId);

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customerAddress.updateMany({
        where: { id, tenantId, customerId },
        data: buildAddressUpdateData(input),
      });
      if (count === 0) {
        throw new DomainError("NOT_FOUND", "Customer address was not found.");
      }

      const updated = await tx.customerAddress.findFirst({
        where: { id, tenantId, customerId },
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Customer address was not found.");
      }

      await this.audit.append(
        {
          action: "customer_address.updated",
          tenantId,
          actorUserProfileId,
          targetType: "customer_address",
          targetId: updated.id,
          metadata: {
            schemaVersion: ADDRESS_DTO_SCHEMA_VERSION,
            changedFields: Object.keys(input),
            customerId,
          },
        },
        tx
      );

      return updated;
    });

    return toCustomerAddressResponse(row);
  }

  async deactivateAddress(id: string, customerId: string): Promise<CustomerAddressResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customerAddress.updateMany({
        where: { id, tenantId, customerId, isActive: true },
        data: { isActive: false },
      });

      if (count === 0) {
        const existing = await tx.customerAddress.findFirst({
          where: { id, tenantId, customerId },
        });
        if (!existing) {
          throw new DomainError("NOT_FOUND", "Customer address was not found.");
        }

        await this.audit.append(
          {
            action: "customer_address.deactivated",
            tenantId,
            actorUserProfileId,
            targetType: "customer_address",
            targetId: existing.id,
            metadata: {
              schemaVersion: ADDRESS_DTO_SCHEMA_VERSION,
              changedFields: [],
              customerId,
            },
          },
          tx
        );

        return existing;
      }

      const updated = await tx.customerAddress.findFirst({
        where: { id, tenantId, customerId },
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Customer address was not found.");
      }

      await this.audit.append(
        {
          action: "customer_address.deactivated",
          tenantId,
          actorUserProfileId,
          targetType: "customer_address",
          targetId: updated.id,
          metadata: {
            schemaVersion: ADDRESS_DTO_SCHEMA_VERSION,
            changedFields: ["isActive"],
            customerId,
          },
        },
        tx
      );

      return updated;
    });

    return toCustomerAddressResponse(row);
  }

  // -------------------------------------------------------------------------
  // CustomerContact boundary
  // -------------------------------------------------------------------------

  async listContacts(customerId: string): Promise<CustomerContactResponse[]> {
    const tenantId = this.requestContext.requireTenantId();
    await this.findCustomerOrThrow(customerId, tenantId);
    const rows = await this.prisma.customerContact.findMany({
      where: { tenantId, customerId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toCustomerContactResponse);
  }

  async getContact(id: string, customerId: string): Promise<CustomerContactResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const row = await this.findContactOrThrow(id, customerId, tenantId);
    return toCustomerContactResponse(row);
  }

  async createContact(
    customerId: string,
    input: CreateCustomerContactInput
  ): Promise<CustomerContactResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.findCustomerOrThrow(customerId, tenantId);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerContact.create({
        data: buildContactCreateData(tenantId, customerId, input),
      });

      await this.audit.append(
        {
          action: "customer_contact.created",
          tenantId,
          actorUserProfileId,
          targetType: "customer_contact",
          targetId: created.id,
          metadata: {
            schemaVersion: CONTACT_DTO_SCHEMA_VERSION,
            changedFields: changedFieldsForContactCreate(input),
            customerId,
          },
        },
        tx
      );

      return created;
    });

    return toCustomerContactResponse(row);
  }

  async updateContact(
    id: string,
    customerId: string,
    input: UpdateCustomerContactInput
  ): Promise<CustomerContactResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.findContactOrThrow(id, customerId, tenantId);

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customerContact.updateMany({
        where: { id, tenantId, customerId },
        data: buildContactUpdateData(input),
      });
      if (count === 0) {
        throw new DomainError("NOT_FOUND", "Customer contact was not found.");
      }

      const updated = await tx.customerContact.findFirst({
        where: { id, tenantId, customerId },
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Customer contact was not found.");
      }

      await this.audit.append(
        {
          action: "customer_contact.updated",
          tenantId,
          actorUserProfileId,
          targetType: "customer_contact",
          targetId: updated.id,
          metadata: {
            schemaVersion: CONTACT_DTO_SCHEMA_VERSION,
            changedFields: Object.keys(input),
            customerId,
          },
        },
        tx
      );

      return updated;
    });

    return toCustomerContactResponse(row);
  }

  async deactivateContact(id: string, customerId: string): Promise<CustomerContactResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customerContact.updateMany({
        where: { id, tenantId, customerId, isActive: true },
        data: { isActive: false },
      });

      if (count === 0) {
        const existing = await tx.customerContact.findFirst({
          where: { id, tenantId, customerId },
        });
        if (!existing) {
          throw new DomainError("NOT_FOUND", "Customer contact was not found.");
        }

        await this.audit.append(
          {
            action: "customer_contact.deactivated",
            tenantId,
            actorUserProfileId,
            targetType: "customer_contact",
            targetId: existing.id,
            metadata: {
              schemaVersion: CONTACT_DTO_SCHEMA_VERSION,
              changedFields: [],
              customerId,
            },
          },
          tx
        );

        return existing;
      }

      const updated = await tx.customerContact.findFirst({
        where: { id, tenantId, customerId },
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Customer contact was not found.");
      }

      await this.audit.append(
        {
          action: "customer_contact.deactivated",
          tenantId,
          actorUserProfileId,
          targetType: "customer_contact",
          targetId: updated.id,
          metadata: {
            schemaVersion: CONTACT_DTO_SCHEMA_VERSION,
            changedFields: ["isActive"],
            customerId,
          },
        },
        tx
      );

      return updated;
    });

    return toCustomerContactResponse(row);
  }

  private async findCustomerOrThrow(id: string, tenantId: string): Promise<CustomerRow> {
    const row = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Customer was not found.");
    }
    return row;
  }

  private async findAddressOrThrow(
    id: string,
    customerId: string,
    tenantId: string
  ): Promise<CustomerAddressRow> {
    const row = await this.prisma.customerAddress.findFirst({
      where: { id, tenantId, customerId },
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Customer address was not found.");
    }
    return row;
  }

  private async findContactOrThrow(
    id: string,
    customerId: string,
    tenantId: string
  ): Promise<CustomerContactRow> {
    const row = await this.prisma.customerContact.findFirst({
      where: { id, tenantId, customerId },
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Customer contact was not found.");
    }
    return row;
  }
}
