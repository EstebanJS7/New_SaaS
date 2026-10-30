-- DEC-084 / UX-017: additive unit declaration, not a quantity/data conversion.
CREATE TYPE "ClinicalWeightUnit" AS ENUM ('KG');
ALTER TABLE "clinical_weight" ADD COLUMN "unit" "ClinicalWeightUnit";
-- No default or UPDATE: existing and legacy unqualified writes remain unspecified.
