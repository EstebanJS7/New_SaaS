import type { JSX, ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * The portal's gate ([[PORTAL-001]]).
 *
 * Everything whose data belongs to ONE customer lives in this route group, so the check
 * happens once — in a server layout — instead of in each page or, worse, in the browser. A
 * route group does not change the URL, so `/[slug]/pets` is still `/[slug]/pets`; what changed
 * is that it now has a parent that can refuse to render.
 *
 * **It verifies the session rather than looking for a cookie.** The cookie is `HttpOnly`, so a
 * server layout can read it, but "a cookie exists" is not "a session is live": it may have been
 * revoked, expired, or never been real. The check is `GET /portal/me`, the portal's own identity
 * probe, and the honest answer for a 401 is the sign-in page.
 *
 * **Only a 401 redirects.** A 500, a timeout or a network failure renders the children and lets
 * their own reads fail visibly: treating an outage as "signed out" would send every signed-in
 * customer to the login page the moment the API has a bad minute, which is the same asymmetry
 * the staff shell's gate chose for the same reason.
 *
 * The tenant comes from the path, so the redirect target is `/[slug]/login` — the page a
 * customer of THIS clinic signs in at, not a shared one.
 */
async function hasLivePortalSession(): Promise<boolean | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
  // No cookie at all is a settled answer rather than a failed read: there is nothing to verify.
  if (token === undefined || token.length === 0) return false;

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const response = await fetch(`${apiUrl}/portal/me`, {
      headers: { cookie: `${PORTAL_SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
    if (response.status === 401) return false;
    // Anything else — `200`, but also a 500 or a body we cannot read — lets the page render.
    return true;
  } catch {
    return null;
  }
}

export default async function PortalProtectedLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug?: string }> | { slug?: string };
}): Promise<JSX.Element> {
  const { slug } = await params;
  const live = await hasLivePortalSession();
  if (live === false && slug !== undefined) {
    redirect(`/${slug}/login`);
  }

  return <>{children}</>;
}
