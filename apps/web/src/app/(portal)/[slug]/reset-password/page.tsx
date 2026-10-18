import type { JSX } from "react";
import { PortalResetPasswordForm } from "./portal-reset-password-form";

interface PortalResetPasswordPageProps {
  params: Promise<{ slug: string }> | { slug: string };
  searchParams: Promise<{ token?: string | string[] }>;
}

/**
 * The portal's reset page ([[PORTAL-002]]) — where the recovery message's link LANDS.
 *
 * Public, inside the anonymous portal layout, so a locked-out visitor can reach it. The token is read
 * on the SERVER and handed to the client component as a prop: it is part of the first render rather
 * than something the browser has to find, and it is never written to a log, storage or a second URL.
 */
export default async function PortalResetPasswordPage({
  params,
  searchParams,
}: PortalResetPasswordPageProps): Promise<JSX.Element> {
  const { slug } = await params;
  const query = await searchParams;
  const raw = query.token;
  // A repeated `?token=` yields an array; the first one is the one the link carried.
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <PortalResetPasswordForm tenantSlug={slug} token={token} />
      </div>
    </main>
  );
}
