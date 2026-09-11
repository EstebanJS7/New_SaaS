import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import {
  createGuardianBody,
  patientGuardianParam,
  patientGuardiansParam,
  updateGuardianBody,
} from "./patient.zod.js";
import { PATIENT_PERMISSIONS } from "./patients.permissions.js";
import { PatientsService } from "./patients.service.js";
import type { PatientGuardianResponse } from "./patient.dto.js";

/**
 * Private tenant-scoped PatientGuardian surface (WU3.4).
 *
 * Guardians live under their Patient and link the Veterinary aggregate to a
 * Core Customer. Reads declare `patients.read`; mutations declare
 * `patients.guardian.manage`. The tenant is resolved exclusively server-side
 * from the active request context, and the service re-applies the `veterinary`
 * entitlement gate (no generic feature guard). Inputs are Zod-validated before
 * reaching the service and responses are allowlisted DTOs only. A foreign
 * Patient, guardian, or Customer UUID is masked as a byte-equivalent 404.
 */
@Controller("patients/:patientId/guardians")
export class PatientGuardiansController {
  constructor(private readonly patients: PatientsService) {}

  /** Lists the active guardians of a Patient; a foreign Patient returns 404. */
  @Get()
  @RequirePermissions(PATIENT_PERMISSIONS.read)
  async list(@Param() params: unknown): Promise<PatientGuardianResponse[]> {
    const parsed = patientGuardiansParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient id.");
    }
    return this.patients.listGuardians(parsed.data.patientId);
  }

  /**
   * Gets a single guardian by id. A foreign Patient or guardian UUID is masked
   * as 404, never leaked as 403.
   */
  @Get(":id")
  @RequirePermissions(PATIENT_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<PatientGuardianResponse> {
    const parsed = patientGuardianParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient or guardian id.");
    }
    return this.patients.getGuardian(parsed.data.id, parsed.data.patientId);
  }

  /**
   * Links a Core Customer as a guardian. A foreign Customer resolves to 404 and
   * persists nothing; a request marked `isPrimary` demotes the current primary
   * before promoting the link in the same transaction.
   */
  @Post()
  @RequirePermissions(PATIENT_PERMISSIONS.guardianManage)
  async create(@Param() params: unknown, @Body() body: unknown): Promise<PatientGuardianResponse> {
    const parsedParams = patientGuardiansParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient id.");
    }
    const parsedBody = createGuardianBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid guardian create body.");
    }
    return this.patients.createGuardian(parsedParams.data.patientId, parsedBody.data);
  }

  /**
   * Updates a guardian's ordering or primary status. Demoting the sole primary
   * of an active Patient is a 409; the write and its audit row co-commit.
   */
  @Put(":id")
  @RequirePermissions(PATIENT_PERMISSIONS.guardianManage)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<PatientGuardianResponse> {
    const parsedParams = patientGuardianParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient or guardian id.");
    }
    const parsedBody = updateGuardianBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid guardian update body.");
    }
    return this.patients.updateGuardian(
      parsedParams.data.id,
      parsedParams.data.patientId,
      parsedBody.data
    );
  }

  /**
   * Promotes a guardian to active primary in one transaction that demotes the
   * current primary first; a repeat is a no-op that audits nothing.
   */
  @Post(":id/primary")
  @RequirePermissions(PATIENT_PERMISSIONS.guardianManage)
  async setPrimary(@Param() params: unknown): Promise<PatientGuardianResponse> {
    const parsed = patientGuardianParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient or guardian id.");
    }
    return this.patients.setPrimaryGuardian(parsed.data.id, parsed.data.patientId);
  }

  /** Idempotently deactivates a guardian link; no hard delete exists. */
  @Post(":id/deactivate")
  @RequirePermissions(PATIENT_PERMISSIONS.guardianManage)
  async deactivate(@Param() params: unknown): Promise<PatientGuardianResponse> {
    const parsed = patientGuardianParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient or guardian id.");
    }
    return this.patients.deactivateGuardian(parsed.data.id, parsed.data.patientId);
  }
}
