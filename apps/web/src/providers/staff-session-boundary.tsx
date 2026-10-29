"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { staffSignInPath } from "@/lib/staff-return-path";
import { staffResumeTarget } from "./staff-resume-target";

export function isSessionExpired(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 401;
}
/** Staff-only: do not treat a portal denial, outage or permission refusal as logout. */
export function StaffSessionBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const expired = useRef(false);
  const [login, setLogin] = useState<string>();
  useEffect(() => {
    const check = (error: unknown) => {
      if (
        expired.current ||
        !/^\/app(?:\/|$)/.test(window.location.pathname) ||
        !isSessionExpired(error)
      )
        return;
      expired.current = true;
      setLogin(staffSignInPath(staffResumeTarget()));
      void client.cancelQueries();
    };
    const queries = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") check(event.query.state.error);
    });
    const mutations = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error")
        check(event.mutation.state.error);
    });
    return () => {
      queries();
      mutations();
    };
  }, [client]);
  useEffect(() => {
    if (login) document.getElementById("session-expired-title")?.focus();
  }, [login]);
  if (!login) return children;
  return (
    <main
      lang="es-PY"
      className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground"
    >
      <section
        aria-labelledby="session-expired-title"
        className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <h1
          id="session-expired-title"
          tabIndex={-1}
          className="text-2xl font-semibold outline-none"
        >
          Tu sesión terminó
        </h1>
        <p role="alert">
          Volvé a ingresar para continuar. Los registros ya guardados permanecen en el sistema.
        </p>
        <p className="text-sm text-muted-foreground">
          Los cambios sin guardar no se restaurarán al volver a ingresar. Si una operación quedó sin
          respuesta, revisá su estado antes de repetirla. No volveremos a enviar guardados, cierres
          ni cobros automáticamente.
        </p>
        <a
          href={login}
          className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Volver a ingresar
        </a>
      </section>
    </main>
  );
}
