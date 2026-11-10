import { describe, expect, it } from "vitest";
import { resolveMembershipsPath } from "./memberships-proxy-path";

const ID = "11111111-1111-4111-8111-111111111111";

describe("resolveMembershipsPath (ONB-001) — an allowlist, not a catch-all", () => {
  it.each([
    ["GET", "/api/memberships/directory", "/memberships/directory"],
    ["GET", "/api/memberships/me/branches", "/memberships/me/branches"],
    // UX-037: the caller's own permissions and its clinic's features.
    ["GET", "/api/memberships/me/capabilities", "/memberships/me/capabilities"],
    ["POST", "/api/memberships/invitations", "/memberships/invitations"],
    ["POST", `/api/memberships/${ID}/activation`, `/memberships/${ID}/activation`],
    ["POST", `/api/memberships/${ID}/suspend`, `/memberships/${ID}/suspend`],
    ["POST", `/api/memberships/${ID}/reactivate`, `/memberships/${ID}/reactivate`],
    ["POST", `/api/memberships/${ID}/role`, `/memberships/${ID}/role`],
    ["PUT", `/api/memberships/${ID}/branches`, `/memberships/${ID}/branches`],
  ] as const)("%s %s -> %s", (method, path, upstream) => {
    expect(resolveMembershipsPath(path, method)).toBe(upstream);
  });

  it.each([
    ["GET", "/api/memberships"],
    ["GET", `/api/memberships/${ID}`],
    ["GET", "/api/memberships/me/permissions"],
    ["GET", "/api/memberships/me/capabilities/extra"],
    ["GET", "/api/memberships/me"],
    ["POST", "/api/memberships/me/capabilities"],
    ["PUT", "/api/memberships/me/capabilities"],
    ["POST", "/api/memberships/directory"],
    ["POST", `/api/memberships/not-a-uuid/suspend`],
    ["POST", `/api/memberships/${ID}/delete`],
    ["POST", `/api/memberships/${ID}/suspend/extra`],
    ["POST", "/api/memberships/%2e%2e/admin"],
    ["POST", `/api/memberships/${ID}/branches`],
    ["PUT", `/api/memberships/${ID}/role`],
    ["PUT", `/api/memberships/not-a-uuid/branches`],
  ] as const)("refuses %s %s", (method, path) => {
    expect(resolveMembershipsPath(path, method)).toBeNull();
  });
});
