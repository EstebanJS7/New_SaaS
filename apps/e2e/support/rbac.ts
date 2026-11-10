import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * The tenant's role permissions, changed the way a clinic administrator would through the API's
 * audited override command (`PUT /rbac/roles/:code/permissions`, `users.membership.manage`). The BFF
 * does not proxy `/rbac`, so these calls go straight to the API with ONLY the staff session cookie —
 * the same identity, tenant and permission checks, no other credential.
 *
 * The lane's database is shared by every spec: a spec that overrides a role must snapshot the whole
 * `GET /rbac/roles` answer first and restore it exactly (see {@link withRolePermissions}).
 */
const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:3001";
const STAFF_SESSION_COOKIE = "ns_staff_session";

export interface RolePermissions {
  readonly code: string;
  readonly name: string;
  readonly permissions: string[];
}

/** The `cookie` header of the context's staff session, for a direct API call. */
export async function staffSessionHeader(context: BrowserContext): Promise<Record<string, string>> {
  const session = (await context.cookies()).find((c) => c.name === STAFF_SESSION_COOKIE);
  if (session === undefined) throw new Error("The signed-in context holds no staff session.");
  return { cookie: `${STAFF_SESSION_COOKIE}=${session.value}` };
}

/** Every seeded role with its EFFECTIVE permission set in the caller's tenant. */
export async function listRoles(
  request: APIRequestContext,
  headers: Record<string, string>
): Promise<RolePermissions[]> {
  const response = await request.get(`${API_BASE_URL}/rbac/roles`, { headers });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { roles: RolePermissions[] }).roles;
}

async function replaceRolePermissions(
  request: APIRequestContext,
  headers: Record<string, string>,
  code: string,
  keys: readonly string[]
): Promise<string[]> {
  const response = await request.put(`${API_BASE_URL}/rbac/roles/${code}/permissions`, {
    headers,
    data: { keys },
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { permissions: string[] }).permissions;
}

/**
 * Gives `code` its current permissions plus `extraKeys` for the duration of `body`, then writes the
 * original set back and asserts the whole `GET /rbac/roles` answer equals the snapshot taken before.
 * The override command replaces the tenant's verdicts for the role as a diff against the seeded
 * baseline, so writing the original effective set back recreates the original override rows (none,
 * for an untouched role) — the restore is exact, not approximate.
 */
export async function withRolePermissions(
  request: APIRequestContext,
  headers: Record<string, string>,
  code: string,
  extraKeys: readonly string[],
  body: () => Promise<void>
): Promise<void> {
  const snapshot = await listRoles(request, headers);
  const original = snapshot.find((role) => role.code === code);
  if (original === undefined) throw new Error(`GET /rbac/roles has no role ${code}.`);
  for (const key of extraKeys) expect(original.permissions).not.toContain(key);

  const granted = await replaceRolePermissions(request, headers, code, [
    ...original.permissions,
    ...extraKeys,
  ]);
  try {
    expect(granted).toEqual([...original.permissions, ...extraKeys].sort());
    await body();
  } finally {
    await replaceRolePermissions(request, headers, code, original.permissions);
    expect(await listRoles(request, headers)).toEqual(snapshot);
  }
}
