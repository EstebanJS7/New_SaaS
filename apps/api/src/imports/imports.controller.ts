import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { FastifyRequest } from "fastify";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { ImportArtefactPipe } from "./import-artefact.pipe.js";
import type { ImportJobResponse, ImportUploadResponse } from "./imports.dto.js";
import { IMPORTS_PERMISSIONS } from "./imports.permissions.js";
import { ImportsService } from "./imports.service.js";
import {
  IMPORT_ID_INVALID_MESSAGE,
  IMPORT_LIST_LIMIT_DEFAULT,
  IMPORT_LIST_QUERY_INVALID_MESSAGE,
  importIdParam,
  importListQuery,
} from "./imports.zod.js";

/**
 * Private tenant-scoped imports surface (EPIC-19 IMP-001).
 *
 * Routes are unprefixed (`/imports`, not `/api/v1/imports`) per DEC-002, and the
 * surface is EXACTLY three routes: the multipart upload, the bounded list and the
 * single read. There is deliberately NO `PATCH`, no `PUT` and no `DELETE`, and no
 * route that accepts a state: the lifecycle is server-owned and every transition
 * is an explicit command on the service. The `imports.*` permission is the whole
 * guard — [[DEC-072]] refused a feature code for this surface — and the service
 * re-asserts it as defense in depth.
 *
 * The upload reads the multipart request through {@link ImportArtefactPipe}, so
 * the size cap, the CSV allowlist and the by-name refusal of a spreadsheet all
 * happen BEFORE the service generates a storage key or touches storage.
 */
@Controller("imports")
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly artefactPipe: ImportArtefactPipe
  ) {}

  /**
   * Uploads one CSV artefact and creates the import job, returning
   * `{ importId, state }`.
   *
   * The storage key is NOT in the response and never will be: the caller gets an
   * identifier to poll ([[DEC-072]] made every import asynchronous), not a handle
   * to a tenant's customer list.
   */
  @Post()
  @HttpCode(201)
  @RequirePermissions(IMPORTS_PERMISSIONS.run)
  async upload(@Req() request: FastifyRequest): Promise<ImportUploadResponse> {
    const artefact = await this.artefactPipe.parse(request);
    return this.imports.upload(artefact);
  }

  /**
   * The caller tenant's imports, newest first, as a BOUNDED page.
   *
   * `?limit=` is optional and capped at the contract's ceiling; a larger value is
   * REFUSED rather than truncated, because a silently shortened page is a page
   * that lies about what exists ([[TD-026]]).
   */
  @Get()
  @RequirePermissions(IMPORTS_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<ImportJobResponse[]> {
    const parsed = parseInput(importListQuery, query, IMPORT_LIST_QUERY_INVALID_MESSAGE);
    return this.imports.list(parsed.limit ?? IMPORT_LIST_LIMIT_DEFAULT);
  }

  /**
   * One import with its counters. A foreign import id is the shared byte-equivalent
   * `404`: the tenant predicate rides in the same query, so the answer for another
   * tenant's import and for an id that never existed is the same body.
   */
  @Get(":id")
  @RequirePermissions(IMPORTS_PERMISSIONS.read)
  async getById(@Param() params: unknown): Promise<ImportJobResponse> {
    const { id } = parseInput(importIdParam, params, IMPORT_ID_INVALID_MESSAGE);
    return this.imports.getById(id);
  }
}

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
function parseInput<T>(
  schema: { safeParse: (value: unknown) => SafeParseReturnType<unknown, T> },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", message);
  }
  return parsed.data;
}
