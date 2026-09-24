import { z } from "zod";

/**
 * Holder profile self-service contracts (EPIC-08 WU4C).
 *
 * The holder owns exactly two writable things: a phone channel and an address.
 * Email, name, kind and tax data stay STAFF-owned (spec: "Staff-operated email
 * corrections") and are therefore unreachable here — the payload is `.strict()`
 * at both levels, so `email`, `displayName`, `kind`, `taxId`, `firstName`,
 * `lastName`, `documentNumber` and any client-supplied `customerId`/`tenantId`
 * are a 400 instead of a silently ignored key.
 *
 * The response is an explicit allowlist: a phone scalar and an address object
 * with user-facing fields only. No Prisma model is returned, no `tenantId` /
 * `customerId` echo (both are session-derived facts) and no address row id,
 * because the address is a singleton projection rather than an addressable
 * resource.
 *
 * Data classification: phone and address values are CONFIDENTIAL. They are
 * never written into audit metadata or logs — the audit row carries stable ids
 * and field NAMES only.
 *
 * `PUT` payload convention: `phone` and `address` are each optional, and a
 * `null` value is a deliberate CLEAR (deactivate the stored detail) while an
 * absent key leaves the stored value untouched.
 */

/** Current contract version of the portal profile DTO. */
export const PORTAL_PROFILE_DTO_SCHEMA_VERSION = 1;

/**
 * Address payload. `line1` is required whenever an address is present (the DB
 * column is nullable, so the API contract — matching the staff zod — is what
 * keeps a blank address out); `countryCode` is a 2-letter ISO code, again
 * matching the staff contract.
 */
const portalProfileAddressPayload = z
  .object({
    label: z.string().min(1).max(100).optional(),
    line1: z.string().min(1).max(200),
    line2: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(100).optional(),
    state: z.string().min(1).max(100).optional(),
    postalCode: z.string().min(1).max(20).optional(),
    countryCode: z.string().length(2).optional(),
  })
  .strict();

export type PortalProfileAddressInput = z.infer<typeof portalProfileAddressPayload>;

/**
 * Update payload: the phone channel and/or the address. `.strict()` rejects
 * every unknown key.
 *
 * NULL means CLEAR, absent means LEAVE UNTOUCHED. The two are deliberately
 * distinct: `phone: null` or `address: null` is the holder instructing the API
 * to remove the stored detail, while omitting the key leaves it as it was. A
 * clear still counts as a present key for the at-least-one rule below, so
 * `{ phone: null }` is a valid body and `{}` is not.
 */
const updatePortalProfilePayload = z
  .object({
    phone: z.string().min(1).max(255).nullable().optional(),
    address: portalProfileAddressPayload.nullable().optional(),
  })
  .strict();

/**
 * At-least-one rule: an empty body must never reach the service. A body that
 * carries only a clear is still a body with a present key (`phone: null`), so
 * it is accepted; `{}` is refused.
 */
export const updatePortalProfileBody = updatePortalProfilePayload.superRefine((value, ctx) => {
  if (value.phone === undefined && value.address === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of phone or address is required.",
    });
  }
});

export type UpdatePortalProfileInput = z.infer<typeof updatePortalProfilePayload>;

/** Address row shape the response mapper consumes — never returned raw. */
export interface PortalProfileAddressRow {
  readonly id: string;
  readonly label: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
}

/** Allowlisted address projection: user-facing fields only, no row id. */
export interface PortalProfileAddress {
  readonly label: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
}

/**
 * `GET`/`PUT /portal/profile` response. `phone` is the holder's primary phone
 * channel value (null when they have none) and `address` the active address.
 * No email, no staff identity field and no tenant/Customer echo.
 */
export interface PortalProfileResponse {
  readonly phone: string | null;
  readonly address: PortalProfileAddress | null;
}

/** Maps a persisted address; never spreads it (allowlist by construction). */
export function toPortalProfileAddress(row: PortalProfileAddressRow): PortalProfileAddress {
  return {
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
  };
}
