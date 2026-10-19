/**
 * The demo fixtures this lane signs in as.
 *
 * The values come from the demo seed (`@newsaas/database`'s `demo-seed.ts`), which is the source of
 * truth for them; they are written here rather than imported because the seed is a SCRIPT and not part
 * of that package's public surface. If the seed changes a value, this lane fails loudly at the first
 * sign-in rather than silently testing a different tenant.
 */
export const DEMO = {
  tenantSlug: "demo",
  staffEmail: "owner@demo.newsaas.test",
  staffPassword: "demo-owner-password",
  /** A customer the seed creates, used to prove a list rendered rows rather than an empty state. */
  customerName: "Ana García",
  /**
   * The demo tenant's portal holder. The seed created the access row and NO credential until the lane
   * tried to sign in there — the portal half of the demo was unusable by anyone, including a human.
   */
  portalEmail: "ana.garcia@demo.newsaas.test",
  portalPassword: "demo-portal-password",
  /** The holder's pet, as the seed names it. */
  portalPetName: "Bobby",
} as const;

/** Where the app is served. The lane drives the built app, the same way a deployment serves it. */
export const WEB_BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
