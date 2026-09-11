import { z } from "zod";

/**
 * Current contract version of the Patient DTO. Bumped when the accepted key
 * set or value formats change.
 */
export const PATIENT_DTO_SCHEMA_VERSION = 1;

/** Contract version of the PatientGuardian DTO. */
export const PATIENT_GUARDIAN_DTO_SCHEMA_VERSION = 1;

/** Pinned Patient sex values; mirrors the `patient_sex` database enum. */
export const patientSex = z.enum(["MALE", "FEMALE", "UNKNOWN"]);
export type PatientSex = z.infer<typeof patientSex>;

const nameField = z.string().min(1).max(200);
const birthDateField = z.string().datetime({ offset: true });

/**
 * Create payload. `primaryGuardianCustomerId` is REQUIRED when the Patient is
 * active (the default) so a lone active Patient can never be persisted; it may
 * be omitted only for an explicitly inactive Patient (Decision #2223). Species
 * and Breed are global catalog UUIDs and are validated against the global seed
 * by the service, never tenant-filtered.
 */
const createPatientPayload = z
  .object({
    name: nameField,
    speciesId: z.string().uuid(),
    breedId: z.string().uuid().optional(),
    sex: patientSex,
    birthDate: birthDateField.optional(),
    isActive: z.boolean().optional(),
    primaryGuardianCustomerId: z.string().uuid().optional(),
  })
  .strict();

export const createPatientBody = createPatientPayload.superRefine((value, ctx) => {
  if (value.isActive !== false && value.primaryGuardianCustomerId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryGuardianCustomerId"],
      message: "primaryGuardianCustomerId is required when creating an active patient.",
    });
  }
});

export type CreatePatientInput = z.infer<typeof createPatientPayload>;

/**
 * Update payload. `breedId`/`birthDate` accept `null` to clear the value.
 * `primaryGuardianCustomerId` only participates in the guardian transaction; it
 * is never a Patient column and never appears in a response DTO.
 */
const updatePatientPayload = z
  .object({
    name: nameField.optional(),
    speciesId: z.string().uuid().optional(),
    breedId: z.string().uuid().nullable().optional(),
    sex: patientSex.optional(),
    birthDate: birthDateField.nullable().optional(),
    isActive: z.boolean().optional(),
    primaryGuardianCustomerId: z.string().uuid().optional(),
  })
  .strict();

export const updatePatientBody = updatePatientPayload;
export type UpdatePatientInput = z.infer<typeof updatePatientPayload>;

export const patientIdParam = z.object({ id: z.string().uuid() });
