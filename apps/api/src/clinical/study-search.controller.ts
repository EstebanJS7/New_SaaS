import { Body, Controller, Get, Header, HttpCode, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { clinicalPatientParam, clinicalRecordParam, parseClinicalInput } from "./clinical.zod.js";
import { studySearchBody } from "./study-search.dto.js";
import { StudySearchService } from "./study-search.service.js";

@Controller("patients/:patientId/clinical/studies")
export class StudySearchController {
  constructor(private readonly studies: StudySearchService) {}

  /** Read-only POST keeps clinical free text out of URLs. */
  @Post("search")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("vet.clinical.read")
  async search(@Param() params: unknown, @Body() body: unknown) {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = studySearchBody.safeParse(body);
    if (!input.success) throw new DomainError("VALIDATION_FAILED", "Invalid study search input.");
    return this.studies.search(patientId, input.data);
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
    return this.studies.get(patientId, id);
  }
}
