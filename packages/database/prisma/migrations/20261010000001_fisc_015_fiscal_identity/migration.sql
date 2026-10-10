-- Additive EPIC-16 FISC-015 fiscal identity: the schema delta [[DEC-057]]
-- decided, and nothing else.
--
-- This migration models and constrains. It assembles no document, allocates no
-- number and changes no Billing path; WU-D maps these rows to a
-- `DteMappingInput` and WU-B owns the allocation's move to confirmation.
--
-- Four product decisions, four deltas, one migration:
--
-- 1. **A rate code's fiscal meaning is the tenant's declaration.** `tax_rate` is
--    GLOBAL and platform-seeded, and its `rate` is a percentage rather than a
--    tax treatment, so the affectation does NOT go there. It goes to
--    `tenant_tax_classification`, one row per (tenant, rate code), carrying
--    `E731 iAfecIVA` and — for a partially taxed line — `E733 dPropIVA`. The
--    reason is the Manual's own silence: it labels `iAfecIVA = 2` "Exonerado"
--    and `= 3` "Exento" and gives BOTH rate 0, so a derivation from the rate
--    would have to choose a legal characterisation on the tenant's behalf
--    (DEC-057 Q1).
-- 2. **The receptor is declared where the sources do not pin it.**
--    `customer.fiscal_operation_type` carries `iTiOpe` (`D202`), nullable and
--    NOT defaulted: DEC-057 Q2 chose a declaration over a derivation, and a
--    customer with no declaration makes issuance refuse.
-- 3. **The CSC is per tenant and per environment, sealed in the secret store.**
--    `tenant_fiscal_csc` mirrors `tenant_fiscal_signing_material`: the
--    identifier in the row, the VALUE behind an opaque `secret_ref` into
--    `tenant_secret`, retirement kept as the permanent record.
-- 4. **The tenant declares a default issuance point.** `fiscal_emitter_profile`
--    gains the establishment, the point of expedition and the document type;
--    the assembly resolves them to exactly one ACTIVE `fiscal_timbrado_range`.
--
-- Protocol citations, all from `docs/06-fiscal/SIFEN-BASELINE.md`:
--
--   tiAfecIVA      1..4     §21.5  Gravado IVA, Exonerado (Art. 100 - Ley
--                                   6380/2019), Exento, Gravado parcial
--   tdTasaIVA      >= 0     §21.4  the two-digit integer the DE carries
--   dTasaIVA's rule §21    rate 0 for Exonerado/Exento; 5 or 10 for Gravado
--   tdPunExp       [0-9]{3} §21.3  establishment and expedition point are
--                                   zero-padded to three digits
--   tiTiDE         1|4-7|9|10 §21.5  1 is Factura electrónica
--   cUniMed        1..4     §22.6  Unidades_Medida_v141.xsd, 64 values
--   IdCSC          4        §24.3  the QR's identifier, not the value
--   "hasta dos códigos de seguridad en estado activo" §24.2
--
-- Two invariants span two tables each and are enforced here rather than in a
-- service, because a service is not where an invariant lives:
--
-- 1. **The classification must agree with the rate it names.** The rule is the
--    protocol's, and the two values live in different tables, so a CHECK cannot
--    express it: `tenant_tax_classification_matches_rate` joins `tax_rate` on
--    every INSERT and UPDATE. Its converse — a `tax_rate.rate` changing under a
--    classification that already reads it — is guarded by
--    `tax_rate_classified_rate_immutable`, so a mismatch is impossible in both
--    directions rather than merely unlikely in one.
-- 2. **At most two ACTIVE CSCs per taxpayer and environment**, the Manual's own
--    bound (§24.2). A partial unique index expresses "at most one", not "at most
--    two", so `tenant_fiscal_csc_at_most_two_active` counts the active rows.
--
-- No existing table, column, constraint or row is rewritten. The three columns
-- added to existing tables are nullable and defaulted to NULL, so no backfill is
-- required: a tenant that has not declared anything reads as "not declared",
-- which is the failure DEC-057 chose over a document that misstates a tax
-- treatment.

CREATE TYPE "fiscal_iva_affectation" AS ENUM (
  'GRAVADO_IVA', 'EXONERADO', 'EXENTO', 'GRAVADO_PARCIAL'
);
CREATE TYPE "fiscal_operation_type" AS ENUM ('B2B', 'B2C', 'B2G', 'B2F');
CREATE TYPE "fiscal_csc_status" AS ENUM ('ACTIVE', 'RETIRED');

-- ---------------------------------------------------------------------------
-- 1. The tenant's classification of a GLOBAL rate code
-- ---------------------------------------------------------------------------

CREATE TABLE "tenant_tax_classification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- The GLOBAL rate this declaration reads, by its natural key (`tax_rate.code`
  -- is UNIQUE). RESTRICT, so a classified rate cannot be deleted.
  "rate_code" TEXT NOT NULL,
  -- `E731 iAfecIVA`, the tenant's declaration. The enum's four members are the
  -- protocol's four values and no others.
  "affectation" "fiscal_iva_affectation" NOT NULL,
  -- `E733 dPropIVA`, the taxed proportion of a partially taxed line. Required
  -- for GRAVADO_PARCIAL and meaningless otherwise: "meaningless" is enforced as
  -- absence, because a proportionality on an EXENTO line would be a value the
  -- DE must not carry.
  "proportionality" DECIMAL(5,2),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_tax_classification_pkey" PRIMARY KEY ("id"),
  -- `dPropIVA` is a percentage of the item's base: `tPorcDesc8` bounds it to
  -- `0 .. 100` (SIFEN-BASELINE.md §21.4), and `DECIMAL(5,2)`'s wider ceiling is
  -- not a licence. NULL passes (a NULL result is not a violation), so the three
  -- affectations that must not carry it are unaffected.
  CONSTRAINT "tenant_tax_classification_proportionality_dPropIVA"
    CHECK ("proportionality" IS NULL OR ("proportionality" >= 0 AND "proportionality" <= 100)),
  -- The pairing is an iff: GRAVADO_PARCIAL carries the proportionality and the
  -- other three do not. Written as an equality of the two NULL tests so it
  -- rejects both "partial without a proportion" and "a proportion without
  -- partial".
  CONSTRAINT "tenant_tax_classification_proportionality_iff_partial"
    CHECK (("affectation" = 'GRAVADO_PARCIAL') = ("proportionality" IS NOT NULL))
);

-- The ownership keys must exist before any composite reference targets them.
CREATE UNIQUE INDEX "tenant_tax_classification_tenant_id_id_key"
  ON "tenant_tax_classification"("tenant_id", "id");
-- One declaration per rate code per tenant: a classification is a statement, and
-- two statements for one code are not a state.
CREATE UNIQUE INDEX "tenant_tax_classification_tenant_id_rate_code_key"
  ON "tenant_tax_classification"("tenant_id", "rate_code");
CREATE INDEX "tenant_tax_classification_rate_code_idx"
  ON "tenant_tax_classification"("rate_code");

ALTER TABLE "tenant_tax_classification"
  ADD CONSTRAINT "tenant_tax_classification_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The GLOBAL rate is referenced by its natural key, so a classification names a
-- code a reader can cite, not an opaque row id. RESTRICT on UPDATE too: the FK
-- target cannot be renamed out from under a declaration.
ALTER TABLE "tenant_tax_classification"
  ADD CONSTRAINT "tenant_tax_classification_rate_code_fkey"
  FOREIGN KEY ("rate_code") REFERENCES "tax_rate"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The protocol's own consistency rule, and the reason it is a trigger rather
-- than a CHECK: `tax_rate.rate` lives in another table and a CHECK can only see
-- its own row.
--
-- `dTasaIVA`'s observation (SIFEN-BASELINE.md §21) pairs rate 0 with the two
-- untaxed affectations and rate 5 or 10 with the two taxed ones. Any other rate
-- is refused outright rather than silently admitted: a global rate the protocol
-- has no IVA rate for would make every classification of it a mismatch, and
-- admitting one would move the failure to SIFEN.
CREATE OR REPLACE FUNCTION "tenant_tax_classification_matches_rate"()
RETURNS TRIGGER AS $$
DECLARE
  rate_value NUMERIC(5,2);
BEGIN
  SELECT "rate" INTO rate_value FROM "tax_rate" WHERE "code" = NEW."rate_code";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tax rate code % does not exist', NEW."rate_code"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF rate_value = 0 THEN
    IF NEW."affectation" NOT IN ('EXONERADO', 'EXENTO') THEN
      RAISE EXCEPTION 'affectation % needs a taxed rate, but tax rate % carries %',
        NEW."affectation", NEW."rate_code", rate_value
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF rate_value IN (5, 10) THEN
    IF NEW."affectation" NOT IN ('GRAVADO_IVA', 'GRAVADO_PARCIAL') THEN
      RAISE EXCEPTION 'affectation % needs rate 0, but tax rate % carries %',
        NEW."affectation", NEW."rate_code", rate_value
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'tax rate % carries %, which dTasaIVA pairs with no affectation: the protocol''s IVA rates are 5 and 10 for a taxed operation and 0 for an untaxed one',
      NEW."rate_code", rate_value
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tenant_tax_classification_matches_rate_trigger"
  BEFORE INSERT OR UPDATE ON "tenant_tax_classification" FOR EACH ROW
  EXECUTE FUNCTION "tenant_tax_classification_matches_rate"();

-- The other direction of the same rule. The classification trigger cannot see a
-- later change to the rate, so without this guard `UPDATE tax_rate SET rate = 5
-- WHERE code = 'EXEMPT'` would leave every EXENTO declaration inconsistent with
-- the rate it names. The rate is reference data with no application write path
-- (the seed upserts with an empty update), and this makes that a database
-- property rather than a convention.
--
-- Only `rate` needs the guard: `code` is the FK target and `ON UPDATE RESTRICT`
-- already refuses to rename it while a declaration reads it, and a DELETE is
-- refused by `ON DELETE RESTRICT`.
CREATE OR REPLACE FUNCTION "tax_rate_classified_rate_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."rate" IS DISTINCT FROM OLD."rate"
    AND EXISTS (
      SELECT 1 FROM "tenant_tax_classification" WHERE "rate_code" = OLD."code"
    ) THEN
    RAISE EXCEPTION 'the rate of tax rate % cannot change while a tenant classification reads it', OLD."code"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tax_rate_classified_rate_immutable_trigger"
  BEFORE UPDATE ON "tax_rate" FOR EACH ROW
  EXECUTE FUNCTION "tax_rate_classified_rate_immutable"();

-- ---------------------------------------------------------------------------
-- 2. The receptor's declared operation type
-- ---------------------------------------------------------------------------

-- `iTiOpe` (`D202`, `tiTiOpe`): the protocol admits exactly four values
-- (SIFEN-BASELINE.md §22.3). NULLABLE AND NOT DEFAULTED, deliberately: DEC-057
-- Q2 chose a declaration over a derivation and invented no default for any of
-- the four, because `B2G` depends on the DNIT's own registry of state entities
-- and the other three on facts only the tenant knows. A customer with no
-- declaration makes issuance refuse, which is the point.
--
-- The four NAMES are stored, not the numeric codes, because the vault's record
-- of the code-to-name pairing is not consistent: §22.3 reads `D202 = 4` as B2C
-- while NT 010's validation `D202`/`1300` reads `4` as B2F and `2` as B2C.
-- Freezing either reading into the database would make the other one
-- unrepresentable, so the declaration is stored and the code is the assembly's
-- to resolve from a source that decides it.
ALTER TABLE "customer" ADD COLUMN "fiscal_operation_type" "fiscal_operation_type";

-- ---------------------------------------------------------------------------
-- 3. The item's unit of measure
-- ---------------------------------------------------------------------------

-- `cUniMed` (`Unidades_Medida_v141.xsd`, SIFEN-BASELINE.md §22.6): up to four
-- characters — `77` is "UNI Unidad". NULL means the item has no declared unit
-- and the assembly refuses rather than guessing one: the catalogue is the
-- protocol's, but WHICH unit an item is, is tenant data (DEC-057, "What this
-- document does not decide").
--
-- The check is the length only. The code's alphabet is not pinned by any
-- retrieved source — the recorded examples are digits — so requiring one would
-- be an invention rather than a citation.
ALTER TABLE "catalog_item" ADD COLUMN "unit_of_measure_code" VARCHAR(4);

ALTER TABLE "catalog_item"
  ADD CONSTRAINT "catalog_item_unit_of_measure_code_cUniMed"
  CHECK ("unit_of_measure_code" IS NULL OR length("unit_of_measure_code") BETWEEN 1 AND 4);

-- ---------------------------------------------------------------------------
-- 4. The default issuance point
-- ---------------------------------------------------------------------------

-- The three columns identify the authorisation together: the establishment
-- (`dEst`), the point of expedition (`C006 dPunExp`, three zero-padded digits,
-- §21.3) and the document type (`C002 iTiDE`, §21.5). All three are nullable
-- because the tenant declares them, and none is defaulted.
ALTER TABLE "fiscal_emitter_profile" ADD COLUMN "default_establishment_id" UUID;
ALTER TABLE "fiscal_emitter_profile" ADD COLUMN "default_expedition_point" VARCHAR(3);
ALTER TABLE "fiscal_emitter_profile" ADD COLUMN "default_document_type" SMALLINT;

-- The declaration is ATOMIC: all three or none. A point without an
-- establishment identifies no range, so a half-declared state is not a state a
-- reader could act on — it would only be a trap that turns "the tenant declared
-- nothing" into a resolution failure somewhere else.
ALTER TABLE "fiscal_emitter_profile"
  ADD CONSTRAINT "fiscal_emitter_profile_default_issuance_point_all_or_nothing" CHECK (
    ("default_establishment_id" IS NULL) = ("default_expedition_point" IS NULL)
    AND ("default_establishment_id" IS NULL) = ("default_document_type" IS NULL)
  );

ALTER TABLE "fiscal_emitter_profile"
  ADD CONSTRAINT "fiscal_emitter_profile_default_expedition_point_tdPunExp"
  CHECK ("default_expedition_point" IS NULL OR "default_expedition_point" ~ '^[0-9]{3}$');

-- `tiTiDE`'s allowed set, the same one `fiscal_timbrado_range.document_type`
-- carries: 1, 4, 5, 6, 7, 9 or 10. `1` is Factura electrónica.
ALTER TABLE "fiscal_emitter_profile"
  ADD CONSTRAINT "fiscal_emitter_profile_default_document_type_tiTiDE"
  CHECK ("default_document_type" IS NULL OR "default_document_type" IN (1, 4, 5, 6, 7, 9, 10));

-- Composite tenant-ownership FK: the default establishment is in the SAME
-- tenant, so a cross-tenant default is unrepresentable rather than merely
-- rejected by a service. RESTRICT, like every other fiscal reference.
ALTER TABLE "fiscal_emitter_profile"
  ADD CONSTRAINT "fiscal_emitter_profile_tenant_id_default_establishment_id_fkey"
  FOREIGN KEY ("tenant_id", "default_establishment_id")
  REFERENCES "fiscal_establishment"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- 5. The CSC — per taxpayer, per environment, value sealed
-- ---------------------------------------------------------------------------

-- The Manual's own words: the CSC is "generado por el SIFEN y entregado al
-- facturador electrónico" — per taxpayer — and "permitiéndose hasta dos códigos
-- de seguridad en estado activo" (SIFEN-BASELINE.md §24.2). The row carries the
-- identifier the QR prints (`IdCSC`, four characters, §24.3) and an opaque
-- reference; the VALUE lives in `tenant_secret` and never here, exactly as the
-- private key does. No log, DTO, audit payload or error message may carry either.
CREATE TABLE "tenant_fiscal_csc" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "environment" "fiscal_signing_environment" NOT NULL,
  "status" "fiscal_csc_status" NOT NULL DEFAULT 'ACTIVE',
  -- `IdCSC` (§24.3): four characters. The identifier is not secret — the QR
  -- carries it — and it names WHICH of the active values was used.
  "id_csc" VARCHAR(4) NOT NULL,
  -- Opaque key into `tenant_secret`. Never a value, never returned.
  "secret_ref" TEXT NOT NULL,
  -- Provenance only; the authoritative actor record is the audit row.
  "uploaded_by_user_profile_id" UUID,
  "retired_at" TIMESTAMPTZ(3),
  "retired_by_user_profile_id" UUID,
  "retirement_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_fiscal_csc_pkey" PRIMARY KEY ("id"),
  -- Exactly four characters, the length §24.3 records. The alphabet is not
  -- pinned by any retrieved source (every recorded example is numeric), so
  -- requiring one would be an invention rather than a citation.
  CONSTRAINT "tenant_fiscal_csc_id_csc_four_characters" CHECK (length("id_csc") = 4),
  -- The same two retirement invariants `tenant_fiscal_signing_material`
  -- carries, mirrored: a retired row is the permanent record, it names its
  -- instant, and it says why.
  CONSTRAINT "tenant_fiscal_csc_retired_at_iff_retired"
    CHECK (("retired_at" IS NULL) = ("status" = 'ACTIVE')),
  CONSTRAINT "tenant_fiscal_csc_retirement_reason_required"
    CHECK ("status" <> 'RETIRED' OR length(btrim(coalesce("retirement_reason", ''))) > 0)
);

CREATE UNIQUE INDEX "tenant_fiscal_csc_tenant_id_id_key"
  ON "tenant_fiscal_csc"("tenant_id", "id");
CREATE INDEX "tenant_fiscal_csc_tenant_id_status_idx"
  ON "tenant_fiscal_csc"("tenant_id", "status");

-- At most one ACTIVE row per identifier and environment: two rows claiming the
-- same `IdCSC` would make the QR's identifier ambiguous, and the value behind
-- each would be unverifiable. Prisma cannot express a partial unique index, so
-- it is declared here; a retired row falls outside it.
CREATE UNIQUE INDEX "tenant_fiscal_csc_one_active_per_id_key"
  ON "tenant_fiscal_csc"("tenant_id", "environment", "id_csc") WHERE "status" = 'ACTIVE';

ALTER TABLE "tenant_fiscal_csc"
  ADD CONSTRAINT "tenant_fiscal_csc_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The Manual's bound, and the reason it is a trigger: a partial unique index
-- expresses "at most one", never "at most two". The count excludes the row being
-- written, so an update that keeps a row ACTIVE is not counted against itself.
--
-- Known limit, recorded rather than hidden: under READ COMMITTED two concurrent
-- inserts can each count one active row and both commit. The bound is therefore
-- enforced per statement, not serializably; closing the window needs a lock or a
-- slot column, and neither is part of the decision this migration implements.
CREATE OR REPLACE FUNCTION "tenant_fiscal_csc_at_most_two_active"()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NEW."status" = 'ACTIVE' THEN
    SELECT count(*) INTO active_count
      FROM "tenant_fiscal_csc"
      WHERE "tenant_id" = NEW."tenant_id"
        AND "environment" = NEW."environment"
        AND "status" = 'ACTIVE'
        AND "id" <> NEW."id";

    IF active_count >= 2 THEN
      RAISE EXCEPTION 'tenant % already holds two ACTIVE CSCs for environment %: SIFEN allows up to two active, so retire one first',
        NEW."tenant_id", NEW."environment"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tenant_fiscal_csc_at_most_two_active_trigger"
  BEFORE INSERT OR UPDATE ON "tenant_fiscal_csc" FOR EACH ROW
  EXECUTE FUNCTION "tenant_fiscal_csc_at_most_two_active"();
