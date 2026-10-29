import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { ClinicalLinksService } from "./clinical.links.service.js";
import { clinicalEncounterParam, parseClinicalInput } from "./clinical.zod.js";

export const clinicalAppointmentLinkBody = z.object({ appointmentId: z.string().uuid() }).strict();
export const clinicalSaleLinkBody = z.object({ saleId: z.string().uuid() }).strict();

@Controller("patients/:patientId/clinical/encounters/:id/links")
export class ClinicalLinksController {
  constructor(private readonly links: ClinicalLinksService) {}
  @Get()
  @RequirePermissions("vet.clinical.read")
  async list(@Param() params: unknown) {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid encounter."
    );
    return this.links.list(patientId, id);
  }
  @Post("appointment")
  @RequirePermissions("vet.clinical.read", "vet.clinical.update", "scheduling.appointment.read")
  async appointment(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid encounter."
    );
    return this.links.link(
      patientId,
      id,
      parseClinicalInput(clinicalAppointmentLinkBody, body, "Invalid appointment link.")
    );
  }
  @Post("sale")
  @RequirePermissions("vet.clinical.read", "vet.clinical.update", "sales.read")
  async sale(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid encounter."
    );
    return this.links.link(
      patientId,
      id,
      parseClinicalInput(clinicalSaleLinkBody, body, "Invalid sale link.")
    );
  }
}

@Controller("patients/:patientId/clinical/appointments/:id/encounters")
export class ClinicalAppointmentEncountersController {
  constructor(private readonly links: ClinicalLinksService) {}
  @Get()
  @RequirePermissions("vet.clinical.read", "scheduling.appointment.read")
  async list(@Param() params: unknown) {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid appointment."
    );
    return this.links.forAppointment(patientId, id);
  }
}
