import type { JSX } from "react";
import { PortalForgotPasswordForm } from "./portal-forgot-password-form";

interface PortalForgotPasswordPageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

/**
 * The portal's recovery REQUEST page ([[PORTAL-002]]) — the entry point the portal's flow lacked, so a
 * customer could only reach a reset page by receiving a message nobody could ask for.
 *
 * Public, inside the ANONYMOUS portal layout (which resolves the tenant's brand from the slug and
 * reads no session), so a locked-out visitor can reach it without a redirect loop.
 */
export default async function PortalForgotPasswordPage({
  params,
}: PortalForgotPasswordPageProps): Promise<JSX.Element> {
  const { slug } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <PortalForgotPasswordForm tenantSlug={slug} />
      </div>
    </main>
  );
}
