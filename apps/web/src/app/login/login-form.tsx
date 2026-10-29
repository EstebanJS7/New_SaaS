"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { navigateAfterSignIn } from "./navigation";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { userFacingSignInError, signIn } from "./login-api";

/**
 * The sign-in form ([[SHEL-001]]).
 *
 * Two things about it are decisions rather than styling.
 *
 * **Failures are translated by stable code.** Unknown address and wrong password
 * produce ONE translated message, and this form does not add a second distinction: a UI
 * that guessed which was which would be a louder account-existence oracle than the API it
 * fronts.
 *
 * **The password is cleared on a failed attempt and never leaves the field's state.** It is
 * not in the URL, not in storage, and not in the error message — and the failure branch sets
 * only the message, so an error object cannot carry it by accident.
 */
export function LoginForm({
  returnTo,
  expired = false,
}: { returnTo?: string; expired?: boolean } = {}): JSX.Element {
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
      // The BFF establishes the HttpOnly session. A full document navigation
      // re-runs tenant branding with a fresh CSP nonce; an SPA refresh can leave
      // newly streamed theme styles incompatible with the original policy.
      navigateAfterSignIn(returnTo);
    } catch (error) {
      setSubmitting(false);
      setPassword("");
      setProblem(userFacingSignInError(error));
    }
  }

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="px-0 pb-8 pt-0">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          <h2>Iniciar sesión</h2>
        </CardTitle>
        <CardDescription>Ingresá para continuar con el trabajo de tu equipo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {/*
          A real `<form>`, and the reason is a defect this lane found: with the inputs in a plain
          container and the button as `type="button"`, pressing Enter did NOTHING. Every user's muscle
          memory — and every password manager — submits a sign-in by keyboard, and the page looked and
          behaved correctly right up to that moment.
        */}
        {expired && (
          <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
            Tu sesión terminó. Ingresá para volver al registro guardado. Los cambios sin guardar no
            se restaurarán.
          </p>
        )}
        <form
          aria-busy={submitting}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="login-email" className="text-sm font-medium">
              Correo electrónico
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              aria-describedby={problem ? "login-problem" : undefined}
              required
              disabled={submitting}
              placeholder="tu@organizacion.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="login-password" className="text-sm font-medium">
              Contraseña
            </label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              aria-describedby={problem ? "login-problem" : undefined}
              required
              disabled={submitting}
              placeholder="Ingresá tu contraseña"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {problem === null ? null : (
            <p
              role="alert"
              data-testid="login-problem"
              id="login-problem"
              className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {problem}
            </p>
          )}
          <div className="flex flex-col gap-4 pt-2">
            <Button type="submit" disabled={!canSubmit} loading={submitting} className="w-full">
              {submitting ? "Iniciando sesión…" : "Iniciar sesión"}
            </Button>
            {/*
            The recovery entry point ([[DAT-007]]). Until this link existed, a user could
            only reach the reset page by receiving a message nobody could ask for.
          */}
            <Link
              href="/forgot-password"
              data-testid="login-forgot-password"
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
