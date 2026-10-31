-- UX-019. CONFIDENTIAL clinical creation receipts; no expiry, backfill or data conversion.
CREATE TABLE clinical_creation_receipt (
 tenant_id uuid NOT NULL,
 patient_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('treatment', 'study', 'weight')),
 key uuid NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, patient_id, kind, key),
 FOREIGN KEY (tenant_id, patient_id) REFERENCES patient(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- A replay must remain tied to its original content and response.
CREATE FUNCTION clinical_creation_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Clinical creation receipts are immutable';
END;
$$;
CREATE TRIGGER clinical_creation_receipt_immutable BEFORE UPDATE OR DELETE ON clinical_creation_receipt
FOR EACH ROW EXECUTE FUNCTION clinical_creation_receipt_immutable();
