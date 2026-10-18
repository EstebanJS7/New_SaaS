import type { JSX } from "react";
import { PortalLoginForm } from "./portal-login-form";

interface PortalLoginPageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

/**
 * The portal sign-in page ([[PORTAL-001]]) — the entry point a CUSTOMER uses.
 *
 * It sits inside `(portal)/[slug]`, whose layout is deliberately ANONYMOUS: it resolves the
 * tenant's public brand from the slug and renders, with no session read at all. That is what
 * lets a login page live here without the redirect loop a session-aware layout would create,
 * and it is why this page needs no gate of its own — the surfaces that DO need a session are
 * the ones guarded, not this one.
 *
 * The tenant comes from the PATH and is handed to the form, which never asks for it.
 */
export default async function PortalLoginPage({
  params,
}: PortalLoginPageProps): Promise<JSX.Element> {
  const { slug } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <PortalLoginForm tenantSlug={slug} />
      </div>
    </main>
  );
}
