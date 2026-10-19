"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { ApiRequestError, requestPasswordReset } from "./forgot-password-api";

/**
 * The recovery REQUEST form ([[SHEL-001]]).
 *
 * The API answers `202` **identically** for an address that exists and one that does not, so
 * the success state must not claim a message was sent. It says what is true: if that address
 * has an account, a message is on its way. A form that said "sent" would be the enumeration
 * oracle the API is built to avoid, with the UI doing the leaking.
 */
export function ForgotPasswordForm(): JSX.Element {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setProblem(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      setProblem(
        error instanceof ApiRequestError ? error.message : "Something went wrong. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p data-testid="forgot-sent" className="text-sm text-muted-foreground">
            If that address has an account, a recovery message is on its way. The link in it works
            for thirty minutes.
          </p>
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recover your password</CardTitle>
        <CardDescription>We will send you a link to choose a new one.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          A real `<form>`: the same defect the lane found on the two sign-in surfaces, and the same
          fix. With the fields in a plain container and the button as `type="submit"`, Enter did
          nothing — and a recovery form is exactly where a password manager fills and submits.
        */}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="forgot-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {problem === null ? null : (
            <p data-testid="forgot-problem" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <Button type="submit" disabled={email.trim().length === 0 || submitting}>
              {submitting ? "Sending..." : "Send the link"}
            </Button>
            <Link
              href="/login"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
