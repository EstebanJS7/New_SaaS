-- UX-024 / DEC-087: CONFIDENTIAL author-private working copies, never automatic deletion.
CREATE TABLE clinical_working_draft (
 id UUID PRIMARY KEY,
 tenant_id UUID NOT NULL,
 patient_id UUID NOT NULL,
 author_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 kind TEXT NOT NULL CHECK (kind IN ('treatment','study','weight')),
 state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','PENDING','COMPLETED','DISCARDED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
 command JSONB,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,patient_id) REFERENCES patient(tenant_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ((state='ACTIVE' AND command IS NULL) OR state='DISCARDED' OR (state IN ('PENDING','COMPLETED') AND jsonb_typeof(command)='object'))
);
CREATE INDEX clinical_working_draft_author_scope_idx ON clinical_working_draft(tenant_id,patient_id,author_id,kind,id);
CREATE FUNCTION protect_clinical_working_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clinical working drafts have no physical deletion policy'; END IF;
 IF OLD.state IN ('COMPLETED','DISCARDED') OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.patient_id<>OLD.patient_id OR NEW.author_id<>OLD.author_id OR NEW.kind<>OLD.kind OR NEW.version<>OLD.version+1 OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'Invalid clinical working draft transition';
 END IF;
 IF OLD.state='PENDING' AND (NEW.state NOT IN ('COMPLETED','DISCARDED') OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.command IS DISTINCT FROM OLD.command) THEN
  RAISE EXCEPTION 'Clinical draft attempts are frozen';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_clinical_working_draft BEFORE UPDATE OR DELETE ON clinical_working_draft FOR EACH ROW EXECUTE FUNCTION protect_clinical_working_draft();
