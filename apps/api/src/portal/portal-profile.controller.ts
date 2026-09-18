import { Body, Controller, Get, Headers, Put, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { updatePortalProfileBody, type PortalProfileResponse } from "./portal-profile.dto.js";
import { PortalProfileService } from "./portal-profile.service.js";

/**
 * Identity hints that are NEVER accepted from the client, in ANY channel:
 * tenant and Customer are resolved server-side from the portal session, so a
 * client-supplied target identity is a contract violation rather than a value
 * to ignore. Compared case-insensitively (`?CustomerId=` is the same attempt)
 * and rejected on presence alone — an empty value is still a hint.
 *
 * `id` is included for symmetry with the body contract, which already rejects a
 * generic `id` key; `contactId`/`addressId` cover the child rows the write
 * touches even though this route has no targetable sub-resource.
 */
const FORBIDDEN_IDENTITY_QUERY_PARAMS: readonly string[] = [
  "tenantid",
  "customerid",
  "contactid",
  "addressid",
  "id",
];

/** Header carriers of the same hints (Fastify lowercases inbound names). */
const FORBIDDEN_IDENTITY_HEADERS: readonly string[] = ["x-tenant-id", "x-customer-id"];

/**
 * The single refusal for a client-supplied identity hint. Same
 * `VALIDATION_FAILED` class the body contract already produces, and it NAMES
 * the offending parameter so the caller learns which input was refused instead
 * of silently receiving their own profile back.
 */
function rejectIdentityHint(name: string): never {
  throw new DomainError(
    "VALIDATION_FAILED",
    `Client-supplied identity hint "${name}" is not accepted.`
  );
}

/**
 * Fails closed BEFORE any read or write when the request carries a target
 * identity in the query string or the headers. A silently ignored hint is
 * exactly the inconsistency this fence removes: the write always targets the
 * session's tenant and Customer, so a hint can never be honoured — and must
 * therefore never be tolerated either.
 */
function assertNoClientIdentityHints(query: unknown, headers: unknown): void {
  for (const name of Object.keys(asRecord(query))) {
    if (FORBIDDEN_IDENTITY_QUERY_PARAMS.includes(name.toLowerCase())) {
      rejectIdentityHint(name);
    }
  }
  for (const name of Object.keys(asRecord(headers))) {
    if (FORBIDDEN_IDENTITY_HEADERS.includes(name.toLowerCase())) {
      rejectIdentityHint(name);
    }
  }
}

/** Own-enumerable key view of a Nest-injected object; a non-object is empty. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Holder profile self-service surface (EPIC-08 WU4C).
 *
 * Lives on the `/portal/*` surface ONLY: it carries no staff
 * `@RequirePermissions` metadata (the staff chain skips the portal surface) and
 * the PortalAuthGuard enforces the portal session + `portal` entitlement. The
 * holder's tenant and Customer are resolved server-side from the session; a
 * `tenantId`, `customerId`, contact id or address id in the path, query, header
 * or body is never read — the query/header fence rejects it here and the
 * `.strict()` body schema rejects it before the service runs.
 *
 * There is deliberately no target id in the URL: the target is always the
 * session's own Customer, so a holder cannot even express a foreign Customer,
 * and there is no unresolvable target to answer with a 404.
 */
@Controller("portal")
export class PortalProfileController {
  constructor(private readonly profiles: PortalProfileService) {}

  /** Reads the authenticated holder's own phone and address projection. */
  @Get("profile")
  get(@Query() query: unknown, @Headers() headers: unknown): Promise<PortalProfileResponse> {
    assertNoClientIdentityHints(query, headers);
    return this.profiles.getProfile();
  }

  /**
   * Upserts the holder's phone channel and/or address. A payload carrying
   * email, a name, kind, tax data, another Customer's identifiers, an unknown
   * key or no key at all is a 400 VALIDATION_FAILED and persists nothing; a
   * target identity in the query or a header is refused the same way, before
   * the service is ever called.
   */
  @Put("profile")
  update(
    @Query() query: unknown,
    @Headers() headers: unknown,
    @Body() body: unknown
  ): Promise<PortalProfileResponse> {
    assertNoClientIdentityHints(query, headers);
    const parsed = updatePortalProfileBody.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid profile update body.");
    }
    return this.profiles.updateProfile(parsed.data);
  }
}
