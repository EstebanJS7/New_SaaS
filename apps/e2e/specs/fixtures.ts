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
  /**
   * The staff user whose password this lane is ALLOWED to destroy. The config normally overrides the
   * address with a fresh one per run (`DEMO_RECOVERABLE_EMAIL`) — see the note there: a fixed identity
   * can receive only one recovery message an hour.
   */
  recoverableEmailFallback: "recoverable@demo.newsaas.test",
  /**
   * What the SEED gives that user. The spec asserts it stops working, which is the half that proves the
   * reset changed the credential rather than merely accepting the new password.
   */
  recoverablePassword: "demo-recoverable-password",
  /**
   * A staff user whose password this lane is ALLOWED to destroy. Recovery consumes a token and
   * rewrites a credential, so resetting the owner's password would break every other flow in the same
   * run, and restoring it afterwards would depend on the very path under test.
   */

  /** What recovery sets it to. Deliberately not the seeded value: a reset that changed nothing would
   * pass a test that only checked "signing in works". */
  recoveredPassword: "recovered-by-the-lane-password",

  /** What portal recovery sets the holder's password to, for the same reason. */
  portalRecoveredPassword: "portal-recovered-by-the-lane",
} as const;

/** Where the app is served. The lane drives the built app, the same way a deployment serves it. */
export const WEB_BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

/** The identity the recovery spec spends. Set by the config; the fallback keeps a bare run usable. */
export const RECOVERABLE_EMAIL =
  process.env.DEMO_RECOVERABLE_EMAIL ?? DEMO.recoverableEmailFallback;

/** The portal holder the recovery spec spends. Set by the config to a fresh address per run. */
export const PORTAL_HOLDER_EMAIL = process.env.DEMO_PORTAL_HOLDER_EMAIL ?? DEMO.portalEmail;
