const PREFIX = "/api/memberships";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBERSHIP_COMMANDS: readonly string[] = ["activation", "suspend", "reactivate", "role"];

/**
 * Proxies the staff team surface ([[ONB-001]]) to the private memberships API,
 * including MB-001's `PUT /:id/branches`.
 *
 * Unlike the older catch-all proxies, the path is ALLOWLISTED: the team page needs the
 * directory read, the invitation command and four per-membership commands, and a
 * proxy that forwarded anything under `/memberships` would expose whatever that
 * controller grows next without anyone deciding the browser should reach it. The API
 * stays the authority for permissions and tenant ownership either way.
 *
 * Bodies are forwarded as text (TD-050's one decision for every BFF).
 */
export function resolveMembershipsPath(
  pathname: string,
  method: "GET" | "POST" | "PUT"
): string | null {
  const remainder = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : "";
  if (remainder.includes("%")) return null;
  const segments = remainder.split("/").filter((segment) => segment.length > 0);

  if (method === "GET") {
    if (segments.length === 1 && segments[0] === "directory") return "/memberships/directory";
    // MB-002: the caller's own working branches (counter and cash screen).
    if (segments.length === 2 && segments[0] === "me" && segments[1] === "branches") {
      return "/memberships/me/branches";
    }
    // UX-037: the caller's own permissions and its clinic's features. `me/permissions`
    // stays refused: the capabilities read is the one the browser needs.
    if (segments.length === 2 && segments[0] === "me" && segments[1] === "capabilities") {
      return "/memberships/me/capabilities";
    }
    return null;
  }
  if (method === "PUT") {
    // MB-001 (DEC-094 §5): replacing where a person works is the one PUT.
    return segments.length === 2 && UUID.test(segments[0] ?? "") && segments[1] === "branches"
      ? `/memberships/${segments[0]}/branches`
      : null;
  }
  if (segments.length === 1 && segments[0] === "invitations") return "/memberships/invitations";
  if (
    segments.length === 2 &&
    UUID.test(segments[0] ?? "") &&
    MEMBERSHIP_COMMANDS.includes(segments[1] ?? "")
  ) {
    return `/memberships/${segments[0]}/${segments[1]}`;
  }
  return null;
}
