-- DEC-086 / UX-023. CONFIDENTIAL immutable clinical revisions; no backfill/purge.

ALTER TABLE clinical_treatment ADD CONSTRAINT clinical_treatment_history_scope_key UNIQUE (tenant_id, patient_id, id);
CREATE TABLE clinical_treatment_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, patient_id UUID NOT NULL, record_id UUID NOT NULL,
  actor_user_profile_id UUID REFERENCES user_profile(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_display_name TEXT, correction_reason TEXT CHECK (correction_reason IS NULL OR (length(correction_reason) <= 2000 AND length(btrim(correction_reason)) > 0)),
  before_version INTEGER NOT NULL CHECK (before_version > 0),
  after_version INTEGER NOT NULL CHECK (after_version::bigint = before_version::bigint + 1),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  before_description TEXT NOT NULL,
  before_administered_at TIMESTAMPTZ(3) NOT NULL,
  before_context TEXT,
  after_description TEXT NOT NULL,
  after_administered_at TIMESTAMPTZ(3) NOT NULL,
  after_context TEXT,
  FOREIGN KEY (tenant_id, patient_id, record_id) REFERENCES clinical_treatment(tenant_id, patient_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT clinical_treatment_revision_version_key UNIQUE (tenant_id, patient_id, record_id, after_version)
);
CREATE FUNCTION capture_clinical_treatment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id UUID; actor_name TEXT; revision_id UUID; reason TEXT;
BEGIN
  actor_id := nullif(current_setting('newsaas.clinical_actor_id', true), '')::uuid;
  revision_id := coalesce(nullif(current_setting('newsaas.clinical_revision_id', true), '')::uuid, gen_random_uuid());
  reason := nullif(current_setting('newsaas.clinical_correction_reason', true), '');
  IF actor_id IS NOT NULL THEN SELECT display_name INTO STRICT actor_name FROM user_profile WHERE id = actor_id; END IF;
  INSERT INTO clinical_treatment_revision (id,tenant_id,patient_id,record_id,actor_user_profile_id,actor_display_name,correction_reason,before_version,after_version,before_description,before_administered_at,before_context,after_description,after_administered_at,after_context)
  VALUES (revision_id,NEW.tenant_id,NEW.patient_id,NEW.id,actor_id,actor_name,reason,OLD.version,NEW.version,OLD.description,OLD.administered_at,OLD.context,NEW.description,NEW.administered_at,NEW.context);
  RETURN NEW;
END $$;
CREATE TRIGGER capture_clinical_treatment_revision AFTER UPDATE ON clinical_treatment FOR EACH ROW EXECUTE FUNCTION capture_clinical_treatment_revision();
CREATE FUNCTION reject_clinical_treatment_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Clinical revisions are immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER protect_clinical_treatment_revision BEFORE UPDATE OR DELETE ON clinical_treatment_revision FOR EACH ROW EXECUTE FUNCTION reject_clinical_treatment_revision_mutation();

ALTER TABLE clinical_study ADD CONSTRAINT clinical_study_history_scope_key UNIQUE (tenant_id, patient_id, id);
CREATE TABLE clinical_study_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, patient_id UUID NOT NULL, record_id UUID NOT NULL,
  actor_user_profile_id UUID REFERENCES user_profile(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_display_name TEXT, correction_reason TEXT CHECK (correction_reason IS NULL OR (length(correction_reason) <= 2000 AND length(btrim(correction_reason)) > 0)),
  before_version INTEGER NOT NULL CHECK (before_version > 0),
  after_version INTEGER NOT NULL CHECK (after_version::bigint = before_version::bigint + 1),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  before_study_type TEXT NOT NULL,
  before_performed_at TIMESTAMPTZ(3) NOT NULL,
  before_result TEXT NOT NULL,
  after_study_type TEXT NOT NULL,
  after_performed_at TIMESTAMPTZ(3) NOT NULL,
  after_result TEXT NOT NULL,
  FOREIGN KEY (tenant_id, patient_id, record_id) REFERENCES clinical_study(tenant_id, patient_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT clinical_study_revision_version_key UNIQUE (tenant_id, patient_id, record_id, after_version)
);
CREATE FUNCTION capture_clinical_study_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id UUID; actor_name TEXT; revision_id UUID; reason TEXT;
BEGIN
  actor_id := nullif(current_setting('newsaas.clinical_actor_id', true), '')::uuid;
  revision_id := coalesce(nullif(current_setting('newsaas.clinical_revision_id', true), '')::uuid, gen_random_uuid());
  reason := nullif(current_setting('newsaas.clinical_correction_reason', true), '');
  IF actor_id IS NOT NULL THEN SELECT display_name INTO STRICT actor_name FROM user_profile WHERE id = actor_id; END IF;
  INSERT INTO clinical_study_revision (id,tenant_id,patient_id,record_id,actor_user_profile_id,actor_display_name,correction_reason,before_version,after_version,before_study_type,before_performed_at,before_result,after_study_type,after_performed_at,after_result)
  VALUES (revision_id,NEW.tenant_id,NEW.patient_id,NEW.id,actor_id,actor_name,reason,OLD.version,NEW.version,OLD.study_type,OLD.performed_at,OLD.result,NEW.study_type,NEW.performed_at,NEW.result);
  RETURN NEW;
END $$;
CREATE TRIGGER capture_clinical_study_revision AFTER UPDATE ON clinical_study FOR EACH ROW EXECUTE FUNCTION capture_clinical_study_revision();
CREATE FUNCTION reject_clinical_study_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Clinical revisions are immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER protect_clinical_study_revision BEFORE UPDATE OR DELETE ON clinical_study_revision FOR EACH ROW EXECUTE FUNCTION reject_clinical_study_revision_mutation();

ALTER TABLE clinical_weight ADD CONSTRAINT clinical_weight_history_scope_key UNIQUE (tenant_id, patient_id, id);
CREATE TABLE clinical_weight_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, patient_id UUID NOT NULL, record_id UUID NOT NULL,
  actor_user_profile_id UUID REFERENCES user_profile(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_display_name TEXT, correction_reason TEXT CHECK (correction_reason IS NULL OR (length(correction_reason) <= 2000 AND length(btrim(correction_reason)) > 0)),
  before_version INTEGER NOT NULL CHECK (before_version > 0),
  after_version INTEGER NOT NULL CHECK (after_version::bigint = before_version::bigint + 1),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  before_quantity DECIMAL(10,3) NOT NULL,
  before_unit "ClinicalWeightUnit",
  before_measured_at TIMESTAMPTZ(3) NOT NULL,
  after_quantity DECIMAL(10,3) NOT NULL,
  after_unit "ClinicalWeightUnit",
  after_measured_at TIMESTAMPTZ(3) NOT NULL,
  FOREIGN KEY (tenant_id, patient_id, record_id) REFERENCES clinical_weight(tenant_id, patient_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT clinical_weight_revision_version_key UNIQUE (tenant_id, patient_id, record_id, after_version)
);
CREATE FUNCTION capture_clinical_weight_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id UUID; actor_name TEXT; revision_id UUID; reason TEXT;
BEGIN
  actor_id := nullif(current_setting('newsaas.clinical_actor_id', true), '')::uuid;
  revision_id := coalesce(nullif(current_setting('newsaas.clinical_revision_id', true), '')::uuid, gen_random_uuid());
  reason := nullif(current_setting('newsaas.clinical_correction_reason', true), '');
  IF actor_id IS NOT NULL THEN SELECT display_name INTO STRICT actor_name FROM user_profile WHERE id = actor_id; END IF;
  INSERT INTO clinical_weight_revision (id,tenant_id,patient_id,record_id,actor_user_profile_id,actor_display_name,correction_reason,before_version,after_version,before_quantity,before_unit,before_measured_at,after_quantity,after_unit,after_measured_at)
  VALUES (revision_id,NEW.tenant_id,NEW.patient_id,NEW.id,actor_id,actor_name,reason,OLD.version,NEW.version,OLD.quantity,OLD.unit,OLD.measured_at,NEW.quantity,NEW.unit,NEW.measured_at);
  RETURN NEW;
END $$;
CREATE TRIGGER capture_clinical_weight_revision AFTER UPDATE ON clinical_weight FOR EACH ROW EXECUTE FUNCTION capture_clinical_weight_revision();
CREATE FUNCTION reject_clinical_weight_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Clinical revisions are immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER protect_clinical_weight_revision BEFORE UPDATE OR DELETE ON clinical_weight_revision FOR EACH ROW EXECUTE FUNCTION reject_clinical_weight_revision_mutation();

-- Seed-owned catalog/grants for already-seeded roles; fresh bootstrap also uses reference-seed.
INSERT INTO permission (key,name,updated_at) VALUES ('vet.clinical.history_read','Read clinical correction history',now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permission (role_id,permission_id,updated_at) SELECT r.id,p.id,now() FROM role r CROSS JOIN permission p WHERE r.code IN ('OWNER','ADMIN','VETERINARIAN') AND p.key='vet.clinical.history_read' ON CONFLICT (role_id,permission_id) DO NOTHING;
