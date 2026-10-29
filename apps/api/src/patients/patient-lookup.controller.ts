import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { patientLookupBody, type PatientIdentityResponse } from "./patient-lookup.dto.js";
import { PatientLookupService } from "./patient-lookup.service.js";

@Controller("patients/lookup")
export class PatientLookupController {
  constructor(private readonly patients: PatientLookupService) {}

  /** Read-only POST: CONFIDENTIAL search text never enters request URLs. */
  @Post()
  @HttpCode(200)
  @RequirePermissions("patients.read", "customers.read")
  async lookup(@Body() body: unknown): Promise<PatientIdentityResponse[]> {
    const parsed = patientLookupBody.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient lookup input.");
    }
    return this.patients.lookup(parsed.data);
  }
}
