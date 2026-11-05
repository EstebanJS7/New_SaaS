const PREFIX = "/api/branches";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRANCH_COMMANDS: readonly string[] = ["deactivate", "reactivate"];

/**
 * MB-001 (DEC-094): the branch settings screen's routes, ALLOWLISTED like the
 * memberships proxy — the list, the create, the edit and the two activation
 * commands. Anything else is a 404 here, before the API. The API stays the
 * authority for `branches.manage` and tenant ownership.
 */
export function resolveBranchesPath(
  pathname: string,
  method: "GET" | "POST" | "PUT"
): string | null {
  const remainder = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : "";
  if (remainder.includes("%")) return null;
  const segments = remainder.split("/").filter((segment) => segment.length > 0);
  const id = segments[0] ?? "";

  if (method === "GET") return segments.length === 0 ? "/branches" : null;
  if (method === "PUT") {
    return segments.length === 1 && UUID.test(id) ? `/branches/${id}` : null;
  }
  if (segments.length === 0) return "/branches";
  if (segments.length === 2 && UUID.test(id) && BRANCH_COMMANDS.includes(segments[1] ?? "")) {
    return `/branches/${id}/${segments[1]}`;
  }
  return null;
}
