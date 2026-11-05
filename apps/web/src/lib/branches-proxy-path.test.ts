import { describe, expect, it } from "vitest";
import { resolveBranchesPath } from "./branches-proxy-path";

const ID = "11111111-1111-4111-8111-111111111111";

describe("resolveBranchesPath (MB-001) — an allowlist, not a catch-all", () => {
  it.each([
    ["GET", "/api/branches", "/branches"],
    ["POST", "/api/branches", "/branches"],
    ["PUT", `/api/branches/${ID}`, `/branches/${ID}`],
    ["POST", `/api/branches/${ID}/deactivate`, `/branches/${ID}/deactivate`],
    ["POST", `/api/branches/${ID}/reactivate`, `/branches/${ID}/reactivate`],
  ] as const)("%s %s -> %s", (method, path, upstream) => {
    expect(resolveBranchesPath(path, method)).toBe(upstream);
  });

  it.each([
    ["GET", `/api/branches/${ID}`],
    ["PUT", "/api/branches"],
    ["PUT", `/api/branches/not-a-uuid`],
    ["POST", `/api/branches/${ID}`],
    ["POST", `/api/branches/${ID}/delete`],
    ["POST", `/api/branches/${ID}/deactivate/extra`],
    ["POST", "/api/branches/%2e%2e/admin"],
  ] as const)("refuses %s %s", (method, path) => {
    expect(resolveBranchesPath(path, method)).toBeNull();
  });
});
