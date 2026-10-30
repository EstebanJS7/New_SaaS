import { Body, Controller, Get, Header, HttpCode, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { clinicalPatientParam, clinicalRecordParam, parseClinicalInput } from "./clinical.zod.js";
import { treatmentSearchBody } from "./treatment-search.dto.js";
import { TreatmentSearchService } from "./treatment-search.service.js";

@Controller("patients/:patientId/clinical/treatments")
export class TreatmentSearchController {
  constructor(private readonly treatments: TreatmentSearchService) {}

  /** Read-only POST keeps clinical free text out of URLs. */
  @Post("search")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("vet.clinical.read")
  async search(@Param() params: unknown, @Body() body: unknown) {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = treatmentSearchBody.safeParse(body);
    if (!input.success)
      throw new DomainError("VALIDATION_FAILED", "Invalid treatment search input.");
    return this.treatments.search(patientId, input.data);
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("vet.clinical.read")
  async get(@Param() params: unknown) {
    const { patientId, id } = parseClinicalInput(
      clinicalRecordParam,
      params,
      "Invalid clinical record id."
    );
    return this.treatments.get(patientId, id);
  }
}
