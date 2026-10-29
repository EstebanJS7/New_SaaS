import type { ReactNode } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon, type IconName } from "@newsaas/ui/components/ui/icon";
import { Skeleton } from "@newsaas/ui/components/ui/skeleton";
import { Spinner } from "@newsaas/ui/components/ui/spinner";

export function ListSkeleton({
  label = "Loading records...",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-lg border bg-card p-5">
          <Skeleton className="size-11 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = "search",
  children,
}: {
  title: string;
  description: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon name={icon} className="size-6" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "We couldn't load this information",
  retryLabel = "Try again",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-5"
    >
      <Icon name="alert" className="mt-0.5 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function BusyLabel({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      {children}
    </span>
  );
}
