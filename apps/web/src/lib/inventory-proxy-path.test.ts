import { describe, expect, it } from "vitest";
import { resolveInventoryPath } from "./inventory-proxy-path";

const ID = "11111111-1111-4111-8111-111111111111";

function resolve(method: "GET" | "POST", url: string): string | null {
  const parsed = new URL(url, "http://localhost");
  return resolveInventoryPath(parsed.pathname, parsed.searchParams, method);
}

describe("resolveInventoryPath (MB-003) — an allowlist, not a catch-all", () => {
  it.each([
    ["GET", "/api/inventory/stock", "/inventory/stock"],
    ["GET", `/api/inventory/stock?branchId=${ID}`, `/inventory/stock?branchId=${ID}`],
    ["GET", "/api/inventory/stock/branches", "/inventory/stock/branches"],
    ["POST", "/api/inventory/stock/transfers", "/inventory/stock/transfers"],
  ] as const)("%s %s -> %s", (method, url, upstream) => {
    expect(resolve(method, url)).toBe(upstream);
  });

  it.each([
    ["GET", "/api/inventory/stock/movements"],
    ["GET", "/api/inventory/stock?branchId=not-a-uuid"],
    ["GET", `/api/inventory/stock?branchId=${ID}&tenantId=${ID}`],
    ["GET", `/api/inventory/stock?catalogItemId=${ID}`],
    ["GET", "/api/inventory/stock/branches?x=1"],
    ["POST", "/api/inventory/stock/adjustments"],
    ["POST", "/api/inventory/stock"],
    ["POST", "/api/inventory/stock/transfers?x=1"],
    ["GET", "/api/inventory/%2e%2e/admin"],
  ] as const)("refuses %s %s", (method, url) => {
    expect(resolve(method, url)).toBeNull();
  });
});
