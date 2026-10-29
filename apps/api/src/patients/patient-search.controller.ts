import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { patientSearchBody, type PatientSearchResponse } from "./patient-search.dto.js";
import { PatientSearchService } from "./patient-search.service.js";

@Controller("patients/search")
export class PatientSearchController {
  constructor(private readonly patients: PatientSearchService) {}
  /** Read-only POST keeps confidential names out of URLs. */
  @Post()
  @HttpCode(200)
  @RequirePermissions("patients.read")
  async search(@Body() body: unknown): Promise<PatientSearchResponse> {
    const parsed = patientSearchBody.safeParse(body);
    if (!parsed.success)
      throw new DomainError("VALIDATION_FAILED", "Invalid patient search input.");
    return this.patients.search(parsed.data);
  }
}
