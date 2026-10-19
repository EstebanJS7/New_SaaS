"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { ApiRequestError, portalSignIn } from "./portal-login-api";

/**
 * The portal sign-in form ([[PORTAL-001]]).
 *
 * It shows the API's own refusal, verbatim: one message for an unknown address, a wrong
 * password and a wrong tenant alike. Distinguishing them here would be a louder oracle than
 * the API it fronts — and the tenant is not even a field, so "wrong tenant" is not something
 * this form could honestly report.
 *
 * The password is cleared on a failed attempt and never leaves the field's state.
 */
export function PortalLoginForm({ tenantSlug }: { readonly tenantSlug: string }): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function submit(): Promise<void> {
    setProblem(null);
    setSubmitting(true);
    try {
      await portalSignIn({ tenantSlug, email, password });
      // `replace` plus `refresh`, for the same reason as the staff form: the cookie is new,
      // and the portal pages are rendered from a session the server has not seen yet.
      router.replace(`/${tenantSlug}`);
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      setPassword("");
      setProblem(
        error instanceof ApiRequestError ? error.message : "Something went wrong. Try again."
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use the account your clinic gave you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          A real `<form>`, for the reason the staff form needed one: with the inputs in a plain
          container and the button as `type="button"`, pressing Enter did nothing. The lane asserts the
          keyboard path here too, so the two surfaces cannot drift apart on it again.
        */}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="portal-login-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="portal-login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="portal-login-password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="portal-login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {problem === null ? null : (
            <p data-testid="portal-login-problem" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
          {/*
          The recovery entry point, which PORTAL-001 deliberately omitted because there was no portal
          flow to link to. [[PORTAL-002]] built one: the API's recovery now authorises a
          `PortalCredential` change, and this is the only way a locked-out customer can ask for it.
        */}
          <Link
            href={`/${tenantSlug}/forgot-password`}
            data-testid="portal-login-forgot-password"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
