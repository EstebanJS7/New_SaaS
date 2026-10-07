-- Additive EPIC-16 FISC-011 emitter profile, establishments and numbering
-- ranges (Manual §10.5, baseline §13).
--
-- Four tables and one enum. No existing table, column, constraint or row is
-- changed, so no backfill is required.
--
-- What these hold and why the shape is this one:
--
-- `fiscal_emitter_profile` is the issuer identity the DE carries: the RUC and
-- its check digit, the taxpayer type, the regime, the legal and trade names, the
-- optional responsible issuer (`gRespDE`), the economic activities (`gActEco`,
-- one row each in `fiscal_emitter_activity`) and the operation defaults. It is
-- one per tenant, because the RUC must match the one on the signing certificate
-- (baseline §22.4) — an invariant, not a preference.
--
-- `fiscal_establishment` is the establishment: its code (`dEst`) and the
-- address the DE carries. It is a table rather than columns on the range because
-- the Manual's identifying sequence names it and the test guide asks for one
-- establishment with up to three points of expedition, so the address would
-- otherwise be repeated for every point and could diverge between them.
--
-- `fiscal_timbrado_range` is one authorised range and the counter it is consumed
-- by, keyed by the Manual's sequence: timbrado + establishment + expedition
-- point + document type + series. `series` NULL is a genuine state, not a missing
-- value: it is the initial range, which the Manual says is consumed for each
-- document type before `AA` starts.
--
-- Protocol codes are stored as the protocol's own smallints with a CHECK on the
-- allowed set, not as named enums. The code is what the DE carries and what
-- SIFEN validates, so a name would be a translation layer with nothing on the
-- other side.
--
-- The descriptions are derived from the sources and keyed by CODE, never by
-- position: `tiTipTra` has 13 codes and the Manual states all 13 pairings, while
-- `DE_Types_v150.xsd`'s `tdDesTiTran` enumerates only 11 of them — the Manual's
-- list with codes 3 and 7 removed. A positional mapping would give every
-- transaction type from 3 upward the wrong text. See the Story's Database section.
--
-- Two invariants are enforced here rather than in the service:
--
-- 1. `next_number` is never lowered, so a consumed number cannot be reissued.
--    The number is part of the CDC and a rejected DE keeps its CDC (Manual §6.5,
--    baseline §12), which makes a number burnt the moment it is handed out.
-- 2. `status` and the counter cannot disagree: an EXHAUSTED range has run out and
--    an ACTIVE one has not. RETIRED is deliberately unconstrained by those two,
--    because an operator may retire a range at any point in its life.
--
-- All references are RESTRICT and tenant ownership is composite, so a
-- cross-tenant reference is unrepresentable rather than merely rejected.

CREATE TYPE "fiscal_timbrado_range_status" AS ENUM ('ACTIVE', 'EXHAUSTED', 'RETIRED');

CREATE TABLE "fiscal_emitter_profile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- `D101 dRucEm`, `tRuc`: 3..8 of `[1-9][0-9]*[0-9A-D]?`.
  "ruc" VARCHAR(8) NOT NULL,
  -- `D102 dDVEmi`, `tDVer`.
  "check_digit" VARCHAR(1) NOT NULL,
  -- `D103 iTipCont`: 1 = persona física, 2 = persona jurídica.
  "taxpayer_type" SMALLINT NOT NULL,
  -- `cTipReg`, `tcTipReg`: 1..8. Tabla 1 is not retrieved (FISC-008's notes), so
  -- the code is stored as supplied.
  "regime_code" SMALLINT,
  -- `D105 dNomEmi` / `dNomFanEmi`, `tdNombre`: 4..255.
  "legal_name" VARCHAR(255) NOT NULL,
  "trade_name" VARCHAR(255),
  -- `gRespDE`, optional as a whole: the five columns are set together or not at
  -- all. `tiTipIDRespDE` admits 9 as well as 1-4, and `tdDTipIDRespDE` lists only
  -- four descriptions — an inconsistency in the official schema that is recorded
  -- in the Story rather than resolved by guessing a fifth.
  "responsible_issuer_type" SMALLINT,
  "responsible_issuer_type_name" TEXT,
  "responsible_issuer_id" VARCHAR(20),
  "responsible_issuer_name" VARCHAR(255),
  "responsible_issuer_role" VARCHAR(100),
  -- `gOpeCom`: `iTipTra` is optional in the schema and `iTImp` is required, so
  -- only the second is NOT NULL. `iTipEmi` is the default the emitter uses.
  "transaction_type" SMALLINT,
  "tax_type" SMALLINT NOT NULL,
  "emission_type" SMALLINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_emitter_profile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_emitter_profile_ruc_tRuc" CHECK (
    "ruc" ~ '^[1-9][0-9]*[0-9A-D]?$' AND length("ruc") BETWEEN 3 AND 8
  ),
  CONSTRAINT "fiscal_emitter_profile_check_digit_tDVer" CHECK ("check_digit" ~ '^[0-9]$'),
  CONSTRAINT "fiscal_emitter_profile_taxpayer_type_tiTipCont" CHECK ("taxpayer_type" IN (1, 2)),
  CONSTRAINT "fiscal_emitter_profile_regime_code_tcTipReg"
    CHECK ("regime_code" IS NULL OR "regime_code" BETWEEN 1 AND 8),
  CONSTRAINT "fiscal_emitter_profile_legal_name_tdNombre"
    CHECK (length("legal_name") BETWEEN 4 AND 255),
  CONSTRAINT "fiscal_emitter_profile_trade_name_tdNombre"
    CHECK ("trade_name" IS NULL OR length("trade_name") BETWEEN 4 AND 255),
  CONSTRAINT "fiscal_emitter_profile_responsible_issuer_all_or_nothing" CHECK (
    ("responsible_issuer_type" IS NULL)
      = ("responsible_issuer_type_name" IS NULL)
    AND ("responsible_issuer_type" IS NULL) = ("responsible_issuer_id" IS NULL)
    AND ("responsible_issuer_type" IS NULL) = ("responsible_issuer_name" IS NULL)
    AND ("responsible_issuer_type" IS NULL) = ("responsible_issuer_role" IS NULL)
  ),
  CONSTRAINT "fiscal_emitter_profile_responsible_issuer_type_tiTipIDRespDE"
    CHECK ("responsible_issuer_type" IS NULL OR "responsible_issuer_type" IN (1, 2, 3, 4, 9)),
  CONSTRAINT "fiscal_emitter_profile_responsible_issuer_id_tdNumDocId"
    CHECK ("responsible_issuer_id" IS NULL OR "responsible_issuer_id" ~ '^[0-9A-Za-z-]{1,20}$'),
  CONSTRAINT "fiscal_emitter_profile_responsible_issuer_name_tdNombre"
    CHECK ("responsible_issuer_name" IS NULL OR length("responsible_issuer_name") BETWEEN 4 AND 255),
  CONSTRAINT "fiscal_emitter_profile_responsible_issuer_role_tdCargo"
    CHECK ("responsible_issuer_role" IS NULL OR length("responsible_issuer_role") BETWEEN 4 AND 100),
  CONSTRAINT "fiscal_emitter_profile_transaction_type_tiTipTra"
    CHECK ("transaction_type" IS NULL OR "transaction_type" BETWEEN 1 AND 13),
  CONSTRAINT "fiscal_emitter_profile_tax_type_tiTImp" CHECK ("tax_type" BETWEEN 1 AND 5),
  CONSTRAINT "fiscal_emitter_profile_emission_type_tiTipEmi" CHECK ("emission_type" IN (1, 2))
);

CREATE TABLE "fiscal_emitter_activity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  -- Position in `gActEco`; the DE carries the activities in this order.
  "position" SMALLINT NOT NULL,
  -- `cActEco`, `tcActEco`: 1..8 of `[0-9A-Z]`. The code list is not retrieved
  -- (FISC-008's notes), so the code is stored as supplied.
  "code" VARCHAR(8) NOT NULL,
  -- `dDesActEco`, `tdDesActEco`: 1..300.
  "description" VARCHAR(300) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_emitter_activity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_emitter_activity_position_non_negative" CHECK ("position" >= 0),
  CONSTRAINT "fiscal_emitter_activity_code_tcActEco" CHECK ("code" ~ '^[0-9A-Z]{1,8}$'),
  CONSTRAINT "fiscal_emitter_activity_description_tdDesActEco"
    CHECK (length("description") BETWEEN 1 AND 300)
);

CREATE TABLE "fiscal_establishment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- `D107 dEst`, `tdEst`: three digits, zero-padded.
  "code" VARCHAR(3) NOT NULL,
  -- `dDirEmi`, `tdDirec`: 1..255.
  "address_line" VARCHAR(255) NOT NULL,
  -- `D108 dNumCas`, `tdNumCas`: 0..999999. "Si no tiene numeración, colocar 0".
  "house_number" INTEGER NOT NULL,
  "address_complement1" VARCHAR(255),
  "address_complement2" VARCHAR(255),
  -- `D111 cDepEmi`, `tDepartamentos`: 1..20. `dDesDepEmi` is NOT stored:
  -- `Departamentos_v141.xsd` enumerates the twenty names, so the pair is derived
  -- from the code and cannot drift.
  "department_code" SMALLINT NOT NULL,
  -- `D113 cDisEmi`, `tcDisEmi`: 1..9999, optional. Its name is NOT enumerable
  -- (272 districts in the official spreadsheet), so it is stored and set with
  -- the code or not at all.
  "district_code" SMALLINT,
  "district_name" VARCHAR(30),
  -- `D115 cCiuEmi`, `tcCiuEmi`: 1..99999. Its name is not enumerable either
  -- (6,766 cities), so it is stored.
  "city_code" INTEGER NOT NULL,
  "city_name" VARCHAR(30) NOT NULL,
  -- `dTelEmi`, `tdTel`: 6..15.
  "phone" VARCHAR(15) NOT NULL,
  -- `dEmailE`, `tEmail`: the schema's own pattern.
  "email" VARCHAR(255) NOT NULL,
  -- `dDenSuc`, 1..30, optional.
  "branch_name" VARCHAR(30),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_establishment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_establishment_code_tdEst" CHECK ("code" ~ '^[0-9]{3}$'),
  CONSTRAINT "fiscal_establishment_address_line_tdDirec"
    CHECK (length("address_line") BETWEEN 1 AND 255),
  CONSTRAINT "fiscal_establishment_house_number_tdNumCas"
    CHECK ("house_number" BETWEEN 0 AND 999999),
  CONSTRAINT "fiscal_establishment_department_code_tDepartamentos"
    CHECK ("department_code" BETWEEN 1 AND 20),
  CONSTRAINT "fiscal_establishment_district_pair_all_or_nothing"
    CHECK (("district_code" IS NULL) = ("district_name" IS NULL)),
  CONSTRAINT "fiscal_establishment_district_code_tcDisEmi"
    CHECK ("district_code" IS NULL OR "district_code" BETWEEN 1 AND 9999),
  CONSTRAINT "fiscal_establishment_district_name_tdDesDisEmi"
    CHECK ("district_name" IS NULL OR length("district_name") BETWEEN 1 AND 30),
  CONSTRAINT "fiscal_establishment_city_code_tcCiuEmi"
    CHECK ("city_code" BETWEEN 1 AND 99999),
  CONSTRAINT "fiscal_establishment_city_name_tdDesCiuEmi"
    CHECK (length("city_name") BETWEEN 1 AND 30),
  CONSTRAINT "fiscal_establishment_phone_tdTel" CHECK (length("phone") BETWEEN 6 AND 15),
  CONSTRAINT "fiscal_establishment_email_tEmail" CHECK (
    "email" ~ '^[0-9a-zA-Z]([0-9a-zA-Z._-])*@([0-9a-zA-Z][0-9a-zA-Z_-]*\.)+[a-zA-Z]{2,9}$'
  ),
  CONSTRAINT "fiscal_establishment_branch_name_dDenSuc"
    CHECK ("branch_name" IS NULL OR length("branch_name") BETWEEN 1 AND 30)
);

CREATE TABLE "fiscal_timbrado_range" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  -- `dPunExp`, `tdPunExp`: three digits, zero-padded.
  "expedition_point" VARCHAR(3) NOT NULL,
  -- `iTiDE`, `tiTiDE`: 1, 4, 5, 6, 7, 9 or 10. The description is derived.
  "document_type" SMALLINT NOT NULL,
  -- `dSerieNum`, `tdSerieNum`: `[A-Z]{2}`, or NULL for the initial range. The
  -- Manual excludes Ñ because it is not in A-Z, so no separate rule is needed.
  "series" VARCHAR(2),
  -- `dNumTim`, `tdNumTim`: exactly eight digits, never all zero.
  "timbrado_number" VARCHAR(8) NOT NULL,
  -- The authorised span, as integers 1..9999999. `tdNumDoc` forbids an all-zero
  -- value, so 1 is the floor; the seven-digit string is the EMITTED form.
  "range_from" INTEGER NOT NULL,
  "range_to" INTEGER NOT NULL,
  -- `dFeIniT`, `tdFeIniT`: a date, `minInclusive` 2018-05-01.
  "validity_start" TIMESTAMPTZ(3) NOT NULL,
  -- The next number to hand out. Never lowered: a consumed number is burnt.
  "next_number" INTEGER NOT NULL,
  -- Set once, from the first DE's digital-signature date-time in this series,
  -- which is the instant SIFEN takes as the series' start (Manual §10.5).
  "series_started_at" TIMESTAMPTZ(3),
  "status" "fiscal_timbrado_range_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_timbrado_range_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_timbrado_range_expedition_point_tdPunExp"
    CHECK ("expedition_point" ~ '^[0-9]{3}$'),
  CONSTRAINT "fiscal_timbrado_range_document_type_tiTiDE"
    CHECK ("document_type" IN (1, 4, 5, 6, 7, 9, 10)),
  CONSTRAINT "fiscal_timbrado_range_series_tdSerieNum"
    CHECK ("series" IS NULL OR "series" ~ '^[A-Z]{2}$'),
  CONSTRAINT "fiscal_timbrado_range_timbrado_number_tdNumTim"
    CHECK (length("timbrado_number") = 8 AND "timbrado_number" ~ '^0*[1-9][0-9]*$'),
  CONSTRAINT "fiscal_timbrado_range_from_tdNumDoc" CHECK ("range_from" BETWEEN 1 AND 9999999),
  CONSTRAINT "fiscal_timbrado_range_to_tdNumDoc" CHECK ("range_to" BETWEEN 1 AND 9999999),
  CONSTRAINT "fiscal_timbrado_range_ordered" CHECK ("range_from" <= "range_to"),
  -- `dFeIniT` is a DATE in the schema, and the repository's convention persists
  -- every DateTime as UTC timestamptz, so it is anchored to midnight UTC and the
  -- DE emits the date part.
  --
  -- The anchor is pinned to UTC explicitly. `date_trunc('day', timestamptz)`
  -- truncates in the SESSION's TimeZone, so the obvious form enforces midnight in
  -- whatever timezone the connection happens to use — it rejects a correctly
  -- anchored row under America/New_York and accepts a local-midnight one. The
  -- `AT TIME ZONE 'UTC'` pair takes the value to a zone-free timestamp, truncates
  -- that, and brings it back, so the result depends only on the stored value.
  CONSTRAINT "fiscal_timbrado_range_validity_start_tdFeIniT"
    CHECK ("validity_start" >= TIMESTAMPTZ '2018-05-01 00:00:00+00'),
  CONSTRAINT "fiscal_timbrado_range_validity_start_is_a_date" CHECK (
    ("validity_start" AT TIME ZONE 'UTC')
      = date_trunc('day', "validity_start" AT TIME ZONE 'UTC')
  ),
  -- The counter is bounded by its own range. This is the STATIC half; the
  -- transition half — that it never decreases — needs a trigger, because a CHECK
  -- cannot see the old value. See the guard below.
  CONSTRAINT "fiscal_timbrado_range_next_number_within_range"
    CHECK ("next_number" >= "range_from"),
  -- `status` and the counter cannot disagree. RETIRED is deliberately free of
  -- both implications: an operator may retire a range at any point in its life.
  CONSTRAINT "fiscal_timbrado_range_exhausted_has_run_out"
    CHECK ("status" <> 'EXHAUSTED' OR "next_number" > "range_to"),
  -- An ACTIVE range may be SPENT but not yet rolled over, which is why the bound
  -- is `range_to + 1` and not `range_to`. The counter holds the NEXT number to
  -- hand out, so the claim that takes the last number increments it one past the
  -- end — and the rollover happens on the next call, when the allocation finds it
  -- spent. A bound of `range_to` would refuse that increment, making the LAST
  -- number of every range impossible to issue.
  CONSTRAINT "fiscal_timbrado_range_active_within_one_past_the_end"
    CHECK ("status" <> 'ACTIVE' OR "next_number" <= "range_to" + 1)
);

-- The ownership keys must exist before any composite reference targets them.
CREATE UNIQUE INDEX "fiscal_emitter_profile_tenant_id_key"
  ON "fiscal_emitter_profile"("tenant_id");
CREATE UNIQUE INDEX "fiscal_emitter_profile_tenant_id_id_key"
  ON "fiscal_emitter_profile"("tenant_id", "id");
CREATE UNIQUE INDEX "fiscal_establishment_tenant_id_id_key"
  ON "fiscal_establishment"("tenant_id", "id");
CREATE UNIQUE INDEX "fiscal_establishment_tenant_id_code_key"
  ON "fiscal_establishment"("tenant_id", "code");
CREATE UNIQUE INDEX "fiscal_emitter_activity_profile_id_position_key"
  ON "fiscal_emitter_activity"("profile_id", "position");
-- The identity is the Manual's whole sequence, and the TIMBRADO NUMBER IS PART OF
-- IT. Leaving it out made a new authorisation impossible to register: a second
-- timbrado for the same establishment, point, document type and series collided
-- with the first, even though it is a different authorisation.
CREATE UNIQUE INDEX "fiscal_timbrado_range_tenant_id_establishment_id_expedition_key"
  ON "fiscal_timbrado_range"(
    "tenant_id", "establishment_id", "expedition_point", "document_type", "series",
    "timbrado_number"
  );

-- Two states that a plain unique index cannot express, because PostgreSQL treats
-- NULLs as distinct and would admit many seriesless rows for the same key.
--
-- At most one range carries no series per establishment, point, document type
-- and timbrado: it is that authorisation's initial range, and the Manual
-- describes exactly one. Scoped per timbrado for the same reason the identity is:
-- a second authorisation has its own seriesless range.
CREATE UNIQUE INDEX "fiscal_timbrado_range_single_seriesless_key"
  ON "fiscal_timbrado_range"(
    "tenant_id", "establishment_id", "expedition_point", "document_type", "timbrado_number"
  )
  WHERE "series" IS NULL;

-- At most one ACTIVE range per authorisation. Deliberately NOT scoped to the
-- establishment alone: an operator has to be able to register next year's
-- timbrado while this year's is still in use, so two authorisations may each be
-- ACTIVE at once.
--
-- The allocation therefore does not pick "the ACTIVE range" — it picks the ACTIVE
-- range with the GREATEST `validity_start`, which is the current authorisation.
-- That rule is the allocation's, and it is pinned in the Story; this index is
-- what guarantees there is at most one candidate per authorisation.
CREATE UNIQUE INDEX "fiscal_timbrado_range_single_active_key"
  ON "fiscal_timbrado_range"(
    "tenant_id", "establishment_id", "expedition_point", "document_type", "timbrado_number"
  )
  WHERE "status" = 'ACTIVE';

CREATE INDEX "fiscal_timbrado_range_tenant_id_status_idx"
  ON "fiscal_timbrado_range"("tenant_id", "status");

ALTER TABLE "fiscal_emitter_profile"
  ADD CONSTRAINT "fiscal_emitter_profile_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fiscal_emitter_activity"
  ADD CONSTRAINT "fiscal_emitter_activity_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: the activity belongs to a profile in the SAME
-- tenant, so a cross-tenant activity is unrepresentable.
ALTER TABLE "fiscal_emitter_activity"
  ADD CONSTRAINT "fiscal_emitter_activity_tenant_id_profile_id_fkey"
  FOREIGN KEY ("tenant_id", "profile_id")
  REFERENCES "fiscal_emitter_profile"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "fiscal_establishment"
  ADD CONSTRAINT "fiscal_establishment_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fiscal_timbrado_range"
  ADD CONSTRAINT "fiscal_timbrado_range_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: the range's establishment is in the SAME tenant.
ALTER TABLE "fiscal_timbrado_range"
  ADD CONSTRAINT "fiscal_timbrado_range_tenant_id_establishment_id_fkey"
  FOREIGN KEY ("tenant_id", "establishment_id")
  REFERENCES "fiscal_establishment"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Monotonicity is a TRANSITION invariant, not a row invariant: a CHECK can only
-- see the new row, so `next_number >= range_from` would happily accept lowering
-- a counter from 500 back to 1 — and that is the defect this guard exists for.
-- A consumed number is burnt, because the number is part of the CDC and a
-- rejected DE keeps its CDC (Manual §6.5, baseline §12), so lowering the counter
-- would hand out a number that is already on a document.
CREATE OR REPLACE FUNCTION "fiscal_timbrado_range_next_number_monotonic"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."next_number" < OLD."next_number" THEN
    RAISE EXCEPTION 'a timbrado range counter cannot be lowered, from % to %',
      OLD."next_number", NEW."next_number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fiscal_timbrado_range_next_number_monotonic_trigger"
  BEFORE UPDATE ON "fiscal_timbrado_range" FOR EACH ROW
  EXECUTE FUNCTION "fiscal_timbrado_range_next_number_monotonic"();

-- A range that has consumed numbers is history, not configuration: retiring it
-- keeps the record, and deleting it would orphan the numbers it handed out.
-- The deletion guard is a trigger rather than a privilege so it holds for every
-- caller, including a migration.
CREATE OR REPLACE FUNCTION "fiscal_timbrado_range_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a timbrado range cannot be deleted; retire it instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fiscal_timbrado_range_no_delete_trigger"
  BEFORE DELETE ON "fiscal_timbrado_range" FOR EACH ROW
  EXECUTE FUNCTION "fiscal_timbrado_range_no_delete"();
