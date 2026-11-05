const PREFIX = "/api/inventory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * MB-003 (DEC-094 §10): the stock screen's routes, ALLOWLISTED like the
 * branches proxy — the balances (optionally narrowed by `branchId`), the
 * clinic's active branches and the transfer command. Anything else is a 404
 * here, before the API; the query is rebuilt from the allowlist so it cannot
 * carry anything but a branch id. The API stays the authority for
 * `inventory.stock.*` and tenant ownership.
 */
export function resolveInventoryPath(
  pathname: string,
  search: URLSearchParams,
  method: "GET" | "POST"
): string | null {
  const remainder = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : "";
  if (remainder.includes("%")) return null;
  const path = `/${remainder
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/")}`;

  if (method === "POST") {
    return path === "/stock/transfers" && [...search.keys()].length === 0
      ? "/inventory/stock/transfers"
      : null;
  }
  if (path === "/stock/branches") {
    return [...search.keys()].length === 0 ? "/inventory/stock/branches" : null;
  }
  if (path !== "/stock") return null;
  const keys = [...search.keys()];
  if (keys.length === 0) return "/inventory/stock";
  const branchId = search.get("branchId") ?? "";
  if (keys.length !== 1 || keys[0] !== "branchId" || !UUID.test(branchId)) return null;
  return `/inventory/stock?branchId=${branchId}`;
}
