import type { JSX } from "react";
import { LoginForm } from "./login-form";

/**
 * The staff sign-in page ([[SHEL-001]]) — the app's front door, and the reason this Story
 * exists: until it, nobody could establish a session from a browser, because the session
 * cookie is `HttpOnly` and no page set it.
 *
 * It is outside the `(app)` route group, which is the shell that fetches tenant-scoped data
 * from a session a visitor does not have yet. It renders under the ROOT layout, so it still
 * carries the product's resolved brand — the same public layer a signed-out surface is
 * allowed to see, and no tenant-scoped read.
 */
export default function LoginPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </main>
  );
}
