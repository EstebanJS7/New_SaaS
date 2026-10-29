import { Skeleton } from "@newsaas/ui/components/ui/skeleton";
import { ListSkeleton } from "@/components/feedback";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28 rounded-lg" />
        ))}
      </div>
      <ListSkeleton label="Loading your workspace..." />
    </div>
  );
}
