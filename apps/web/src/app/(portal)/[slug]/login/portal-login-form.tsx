"use client";

import type { JSX } from "react";
import { useState } from "react";
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
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            void submit();
          }}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
        {/*
          Deliberately NO recovery link: the API's recovery authorises a `UserCredential`
          change and a portal identity holds a `PortalCredential`, so there is nothing to
          link to. A link to the staff flow would send a customer into a page that cannot
          help them, which is worse than the absence ([[PORTAL-001]]'s largest named gap).
        */}
      </CardContent>
    </Card>
  );
}
