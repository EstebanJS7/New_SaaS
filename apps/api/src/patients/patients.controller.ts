import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { createPatientBody, patientIdParam, updatePatientBody } from "./patient.zod.js";
import { PATIENT_PERMISSIONS } from "./patients.permissions.js";
import { PatientsCatalogService } from "./patients.catalog.service.js";
import { PatientsService } from "./patients.service.js";
import type { PatientResponse, SpeciesCatalogEntry } from "./patient.dto.js";

/**
 * Private tenant-scoped Patient surface.
 *
 * Reads shipped in WU3.2 and the Patient commands in WU3.3 share this one
 * controller; guardian routes land in WU3.4. Every route resolves the tenant
 * exclusively server-side from the active request context and declares the
 * matching `patients.*` permission; the `veterinary` entitlement is enforced by
 * the services. Inputs are Zod-validated before reaching the service and
 * responses are allowlisted DTOs only.
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

  /**
   * Creates a Patient. An active Patient (the default) REQUIRES
   * `primaryGuardianCustomerId` and writes the Patient plus its active primary
   * guardian in one transaction; a foreign Customer resolves to 404 and
   * persists nothing.
   */
  @Post()
  @RequirePermissions(PATIENT_PERMISSIONS.create)
  async create(@Body() body: unknown): Promise<PatientResponse> {
    const parsed = createPatientBody.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient create body.");
    }
    return this.patients.create(parsed.data);
  }

  /**
   * Updates a Patient. Activating an inactive Patient establishes exactly one
   * active primary guardian in the same transaction (or returns 409 when none
   * is available); cross-tenant UUIDs return 404.
   */
  @Put(":id")
  @RequirePermissions(PATIENT_PERMISSIONS.update)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<PatientResponse> {
    const parsedParams = patientIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient id.");
    }
    const parsedBody = updatePatientBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient update body.");
    }
    return this.patients.update(parsedParams.data.id, parsedBody.data);
  }

  /** Idempotently deactivates a Patient; no hard delete exists. */
  @Post(":id/deactivate")
  @RequirePermissions(PATIENT_PERMISSIONS.deactivate)
  async deactivate(@Param() params: unknown): Promise<PatientResponse> {
    const parsedParams = patientIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid patient id.");
    }
    return this.patients.deactivate(parsedParams.data.id);
  }
}
