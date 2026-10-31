import { Body, Controller, Get, Header, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { parseClinicalInput, clinicalRecordParam, clinicalPatientParam } from "./clinical.zod.js";
import { ClinicalHistoryService, historyKind, historySearch } from "./clinical-history.service.js";
const paramsSchema = clinicalRecordParam.extend({ kind: historyKind });

@Controller("patients/:patientId/clinical")
export class ClinicalHistoryController {
  constructor(private readonly history: ClinicalHistoryService) {}
  @Get("history-access")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("vet.clinical.read")
  async access(@Param() params: unknown) {
    const { patientId } = parseClinicalInput(clinicalPatientParam, params, "Invalid patient id.");
    return this.history.access(patientId);
  }
  /** Read-only POST: no clinical history/cursor content in URL or browser storage. */
  @Post(":kind/:id/history/search")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("vet.clinical.read", "vet.clinical.history_read")
  async search(@Param() params: unknown, @Body() body: unknown) {
    const { patientId, id, kind } = parseClinicalInput(
      paramsSchema,
      params,
      "Invalid history path."
    );
    const input: z.infer<typeof historySearch> = parseClinicalInput(
      historySearch,
      body,
      "Invalid history search."
    );
    return this.history.search(patientId, id, kind, input);
  }
}
