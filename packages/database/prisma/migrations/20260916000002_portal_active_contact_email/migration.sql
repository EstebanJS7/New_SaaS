-- Additive migration: EPIC-08 WU2C security fix — deterministic portal login id.
--
-- The portal login id is the staff-managed `contact_email` scoped by tenant
-- (design D8): `PortalAuthService.login` canonicalizes the submitted email and
-- resolves ACTIVE holders by (tenant_id, lower(contact_email)). The only
-- active-holder uniqueness previously shipped is
-- `customer_portal_access_active_customer_key` on (tenant_id, customer_id), so
-- two Customers in the SAME tenant could each hold an ACTIVE row with the same
-- contact_email — and login would then resolve an ARBITRARY holder, mapping a
-- caller onto the wrong Customer. Case-variant rows ("Holder@…" vs "holder@…")
-- are the same canonical identity, so the key lowercases the column to match
-- login exactly; a raw-column key would let those variants slip through.
--
-- Enforce exactly one ACTIVE holder per (tenant_id, canonical contact_email) at
-- the database boundary. This is the concurrency-safe guarantee: a plain
-- service pre-check is race-prone, so the second concurrent write now fails
-- instead of silently creating an ambiguous login identity.
--
-- The partial predicate ignores 'REVOKED' rows, so an email can be
-- re-provisioned after revocation, and tenant scoping lets different tenants
-- reuse the same email independently.
--
-- Preflight (NON-DESTRUCTIVE): a live environment may already hold duplicate
-- ACTIVE canonical identities from a pre-fix write path. Rather than letting the
-- index build fail with an opaque error — or silently merging/deleting rows —
-- the block below detects every duplicate group and aborts with the exact
-- remediation. It only READS; it never mutates data.
DO $$
DECLARE
  duplicate_groups integer;
  duplicate_detail text;
BEGIN
  SELECT count(*), string_agg(detail, '; ' ORDER BY detail)
  INTO duplicate_groups, duplicate_detail
  FROM (
    SELECT format(
             'tenant=%s email=%s holders=%s',
             tenant_id,
             lower(contact_email),
             count(*)
           ) AS detail
    FROM "customer_portal_access"
    WHERE "status" = 'ACTIVE'
    GROUP BY "tenant_id", lower("contact_email")
    HAVING count(*) > 1
  ) AS duplicate_identity;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = format(
        'portal login identity preflight failed: % duplicate ACTIVE (tenant, canonical email) group(s): %',
        duplicate_groups,
        duplicate_detail
      ),
      HINT = 'Keep exactly ONE ACTIVE holder per group and transition the others to status = ''REVOKED'' or change their contact_email, then re-run this migration. This migration never merges or deletes rows.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "customer_portal_access_active_contact_email_key"
  ON "customer_portal_access"("tenant_id", lower("contact_email"))
  WHERE "status" = 'ACTIVE';
