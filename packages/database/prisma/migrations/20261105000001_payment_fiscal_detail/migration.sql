-- PAY-DET-001 / DEC-091: the payment detail SIFEN needs for gCamCond (TD-074).
--
-- A factura electrónica must carry `gCamCond` with one `gPaConEIni` per payment
-- (Manual Técnico v150 E600/E605, rules 1500 and 1550), and its `iTiPago`
-- distinguishes a credit card (3) from a debit card (4), asks for the brand
-- (`gPagTarCD`, rule 1600), the cheque's number and bank (`gPagCheq`), and a
-- description when the type is "Otro" (99). None of it was stored.
--
-- Additive and nullable: payments written before this migration keep NULLs, and
-- the assembly refuses to build a factura from a payment that lacks what SIFEN
-- needs. Every payment written FROM NOW ON must carry its detail: the insert
-- guard below enforces it per method, and the CHECKs forbid detail that does not
-- belong to the method.

CREATE TYPE "payment_card_type" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "payment_card_brand" AS ENUM
  ('VISA', 'MASTERCARD', 'AMERICAN_EXPRESS', 'MAESTRO', 'PANAL', 'CABAL', 'OTHER');
CREATE TYPE "payment_qr_kind" AS ENUM ('WALLET', 'BANK_APP');

ALTER TABLE "payment"
  ADD COLUMN "card_type" "payment_card_type",
  ADD COLUMN "card_brand" "payment_card_brand",
  -- `dDesDenTarj` when the brand is "Otro" (iDenTarj = 99): 4 to 20 characters.
  ADD COLUMN "card_brand_name" VARCHAR(20),
  ADD COLUMN "qr_kind" "payment_qr_kind",
  -- `dNumCheq`, `tNumCheq`: exactly eight digits.
  ADD COLUMN "check_number" VARCHAR(8),
  -- `dBcoEmi`: 4 to 20 characters.
  ADD COLUMN "check_bank" VARCHAR(20),
  -- `dDesTiPag` when the type is "Otro" (99): 4 to 30 characters.
  ADD COLUMN "other_description" VARCHAR(30);

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_card_detail_only_for_card"
    CHECK ("method" = 'CARD' OR ("card_type" IS NULL AND "card_brand" IS NULL AND "card_brand_name" IS NULL)),
  ADD CONSTRAINT "payment_card_brand_name_iff_other"
    CHECK (("card_brand" = 'OTHER' AND "card_brand_name" IS NOT NULL)
        OR ("card_brand" IS DISTINCT FROM 'OTHER' AND "card_brand_name" IS NULL)),
  ADD CONSTRAINT "payment_card_brand_name_length"
    CHECK ("card_brand_name" IS NULL OR char_length(btrim("card_brand_name")) BETWEEN 4 AND 20),
  ADD CONSTRAINT "payment_qr_detail_only_for_qr"
    CHECK ("method" = 'QR' OR "qr_kind" IS NULL),
  ADD CONSTRAINT "payment_check_detail_only_for_check"
    CHECK ("method" = 'CHECK' OR ("check_number" IS NULL AND "check_bank" IS NULL)),
  ADD CONSTRAINT "payment_check_number_tNumCheq"
    CHECK ("check_number" IS NULL OR "check_number" ~ '^[0-9]{8}$'),
  ADD CONSTRAINT "payment_check_bank_length"
    CHECK ("check_bank" IS NULL OR char_length(btrim("check_bank")) BETWEEN 4 AND 20),
  ADD CONSTRAINT "payment_other_detail_only_for_other"
    CHECK ("method" = 'OTHER' OR "other_description" IS NULL),
  ADD CONSTRAINT "payment_other_description_length"
    CHECK ("other_description" IS NULL OR char_length(btrim("other_description")) BETWEEN 4 AND 30);

-- New payments must be complete. An INSERT trigger rather than a CHECK, because
-- a CHECK would also reject the rows written before this migration.
CREATE OR REPLACE FUNCTION "payment_fiscal_detail_required"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."method" = 'CARD' AND (NEW."card_type" IS NULL OR NEW."card_brand" IS NULL) THEN
    RAISE EXCEPTION 'a card payment needs its type (credit or debit) and its brand'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."method" = 'QR' AND NEW."qr_kind" IS NULL THEN
    RAISE EXCEPTION 'a QR payment needs its kind (wallet or bank app)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."method" = 'CHECK' AND (NEW."check_number" IS NULL OR NEW."check_bank" IS NULL) THEN
    RAISE EXCEPTION 'a cheque payment needs its number and its bank'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."method" = 'OTHER' AND NEW."other_description" IS NULL THEN
    RAISE EXCEPTION 'an "other" payment needs a description'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_fiscal_detail_required_trigger"
  BEFORE INSERT ON "payment" FOR EACH ROW EXECUTE FUNCTION "payment_fiscal_detail_required"();
