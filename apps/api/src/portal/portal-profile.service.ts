import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { portalResourceNotFound } from "./portal-holder-scope.js";
import {
  PORTAL_PROFILE_DTO_SCHEMA_VERSION,
  toPortalProfileAddress,
  type PortalProfileAddressInput,
  type PortalProfileAddressRow,
  type PortalProfileResponse,
  type UpdatePortalProfileInput,
} from "./portal-profile.dto.js";

/**
 * Stable domain action code for a holder self-service profile update, in the
 * shared "domain.event" shape (`portal_booking.requested` is the WU4A twin).
 * "updated" — not "changed" — matches the staff `customer_contact.updated` /
 * `customer_address.updated` verbs, so a reader sees one vocabulary.
 */
export const PORTAL_PROFILE_UPDATED_ACTION = "portal_profile.updated";

/** Audit target: the holder's own Customer (never the child contact/address). */
export const PORTAL_PROFILE_TARGET_TYPE = "customer";

/** Tenant-scoped Customer row; only its existence is consumed. */
interface PortalProfileCustomerRow {
  readonly id: string;
}

/** PHONE contact row as the profile boundary consumes it. */
interface PortalPhoneContactRow {
  readonly id: string;
  readonly value: string;
  readonly isPrimary: boolean;
}

interface PortalPhoneCreateData {
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: "PHONE";
  readonly label: string | null;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
}

interface PortalPhoneUpdateData {
  readonly kind?: "PHONE";
  readonly value?: string;
  readonly isPrimary?: boolean;
  readonly isActive?: boolean;
}

interface PortalAddressCreateData {
  readonly tenantId: string;
  readonly customerId: string;
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly isActive: boolean;
}

interface PortalAddressUpdateData {
  readonly label?: string;
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly isActive?: boolean;
}

/**
 * Structural Prisma surface consumed by the profile boundary. Declared
 * explicitly (same pattern as `PortalReadService`/`PortalBookingService`) so
 * the service stays unit-testable and the in-memory boundary fake can satisfy
 * it without the real client.
 *
 * `customerContact.updateMany` deliberately accepts a FILTER-shaped `where`
 * (`kind` + `id: { not }`) as well as the single-id form, because demoting the
 * holder's sibling phone rows is one set-based write, not a row-by-row loop.
 */
interface PortalProfilePrisma {
  customer: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
    }) => Promise<PortalProfileCustomerRow | null>;
  };
  customerContact: {
    findMany: (args: {
      where: { tenantId: string; customerId: string; kind: "PHONE"; isActive: boolean };
      orderBy: { updatedAt: "desc" };
    }) => Promise<PortalPhoneContactRow[]>;
    create: (args: { data: PortalPhoneCreateData }) => Promise<PortalPhoneContactRow>;
    updateMany: (args: {
      where: {
        id?: string | { not: string };
        tenantId: string;
        customerId: string;
        kind?: "PHONE";
      };
      data: PortalPhoneUpdateData;
    }) => Promise<{ count: number }>;
  };
  customerAddress: {
    findMany: (args: {
      where: { tenantId: string; customerId: string; isActive: boolean };
      orderBy: { updatedAt: "desc" };
    }) => Promise<PortalProfileAddressRow[]>;
    create: (args: { data: PortalAddressCreateData }) => Promise<{ id: string }>;
    updateMany: (args: {
      where: { id: string; tenantId: string; customerId: string };
      data: PortalAddressUpdateData;
    }) => Promise<{ count: number }>;
  };
  /** Transactional audit target so the audit row co-commits with the write. */
  auditLog: AuditAppendTx["auditLog"];
  $transaction: <T>(work: (tx: PortalProfilePrisma) => Promise<T>) => Promise<T>;
}

/** Payload field order for the audit diff (schema order, never value order). */
const ADDRESS_FIELD_NAMES = [
  "label",
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "countryCode",
] as const;

/**
 * Holder profile self-service boundary (EPIC-08 WU4C).
 *
 * - Tenant AND Customer come exclusively from the authenticated portal context
 *   (`RequestContextService`), exactly like `PortalReadService`. A client
 *   `tenantId`, `customerId`, contact id or address id is never read; the
 *   payload is `.strict()`, so those keys are a 400 before this service runs.
 * - If the session's own Customer row cannot be resolved the failure is the
 *   single shared `portalResourceNotFound()`.
 * - Phone: the primary active PHONE row, else the most recently updated active
 *   one, else a new row. Every OTHER phone row of the holder is demoted inside
 *   the same transaction, because `customer_contact` has no partial unique
 *   index for primacy (unlike `patient_guardian`) and this is the boundary
 *   where the "exactly one primary phone" convention is established.
 * - Address: the most recently updated active address, else a new row. The
 *   holder's other addresses are deliberately left alone — a Customer may keep
 *   several, and no primary/default column exists.
 * - One `portal_profile.updated` PORTAL audit row co-commits with both upserts.
 *   Its metadata carries field NAMES and the affected ids, never a phone or
 *   address value (CONFIDENTIAL).
 */
@Injectable()
export class PortalProfileService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalProfilePrisma,
    private readonly requestContext: RequestContextService,
    private readonly audit: AuditWriter
  ) {}

  /** Reads the holder's own profile projection. */
  async getProfile(): Promise<PortalProfileResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();
    await assertHolderCustomer(this.prisma, tenantId, customerId);
    return readProfile(this.prisma, tenantId, customerId);
  }

  /**
   * Upserts the phone channel and/or the address and appends exactly one
   * co-committed PORTAL audit row. The whole thing is one transaction: a failed
   * audit append leaves neither the contact nor the address written.
   */
  async updateProfile(input: UpdatePortalProfileInput): Promise<PortalProfileResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();
    const portalAccessId = this.requestContext.requirePortalAccessId();

    return this.prisma.$transaction(async (tx) => {
      await assertHolderCustomer(tx, tenantId, customerId);

      const changedFields: string[] = [];
      let contactId: string | undefined;
      let addressId: string | undefined;

      if (input.phone !== undefined) {
        contactId = await writePortalPhone(tx, tenantId, customerId, input.phone);
        changedFields.push("phone");
      }

      if (input.address !== undefined) {
        addressId = await writePortalAddress(tx, tenantId, customerId, input.address);
        changedFields.push(...addressChangedFields(input.address));
      }

      await this.audit.append(
        {
          action: PORTAL_PROFILE_UPDATED_ACTION,
          tenantId,
          actorPortalAccessId: portalAccessId,
          targetType: PORTAL_PROFILE_TARGET_TYPE,
          targetId: customerId,
          metadata: {
            schemaVersion: PORTAL_PROFILE_DTO_SCHEMA_VERSION,
            changedFields,
            ...(contactId !== undefined && { contactId }),
            ...(addressId !== undefined && { addressId }),
          },
        },
        tx
      );

      return readProfile(tx, tenantId, customerId);
    });
  }
}

/** Uniform NOT_FOUND for an unresolvable session Customer. */
async function assertHolderCustomer(
  prisma: PortalProfilePrisma,
  tenantId: string,
  customerId: string
): Promise<void> {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) {
    throw portalResourceNotFound();
  }
}

/** Current profile projection; the same read serves GET and the PUT response. */
async function readProfile(
  prisma: PortalProfilePrisma,
  tenantId: string,
  customerId: string
): Promise<PortalProfileResponse> {
  const [phoneRows, addressRows] = await Promise.all([
    prisma.customerContact.findMany({
      where: { tenantId, customerId, kind: "PHONE", isActive: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.customerAddress.findMany({
      where: { tenantId, customerId, isActive: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const address = addressRows[0];
  return {
    phone: selectPhoneTarget(phoneRows)?.value ?? null,
    address: address ? toPortalProfileAddress(address) : null,
  };
}

/**
 * The holder's phone target: the FIRST primary row (rows arrive most-recently
 * updated first), else the most recently updated active row, else nothing.
 */
function selectPhoneTarget(rows: readonly PortalPhoneContactRow[]): PortalPhoneContactRow | null {
  return rows.find((row) => row.isPrimary) ?? rows[0] ?? null;
}

/**
 * Upserts the holder's phone channel and returns the written contact id.
 * Primacy bookkeeping ("exactly one primary phone") is derived, not
 * holder-supplied, so it never appears in the audit diff.
 */
async function writePortalPhone(
  tx: PortalProfilePrisma,
  tenantId: string,
  customerId: string,
  value: string
): Promise<string> {
  const rows = await tx.customerContact.findMany({
    where: { tenantId, customerId, kind: "PHONE", isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  const target = selectPhoneTarget(rows);

  let contactId: string;
  if (target) {
    contactId = target.id;
    await tx.customerContact.updateMany({
      where: { id: target.id, tenantId, customerId },
      data: { kind: "PHONE", value, isPrimary: true, isActive: true },
    });
  } else {
    const created = await tx.customerContact.create({
      data: {
        tenantId,
        customerId,
        kind: "PHONE",
        label: null,
        value,
        isPrimary: true,
        isActive: true,
      },
    });
    contactId = created.id;
  }

  // Demote every OTHER phone row (active or not) so the convention actually
  // holds; only rows scoped to this tenant AND Customer are touched.
  await tx.customerContact.updateMany({
    where: { tenantId, customerId, kind: "PHONE", id: { not: contactId } },
    data: { isPrimary: false },
  });

  return contactId;
}

/**
 * Upserts the holder's most recently updated active address and returns its id.
 * Other addresses are neither deactivated nor rewritten.
 */
async function writePortalAddress(
  tx: PortalProfilePrisma,
  tenantId: string,
  customerId: string,
  input: PortalProfileAddressInput
): Promise<string> {
  const rows = await tx.customerAddress.findMany({
    where: { tenantId, customerId, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  const target = rows[0];

  if (!target) {
    const created = await tx.customerAddress.create({
      data: {
        tenantId,
        customerId,
        label: input.label ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        countryCode: input.countryCode ?? null,
        isActive: true,
      },
    });
    return created.id;
  }

  await tx.customerAddress.updateMany({
    where: { id: target.id, tenantId, customerId },
    data: { ...addressUpdateData(input), isActive: true },
  });
  return target.id;
}

/** Only the SUPPLIED address fields are written; absent keys stay untouched. */
function addressUpdateData(input: PortalProfileAddressInput): PortalAddressUpdateData {
  const data: PortalAddressUpdateData = {
    ...(input.label !== undefined && { label: input.label }),
    ...(input.line1 !== undefined && { line1: input.line1 }),
    ...(input.line2 !== undefined && { line2: input.line2 }),
    ...(input.city !== undefined && { city: input.city }),
    ...(input.state !== undefined && { state: input.state }),
    ...(input.postalCode !== undefined && { postalCode: input.postalCode }),
    ...(input.countryCode !== undefined && { countryCode: input.countryCode }),
  };
  return data;
}

/** Field NAMES only, dot-qualified by payload path; no values ever. */
function addressChangedFields(input: PortalProfileAddressInput): string[] {
  return ADDRESS_FIELD_NAMES.filter((name) => input[name] !== undefined).map(
    (name) => `address.${name}`
  );
}
