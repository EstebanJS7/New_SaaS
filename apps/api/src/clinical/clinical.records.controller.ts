import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import type {
  ClinicalDewormingResponse,
  ClinicalStudyResponse,
  ClinicalTreatmentResponse,
  ClinicalVaccinationResponse,
  ClinicalWeightResponse,
} from "./clinical.records.dto.js";
import { ClinicalRecordsService } from "./clinical.records.service.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";
import {
  clinicalPatientParam,
  clinicalRecordParam,
  createDewormingBody,
  createStudyBody,
  createTreatmentBody,
  createVaccinationBody,
  createWeightBody,
  parseClinicalInput,
  updateDewormingBody,
  updateStudyBody,
  updateTreatmentBody,
  updateVaccinationBody,
  updateWeightBody,
} from "./clinical.zod.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";

/**
 * Clinical specialized-record surface (EPIC-06 WU3): treatments, vaccinations,
 * deworming, studies and weights, nested under the Patient.
 *
 * Reads require `vet.clinical.read`, creation `vet.clinical.create` and updates
 * `vet.clinical.update`; the service re-checks the same key plus the
 * `veterinary` entitlement. There is no hard-delete route. Bodies are
 * Zod-validated before the service and responses are allowlisted DTOs; tenant
 * identity comes only from `RequestContextService`.
 */
@Controller("patients/:patientId/clinical")
export class ClinicalRecordsController {
  constructor(private readonly records: ClinicalRecordsService) {}

  // -------------------------------------------------------------------------
  // Treatments
  // -------------------------------------------------------------------------

  @Get("treatments")
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async listTreatments(@Param() params: unknown): Promise<ClinicalTreatmentResponse[]> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.records.listTreatments(patientId);
  }

  @Post("treatments")
  @RequirePermissions(CLINICAL_PERMISSIONS.create)
  async createTreatment(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalTreatmentResponse> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = parseClinicalInput(createTreatmentBody, body, "Invalid treatment body.");
    return this.records.createTreatment(patientId, input);
  }

  @Put("treatments/:id")
  @RequirePermissions(CLINICAL_PERMISSIONS.update)
  async updateTreatment(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalTreatmentResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalRecordParam,
      params,
      "Invalid clinical record id."
    );
    const input = parseClinicalInput(updateTreatmentBody, body, "Invalid treatment update body.");
    return this.records.updateTreatment(patientId, id, input);
  }

  // -------------------------------------------------------------------------
  // Vaccinations
  // -------------------------------------------------------------------------

  @Get("vaccinations")
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async listVaccinations(@Param() params: unknown): Promise<ClinicalVaccinationResponse[]> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.records.listVaccinations(patientId);
  }

  @Post("vaccinations")
  @RequirePermissions(CLINICAL_PERMISSIONS.create)
  async createVaccination(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalVaccinationResponse> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = parseClinicalInput(createVaccinationBody, body, "Invalid vaccination body.");
    return this.records.createVaccination(patientId, input);
  }

  @Put("vaccinations/:id")
  @RequirePermissions(CLINICAL_PERMISSIONS.update)
  async updateVaccination(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalVaccinationResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalRecordParam,
      params,
      "Invalid clinical record id."
    );
    const input = parseClinicalInput(
      updateVaccinationBody,
      body,
      "Invalid vaccination update body."
    );
    return this.records.updateVaccination(patientId, id, input);
  }

  // -------------------------------------------------------------------------
  // Deworming
  // -------------------------------------------------------------------------

  @Get("deworming")
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async listDewormings(@Param() params: unknown): Promise<ClinicalDewormingResponse[]> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.records.listDewormings(patientId);
  }

  @Post("deworming")
  @RequirePermissions(CLINICAL_PERMISSIONS.create)
  async createDeworming(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalDewormingResponse> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = parseClinicalInput(createDewormingBody, body, "Invalid deworming body.");
    return this.records.createDeworming(patientId, input);
  }

  @Put("deworming/:id")
  @RequirePermissions(CLINICAL_PERMISSIONS.update)
  async updateDeworming(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalDewormingResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalRecordParam,
      params,
      "Invalid clinical record id."
    );
    const input = parseClinicalInput(updateDewormingBody, body, "Invalid deworming update body.");
    return this.records.updateDeworming(patientId, id, input);
  }

  // -------------------------------------------------------------------------
  // Studies
  // -------------------------------------------------------------------------

  @Get("studies")
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async listStudies(@Param() params: unknown): Promise<ClinicalStudyResponse[]> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.records.listStudies(patientId);
  }

  @Post("studies")
  @RequirePermissions(CLINICAL_PERMISSIONS.create)
  async createStudy(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalStudyResponse> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = parseClinicalInput(createStudyBody, body, "Invalid study body.");
    return this.records.createStudy(patientId, input);
  }

  @Put("studies/:id")
  @RequirePermissions(CLINICAL_PERMISSIONS.update)
  async updateStudy(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalStudyResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalRecordParam,
      params,
      "Invalid clinical record id."
    );
    const input = parseClinicalInput(updateStudyBody, body, "Invalid study update body.");
    return this.records.updateStudy(patientId, id, input);
  }

  // -------------------------------------------------------------------------
  // Weights
  // -------------------------------------------------------------------------

  @Get("weights")
  @RequirePermissions(CLINICAL_PERMISSIONS.read)
  async listWeights(@Param() params: unknown): Promise<ClinicalWeightResponse[]> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.records.listWeights(patientId);
  }

  @Post("weights")
  @RequirePermissions(CLINICAL_PERMISSIONS.create)
  async createWeight(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalWeightResponse> {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    const input = parseClinicalInput(createWeightBody, body, "Invalid weight body.");
    return this.records.createWeight(patientId, input);
  }

  @Put("weights/:id")
  @RequirePermissions(CLINICAL_PERMISSIONS.update)
  async updateWeight(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<ClinicalWeightResponse> {
    const { patientId, id } = parseClinicalInput(
      clinicalRecordParam,
      params,
      "Invalid clinical record id."
    );
    const input = parseClinicalInput(updateWeightBody, body, "Invalid weight update body.");
    return this.records.updateWeight(patientId, id, input);
  }
}
