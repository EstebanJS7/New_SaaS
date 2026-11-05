import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { BRANCH_PERMISSIONS } from "./branches.permissions.js";
import {
  BranchesService,
  type BranchView,
  type FiscalEstablishmentOption,
  type MembershipBranchesView,
} from "./branches.service.js";
import {
  assignBranchesBody,
  branchIdParam,
  createBranchBody,
  membershipIdParam,
  updateBranchBody,
} from "./branches.zod.js";

/**
 * MB-001 / DEC-094 — the branch registry. Unprefixed per DEC-002. There is no
 * delete route: a branch is deactivated, never deleted (and the database
 * refuses a DELETE).
 */
@Controller("branches")
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /**
   * MB-002: the list carries the clinic's fiscal establishments too, so the
   * edit form can link a branch to its issuance point without a second call.
   */
  @Get()
  @RequirePermissions(BRANCH_PERMISSIONS.manage)
  async list(): Promise<{ branches: BranchView[]; establishments: FiscalEstablishmentOption[] }> {
    const [branches, establishments] = await Promise.all([
      this.branches.list(),
      this.branches.listEstablishments(),
    ]);
    return { branches, establishments };
  }

  @Post()
  @RequirePermissions(BRANCH_PERMISSIONS.manage)
  async create(@Body() body: unknown): Promise<{ branch: BranchView }> {
    const input = parseInput(createBranchBody, body, "Datos de sucursal inválidos.");
    return { branch: await this.branches.create(input) };
  }

  @Put(":id")
  @RequirePermissions(BRANCH_PERMISSIONS.manage)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<{ branch: BranchView }> {
    const { id } = parseInput(branchIdParam, params, "Sucursal inválida.");
    const input = parseInput(updateBranchBody, body, "Datos de sucursal inválidos.");
    return { branch: await this.branches.update(id, input) };
  }

  @Post(":id/deactivate")
  @RequirePermissions(BRANCH_PERMISSIONS.manage)
  async deactivate(@Param() params: unknown): Promise<{ branch: BranchView }> {
    const { id } = parseInput(branchIdParam, params, "Sucursal inválida.");
    return { branch: await this.branches.deactivate(id) };
  }

  @Post(":id/reactivate")
  @RequirePermissions(BRANCH_PERMISSIONS.manage)
  async reactivate(@Param() params: unknown): Promise<{ branch: BranchView }> {
    const { id } = parseInput(branchIdParam, params, "Sucursal inválida.");
    return { branch: await this.branches.reactivate(id) };
  }
}

/**
 * MB-001: where a staff member works. Lives beside the branch registry because
 * it shares its permission and its locks; the path stays under `/memberships`
 * because the membership is the thing being changed.
 */
@Controller("memberships")
export class MembershipBranchesController {
  constructor(private readonly branches: BranchesService) {}

  /**
   * MB-002: the active branches the CALLER works at. Authenticated-only, like
   * `/memberships/me/permissions`: the counter and the cash screen need it for
   * every role that sells, and it reveals only the caller's own workplaces.
   */
  @Get("me/branches")
  @RequirePermissions()
  async mine(): Promise<{ branches: { id: string; name: string }[] }> {
    return { branches: await this.branches.listMine() };
  }

  @Put(":id/branches")
  @RequirePermissions(BRANCH_PERMISSIONS.manage)
  async assign(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<{ assignment: MembershipBranchesView }> {
    const { id } = parseInput(membershipIdParam, params, "Miembro inválido.");
    const { branchIds } = parseInput(assignBranchesBody, body, "Sucursales inválidas.");
    return { assignment: await this.branches.assignMembershipBranches(id, branchIds) };
  }
}

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
function parseInput<T>(
  schema: { safeParse: (value: unknown) => SafeParseReturnType<unknown, T> },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_FAILED", message);
  return parsed.data;
}
