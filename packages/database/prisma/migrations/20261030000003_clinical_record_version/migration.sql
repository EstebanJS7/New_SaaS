-- UX-020. Technical revision only; no clinical content/unit conversion or history.
-- DEFAULT 1 initializes existing rows without interpreting their clinical content.
ALTER TABLE clinical_treatment ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE clinical_study ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE clinical_weight ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
-- Include every writer, including legacy clients. Ignore any caller-supplied version.
CREATE FUNCTION advance_clinical_record_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_treatment_version BEFORE UPDATE ON clinical_treatment FOR EACH ROW EXECUTE FUNCTION advance_clinical_record_version();
CREATE TRIGGER clinical_study_version BEFORE UPDATE ON clinical_study FOR EACH ROW EXECUTE FUNCTION advance_clinical_record_version();
CREATE TRIGGER clinical_weight_version BEFORE UPDATE ON clinical_weight FOR EACH ROW EXECUTE FUNCTION advance_clinical_record_version();
