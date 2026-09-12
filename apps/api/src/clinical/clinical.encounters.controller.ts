import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import type { ClinicalEncounterResponse } from "./clinical.dto.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";
import { ClinicalService } from "./clinical.service.js";
import {
  amendEncounterBody,
  clinicalEncounterParam,
  clinicalPatientParam,
  closeEncounterBody,
  createEncounterBody,
  parseClinicalInput,
  updateDraftBody,
} from "./clinical.zod.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";

/**
 * Clinical encounter surface (EPIC-06 WU3), nested under the Patient so the
 * tenant anchor is always a route parameter that only the server resolves.
 *
 * Every route declares its granular `vet.clinical.*` permission; the service
 * re-checks the same key plus the `veterinary` entitlement as defense in depth.
 * Bodies are Zod-validated before the service; responses are allowlisted staff
 * DTOs. A route/body `tenantId` is never read — tenant identity comes only from
 * `RequestContextService`, so a foreign Patient UUID is a 404.
 */
@Controller("patients/:patientId/clinical/encounters")
export class ClinicalEncountersController {
  constructor(private readonly clinical: ClinicalService) {}

  /** Lists the Patient's encounters, newest first. */
  @Get()
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async list(@Param() params: unknown): Promise<ClinicalEncounterResponse[]> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.clinical.listEncounters(patientId);
  }

  /** Creates a DRAFT encounter for an in-tenant Patient. */
  @Post()
  @RequirePermissions(CLINICAL_PERMISSIONS.create)
  async create(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalEncounterResponse> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = parseClinicalInput(createEncounterBody, body, "Invalid clinical encounter body.");
    return this.clinical.createEncounter(patientId, input);
  }

  /** Reads one encounter; a cross-tenant UUID is indistinguishable from absent. */
  @Get(":id")
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<ClinicalEncounterResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid clinical encounter id."
    );
    return this.clinical.getEncounter(patientId, id);
  }

  /** Version-guarded DRAFT autosave; a stale version persists nothing (409). */
  @Put(":id")
  @RequirePermissions(CLINICAL_PERMISSIONS.update)
  async updateDraft(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalEncounterResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid clinical encounter id."
    );
    const input = parseClinicalInput(updateDraftBody, body, "Invalid clinical autosave body.");
    return this.clinical.updateDraft(patientId, id, input);
  }

  /** Explicit, audited, version-guarded DRAFT -> CLOSED transition. */
  @Post(":id/close")
  @RequirePermissions(CLINICAL_PERMISSIONS.close)
  async close(@Param() params: unknown, @Body() body: unknown): Promise<ClinicalEncounterResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid clinical encounter id."
    );
    const input = parseClinicalInput(closeEncounterBody, body, "Invalid clinical close body.");
    return this.clinical.closeEncounter(patientId, id, input);
  }

  /** Creates a linked, audited amendment that preserves the original state. */
  @Post(":id/amendments")
  @RequirePermissions(CLINICAL_PERMISSIONS.amend)
  async amend(@Param() params: unknown, @Body() body: unknown): Promise<ClinicalEncounterResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalEncounterParam,
      params,
      "Invalid clinical encounter id."
    );
    const input = parseClinicalInput(amendEncounterBody, body, "Invalid clinical amendment body.");
    return this.clinical.amendEncounter(patientId, id, input);
  }
}
