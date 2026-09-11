import { Controller, Get, Param } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { patientIdParam } from "./patient.zod.js";
import { PATIENT_PERMISSIONS } from "./patients.permissions.js";
import { PatientsCatalogService } from "./patients.catalog.service.js";
import { PatientsService } from "./patients.service.js";
import type { PatientResponse, SpeciesCatalogEntry } from "./patient.dto.js";

/**
 * Private tenant-scoped Patient READ surface (WU3.2).
 *
 * Every route resolves the tenant exclusively server-side from the active
 * request context and declares `patients.read`; the `veterinary` entitlement is
 * enforced by the services. Command routes land in WU3.3 and guardian routes in
 * WU3.4 without adding a second controller for reads.
 */
@Controller("patients")
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly catalog: PatientsCatalogService
  ) {}

  /** Lists active Patients for the current tenant. */
  @Get()
  @RequirePermissions(PATIENT_PERMISSIONS.read)
  async list(): Promise<PatientResponse[]> {
    return this.patients.list();
  }

  /**
   * Returns the GLOBAL Species/Breed catalog. Declared BEFORE `:id` so the
   * static segment can never be captured as a Patient id.
   */
  @Get("catalog")
  @RequirePermissions(PATIENT_PERMISSIONS.read)
  async catalogList(): Promise<SpeciesCatalogEntry[]> {
    return this.catalog.list();
  }

  /** Gets a single Patient by UUID; cross-tenant access returns 404. */
  @Get(":id")
  @RequirePermissions(PATIENT_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<PatientResponse> {
    const parsed = patientIdParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient id.");
    }
    return this.patients.get(parsed.data.id);
  }
}
