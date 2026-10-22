/**
 * The NewSaaS veterinary patient boundary ([[DEC-073]], EPIC-19).
 *
 * It owns what a Patient IS when one is created: the create/update/guardian
 * schemas and their rules, the allowlisted `PatientResponse` and its mapper, the
 * global-catalog check and the primary-guardian link, and one `createPatient`
 * function that writes the patient, its guardian and both audit rows in a single
 * transaction.
 *
 * It exists because [[DEC-072]] put the import pipeline in the worker,
 * [[IMP-002]] forbids a second copy of any validation rule (including the
 * active-patient guardian requirement from Decision #2223), and the worker
 * cannot import from `apps/api`. `apps/api`'s `PatientsService.create` delegates
 * to the same function the worker will call.
 *
 * Framework-free by construction: no Nest decorator, no request object, no
 * ambient tenant, no ambient catalog. Everything the call needs — the client,
 * the audit appender, the tenant, the actor and the taxonomy — is a parameter.
 *
 * Reads, updates, deactivation and the standalone guardian routes stay in
 * `apps/api`; they import the shared pieces from here so nothing is duplicated.
 */
export {
  PATIENT_DTO_SCHEMA_VERSION,
  PATIENT_GUARDIAN_DTO_SCHEMA_VERSION,
  createGuardianBody,
  createPatientBody,
  patientGuardianParam,
  patientGuardiansParam,
  patientIdParam,
  patientSex,
  updateGuardianBody,
  updatePatientBody,
} from "./patient.zod.js";
export type {
  CreateGuardianInput,
  CreatePatientInput,
  PatientSex,
  UpdateGuardianInput,
  UpdatePatientInput,
} from "./patient.zod.js";
export type { PatientResponse } from "./patient.dto.js";
export {
  appendGuardianAudit,
  assertGlobalCatalog,
  assertTenantCustomer,
  changedPatientFields,
  createPatient,
  linkPrimaryGuardian,
  toPatientResponse,
} from "./patient.create.js";
export type {
  CreatePatientArgs,
  GuardianAudit,
  PatientAuditAppender,
  PatientCatalog,
  PatientCatalogBreedDelegate,
  PatientCatalogSpeciesDelegate,
  PatientCreateData,
  PatientCreateDb,
  PatientCreateDelegate,
  PatientCreateGuardianDelegate,
  PatientCreateTransaction,
  PatientCustomerDelegate,
  PatientGuardianCreateData,
  PatientGuardianRow,
  PatientGuardianUpdateData,
  PatientGuardianWhere,
  PatientRow,
} from "./patient.create.js";
