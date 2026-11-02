"use client";
import { ErrorState } from "@/components/feedback";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="mb-3 text-2xl font-semibold">No pudimos abrir esta página</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Tu espacio de trabajo sigue disponible. Volvé a intentar o elegí otra sección del menú.
      </p>
      <ErrorState message="Ocurrió un error inesperado al abrir esta página." onRetry={reset} />
    </div>
  );
}
