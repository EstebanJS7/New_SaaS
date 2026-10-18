import type { JSX } from "react";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * The public reset page ([[TD-048]]) — the destination the recovery email's link points
 * at, and the FIRST unauthenticated page in this app.
 *
 * It is deliberately outside the `(app)` route group: that group renders the staff shell
 * (sidebar, topbar, tenant branding resolved from the session), and a locked-out user has
 * no session to render it from. The root layout still applies, so the product's design
 * tokens and appearance bootstrap are in effect.
 *
 * `searchParams` is read on the server and the token is handed to the client component as
 * a prop: the token is part of the first render rather than something the browser has to
 * find, and it is never written to a log, storage or a second URL.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const raw = params.token;
  // A repeated `?token=` yields an array; the first one is the one the link carried, and
  // an absent or empty one is handled by the form's own state.
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
