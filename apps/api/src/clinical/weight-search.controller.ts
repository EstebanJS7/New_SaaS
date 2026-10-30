import { Body, Controller, Get, Header, HttpCode, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { clinicalPatientParam, clinicalRecordParam, parseClinicalInput } from "./clinical.zod.js";
import { weightSearchBody } from "./weight-search.dto.js";
import { WeightSearchService } from "./weight-search.service.js";

@Controller("patients/:patientId/clinical/weights")
export class WeightSearchController {
  constructor(private readonly weights: WeightSearchService) {}

  /** Read-only POST keeps clinical free text out of URLs. */
  @Post("search")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("vet.clinical.read")
  async search(@Param() params: unknown, @Body() body: unknown) {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = weightSearchBody.safeParse(body);
    if (!input.success) throw new DomainError("VALIDATION_FAILED", "Invalid weight search input.");
    return this.weights.search(patientId, input.data);
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
    return this.weights.get(patientId, id);
  }
}
