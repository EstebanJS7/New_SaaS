import { z } from "zod";
import { DomainError } from "@newsaas/shared";

/**
 * Current contract version of the customer DTO. Bumped when the accepted
 * key set or value formats change.
 */
export const CUSTOMER_DTO_SCHEMA_VERSION = 1;

export const customerKind = z.enum(["INDIVIDUAL", "COMPANY"]);
export type CustomerKind = z.infer<typeof customerKind>;

const displayNameField = z.string().min(1).max(200);

/**
 * Create payload for an INDIVIDUAL customer.
 * Strict: kind-mismatched company fields are rejected at the API boundary.
 */
const createIndividualBody = z
  .object({
    kind: z.literal("INDIVIDUAL"),
    displayName: displayNameField,
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    documentNumber: z.string().min(1).max(50).optional(),
  })
  .strict();

/**
 * Create payload for a COMPANY customer.
 * Strict: kind-mismatched individual fields are rejected at the API boundary.
 */
const createCompanyBody = z
  .object({
    kind: z.literal("COMPANY"),
    displayName: displayNameField,
    legalName: z.string().min(1).max(200),
    taxId: z.string().min(1).max(32),
  })
  .strict();

/**
 * Discriminated create schema. The union selects the correct branch by `kind`
 * and each branch is strict, so `taxId` on an INDIVIDUAL or `firstName` on a
 * COMPANY surface as VALIDATION_FAILED without leaking persisted values.
 */
export const createCustomerBody = z.discriminatedUnion("kind", [
  createIndividualBody,
  createCompanyBody,
]);

export type CreateCustomerInput = z.infer<typeof createCustomerBody>;

const updateCustomerPayloadSchema = z
  .object({
    displayName: displayNameField.optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    documentNumber: z.string().min(1).max(50).optional(),
    legalName: z.string().min(1).max(200).optional(),
    taxId: z.string().min(1).max(32).optional(),
  })
  .strict();

export type UpdateCustomerInput = z.infer<typeof updateCustomerPayloadSchema>;

export const updateCustomerBody = updateCustomerPayloadSchema;

export const customerIdParam = z.object({
  id: z.string().uuid(),
});

/**
 * Validates an update payload against the stored customer kind. The base schema
 * already rejects unknown keys; this check adds the kind-conditional rejection
 * required by design D1 (e.g. `taxId` is not accepted for an INDIVIDUAL).
 */
export function validateUpdateForKind(kind: CustomerKind, data: UpdateCustomerInput): void {
  const mismatches: string[] = [];

  if (kind === "INDIVIDUAL") {
    if (data.legalName !== undefined) mismatches.push("legalName");
    if (data.taxId !== undefined) mismatches.push("taxId");
  } else {
    if (data.firstName !== undefined) mismatches.push("firstName");
    if (data.lastName !== undefined) mismatches.push("lastName");
    if (data.documentNumber !== undefined) mismatches.push("documentNumber");
  }

  if (mismatches.length > 0) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `Fields not allowed for ${kind} customers: ${mismatches.join(", ")}.`
    );
  }
}
