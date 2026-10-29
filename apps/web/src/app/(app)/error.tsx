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
      <h1 className="mb-3 text-2xl font-semibold">This page needs another try</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Your workspace is still available. Retry this page or choose another section from the menu.
      </p>
      <ErrorState message="An unexpected error prevented this page from opening." onRetry={reset} />
    </div>
  );
}
