import { DomainError } from "@newsaas/shared";
import { z, type ZodType } from "zod";

/**
 * HTTP input contracts for the Clinical module (EPIC-06 WU3).
 *
 * Every route input is validated HERE before reaching the application services,
 * which re-validate business invariants as defense in depth. Objects are
 * `.strict()` so an unknown key is a 400 `VALIDATION_FAILED`, never a silently
 * ignored field. `internalNotes` is accepted only because staff are the
 * authorized audience; it is stripped from any client-safe projection (WU2A
 * `toClientSafeEncounter`).
 *
 * Data classification: all free-text clinical content is CONFIDENTIAL and is
 * never logged.
 */

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
export function parseClinicalInput<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", message);
  }
  return parsed.data;
}

/** ISO-8601 with an explicit offset (or `Z`); stored as UTC by the service. */
const isoDate = z.string().datetime({ offset: true });

/** Free-text clinical field: bounded so a request cannot carry unbounded data. */
const encounterText = z.string().max(10_000);
const encounterTextField = encounterText.nullable().optional();

/** Required specialized-record fact: non-empty and bounded. */
const recordText = z.string().min(1).max(2_000);

/**
 * Positive exact decimal rendered as text, capped at the `Decimal(10,3)` DB
 * shape: up to 7 integer digits and up to 3 fractional digits.
 */
const positiveDecimal = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, "Weight quantity must be a positive decimal.")
  .refine((value) => Number(value) > 0, "Weight quantity must be greater than zero.");

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

/** Nested under the Patient: the tenant-owned anchor for every clinical route. */
export const clinicalPatientParam = z.object({ patientId: z.string().uuid() });

/** Encounter-addressed route (autosave, close, amendment). */
export const clinicalEncounterParam = z.object({
  patientId: z.string().uuid(),
  id: z.string().uuid(),
});

/** Specialized-record-addressed route (update). */
export const clinicalRecordParam = z.object({
  patientId: z.string().uuid(),
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Encounter bodies
// ---------------------------------------------------------------------------

/** Optional structured content shared by create/autosave/amendment. */
const encounterContent = {
  reasonForVisit: encounterTextField,
  anamnesis: encounterTextField,
  diagnosis: encounterTextField,
  treatmentPlan: encounterTextField,
  internalNotes: encounterTextField,
  clientSummary: encounterTextField,
} as const;

/** CREATE body: the content fields are optional; omitted fields persist null. */
export const createEncounterBody = z.object({ ...encounterContent }).strict();

/** AUTOSAVE body: content plus the version the caller last read (409 on drift). */
export const updateDraftBody = z
  .object({ version: z.number().int().min(1), ...encounterContent })
  .strict();

/** CLOSE body: only the optimistic-concurrency version. */
export const closeEncounterBody = z.object({ version: z.number().int().min(1) }).strict();

/** AMENDMENT body: required reason, optional idempotency key and content override. */
export const amendEncounterBody = z
  .object({
    reason: z.string().min(1).max(2_000),
    idempotencyKey: z.string().min(1).max(200).optional(),
    content: z
      .object({ ...encounterContent })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Specialized-record bodies (create requires facts; update is partial)
// ---------------------------------------------------------------------------

export const createTreatmentBody = z
  .object({ description: recordText, administeredAt: isoDate, context: encounterTextField })
  .strict();
export const updateTreatmentBody = z
  .object({
    description: recordText.optional(),
    administeredAt: isoDate.optional(),
    context: encounterTextField,
  })
  .strict();

export const createVaccinationBody = z
  .object({ vaccine: recordText, administeredAt: isoDate })
  .strict();
export const updateVaccinationBody = z
  .object({ vaccine: recordText.optional(), administeredAt: isoDate.optional() })
  .strict();

export const createDewormingBody = z
  .object({ product: recordText, administeredAt: isoDate })
  .strict();
export const updateDewormingBody = z
  .object({ product: recordText.optional(), administeredAt: isoDate.optional() })
  .strict();

export const createStudyBody = z
  .object({ studyType: recordText, performedAt: isoDate, result: z.string().max(10_000) })
  .strict();
export const updateStudyBody = z
  .object({
    studyType: recordText.optional(),
    performedAt: isoDate.optional(),
    result: z.string().max(10_000).optional(),
  })
  .strict();

export const createWeightBody = z
  .object({ quantity: positiveDecimal, measuredAt: isoDate })
  .strict();
export const updateWeightBody = z
  .object({ quantity: positiveDecimal.optional(), measuredAt: isoDate.optional() })
  .strict();
