import type { JSX } from "react";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * The recovery REQUEST page ([[SHEL-001]]) — the entry point [[DAT-007]] left missing.
 *
 * `/reset-password` is where a recovery LINK lands; this is where one is asked for, and
 * without it the flow was complete and unreachable: a user could only arrive at the reset
 * page by receiving a message nobody could request.
 *
 * Public, outside the `(app)` shell, rendered under the root layout like its siblings.
 */
export default function ForgotPasswordPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
