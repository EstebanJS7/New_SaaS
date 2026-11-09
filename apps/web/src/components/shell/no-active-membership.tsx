"use client";

import type { JSX } from "react";
import { useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";

/**
 * Shown instead of the workspace when the session is valid but the API refuses
 * every tenant request (no ACTIVE membership, e.g. a suspended member, ONB-001).
 * The backend stays the authority; this only replaces a shell full of
 * permission errors with one explanation and a way out.
 */
export function NoActiveMembership(): JSX.Element {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/session/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error("Logout failed");
      window.location.assign("/login");
    } catch {
      setSigningOut(false);
      setSignOutError(true);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-card-foreground">
        <h1 className="text-lg font-semibold">Tu acceso no está activo</h1>
        <p className="text-sm text-muted-foreground">
          Tu cuenta no tiene un acceso activo a ninguna clínica. Si te suspendieron, pedile a quien
          administra el personal que lo reactive.
        </p>
        {signOutError ? (
          <p role="alert" className="text-sm text-destructive">
            No se pudo cerrar la sesión. Intentá de nuevo.
          </p>
        ) : null}
        <Button
          type="button"
          loading={signingOut}
          onClick={() => {
            void signOut();
          }}
        >
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </Button>
      </section>
    </main>
  );
}
