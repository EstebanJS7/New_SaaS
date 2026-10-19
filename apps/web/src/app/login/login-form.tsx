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
import { ApiRequestError, signIn } from "./login-api";

/**
 * The sign-in form ([[SHEL-001]]).
 *
 * Two things about it are decisions rather than styling.
 *
 * **The failure the user sees is the API's, verbatim.** Unknown address and wrong password
 * produce ONE message from the API, and this form does not add a second distinction: a UI
 * that guessed which was which would be a louder account-existence oracle than the API it
 * fronts.
 *
 * **The password is cleared on a failed attempt and never leaves the field's state.** It is
 * not in the URL, not in storage, and not in the error message — and the failure branch sets
 * only the message, so an error object cannot carry it by accident.
 */
export function LoginForm(): JSX.Element {
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
      await signIn({ email, password });
      // The session cookie is set by the API and relayed by the BFF; this page cannot see
      // it and does not need to. A full navigation (`refresh`) re-runs the shell's layout
      // with the new cookie, which a client-side push would not.
      router.replace("/app");
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
        <CardDescription>Use your staff account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          A real `<form>`, and the reason is a defect this lane found: with the inputs in a plain
          container and the button as `type="button"`, pressing Enter did NOTHING. Every user's muscle
          memory — and every password manager — submits a sign-in by keyboard, and the page looked and
          behaved correctly right up to that moment.
        */}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="login-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="login-password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {problem === null ? null : (
            <p data-testid="login-problem" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
            {/*
            The recovery entry point ([[DAT-007]]). Until this link existed, a user could
            only reach the reset page by receiving a message nobody could ask for.
          */}
            <Link
              href="/forgot-password"
              data-testid="login-forgot-password"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
