import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { TenantSettingsService } from "./tenant-settings.service.js";

const namespaceParam = z.string().min(1).max(64);
const settingsPatchBody = z.record(z.unknown());

interface SettingsResponse {
  readonly settings: Record<string, unknown>;
}

/** HTTP DTO boundary for the typed tenant-settings service. */
@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: TenantSettingsService) {}

  /** Reads require authentication and active tenancy, but no feature grant. */
  @Get(":namespace")
  @RequirePermissions()
  async get(@Param("namespace") namespace: string): Promise<SettingsResponse> {
    const parsedNamespace = namespaceParam.safeParse(namespace);
    if (!parsedNamespace.success) {
      throw parsedNamespace.error;
    }
    return { settings: await this.settings.get(parsedNamespace.data) };
  }

  /** Writes require the v1 sales settings permission plus the feature grant. */
  @Put(":namespace")
  @RequirePermissions("sales.settings.manage")
  async update(
    @Param("namespace") namespace: string,
    @Body() body: unknown
  ): Promise<SettingsResponse> {
    const parsedNamespace = namespaceParam.safeParse(namespace);
    if (!parsedNamespace.success) {
      throw parsedNamespace.error;
    }
    const parsedBody = settingsPatchBody.safeParse(body);
    if (!parsedBody.success) {
      throw parsedBody.error;
    }
    return { settings: await this.settings.update(parsedNamespace.data, parsedBody.data) };
  }
}
