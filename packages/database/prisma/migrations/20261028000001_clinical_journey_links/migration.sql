-- DEC-083: additive Veterinary associations; existing aggregates remain unchanged.
CREATE UNIQUE INDEX "clinical_encounter_tenant_id_patient_id_id_key" ON "clinical_encounter" ("tenant_id", "patient_id", "id");
CREATE UNIQUE INDEX "appointment_tenant_id_patient_id_id_key" ON "appointment" ("tenant_id", "patient_id", "id");
CREATE TABLE "clinical_appointment_link" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
 "patient_id" UUID NOT NULL, "encounter_id" UUID NOT NULL, "appointment_id" UUID NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "clinical_appointment_link_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "clinical_appointment_link_encounter_fkey" FOREIGN KEY ("tenant_id","patient_id","encounter_id") REFERENCES "clinical_encounter" ("tenant_id","patient_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "clinical_appointment_link_appointment_fkey" FOREIGN KEY ("tenant_id","patient_id","appointment_id") REFERENCES "appointment" ("tenant_id","patient_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "clinical_appointment_link_tenant_id_encounter_id_key" ON "clinical_appointment_link" ("tenant_id","encounter_id");
CREATE INDEX "clinical_appointment_link_tenant_id_appointment_id_idx" ON "clinical_appointment_link" ("tenant_id","appointment_id");
CREATE TABLE "clinical_sale_link" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
 "encounter_id" UUID NOT NULL, "sale_id" UUID NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "clinical_sale_link_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "clinical_sale_link_encounter_fkey" FOREIGN KEY ("tenant_id","encounter_id") REFERENCES "clinical_encounter" ("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "clinical_sale_link_sale_fkey" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "sale" ("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "clinical_sale_link_tenant_id_sale_id_key" ON "clinical_sale_link" ("tenant_id","sale_id");
CREATE INDEX "clinical_sale_link_tenant_id_encounter_id_idx" ON "clinical_sale_link" ("tenant_id","encounter_id");
CREATE FUNCTION "prevent_clinical_link_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Clinical journey links are immutable'; END; $$;
CREATE TRIGGER "clinical_appointment_link_immutable" BEFORE UPDATE OR DELETE ON "clinical_appointment_link" FOR EACH ROW EXECUTE FUNCTION "prevent_clinical_link_change"();
CREATE TRIGGER "clinical_sale_link_immutable" BEFORE UPDATE OR DELETE ON "clinical_sale_link" FOR EACH ROW EXECUTE FUNCTION "prevent_clinical_link_change"();
