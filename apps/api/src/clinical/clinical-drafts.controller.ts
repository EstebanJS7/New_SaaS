import { Body, Controller, Get, Header, HttpCode, Param, Post, Put } from "@nestjs/common";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { clinicalPatientParam, clinicalRecordParam, parseClinicalInput } from "./clinical.zod.js";
import { ClinicalDraftsService } from "./clinical-drafts.service.js";
@Controller("patients/:patientId/clinical/drafts")
@RequirePermissions("vet.clinical.read")
export class ClinicalDraftsController {
  constructor(private readonly drafts: ClinicalDraftsService) {}
  @Post("search")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  search(@Param() params: unknown, @Body() body: unknown) {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient.");
    return this.drafts.search(patientId, body);
  }
  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  get(@Param() params: unknown) {
    const { patientId, id } = parseClinicalInput(clinicalRecordParam, params, "Invalid draft.");
    return this.drafts.get(patientId, id);
  }
  @Put(":id")
  @Header("Cache-Control", "private, no-store")
  save(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id } = parseClinicalInput(clinicalRecordParam, params, "Invalid draft.");
    return this.drafts.save(patientId, id, body);
  }
  @Post(":id/discard")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  discard(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id } = parseClinicalInput(clinicalRecordParam, params, "Invalid draft.");
    return this.drafts.discard(patientId, id, body);
  }
  @Post(":id/submit")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  submit(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id } = parseClinicalInput(clinicalRecordParam, params, "Invalid draft.");
    return this.drafts.submit(patientId, id, body);
  }
  @Post(":id/complete")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  complete(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id } = parseClinicalInput(clinicalRecordParam, params, "Invalid draft.");
    return this.drafts.complete(patientId, id, body);
  }
}
