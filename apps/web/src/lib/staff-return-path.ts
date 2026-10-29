/** Only existing staff routes and allowlisted UUID context can survive sign-in. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sections = new Set([
  "agenda",
  "patients",
  "customers",
  "sales",
  "catalog",
  "suppliers",
  "purchases",
  "cash",
  "billing",
  "fiscal",
  "reports",
  "imports",
  "notifications",
  "settings",
]);
export function safeStaffReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1500 ||
    !/^\/app(?:[/?#]|$)/.test(value) ||
    Array.from(value.split("?")[0] ?? "").some(
      (char) => char.charCodeAt(0) <= 32 || char === "\\" || char === "%"
    )
  )
    return "/app";
  try {
    const url = new URL(value, "https://staff.invalid");
    if (url.pathname === "/app/sales/history") return url.pathname;
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments[0] !== "app" ||
      segments.length > 3 ||
      (segments[1] && !sections.has(segments[1])) ||
      (segments[2] && !UUID.test(segments[2]) && segments[2] !== "new")
    )
      return "/app";
    const query = new URLSearchParams();
    const keys =
      segments[1] === "patients"
        ? ["appointment", "encounter"]
        : segments[1] === "sales"
          ? ["appointment", "patient", "encounter"]
          : [];
    for (const key of keys) {
      const entries = url.searchParams.getAll(key);
      if (entries.length === 1 && UUID.test(entries[0])) query.set(key, entries[0]);
    }
    return (
      url.pathname +
      (query.size ? `?${query}` : "") +
      (url.hash === "#patient-clinical" ? url.hash : "")
    );
  } catch {
    return "/app";
  }
}
export function staffSignInPath(target: unknown): string {
  const path = safeStaffReturnPath(target);
  return path === "/app"
    ? "/login"
    : `/login?returnTo=${encodeURIComponent(path)}&reason=session-expired`;
}
