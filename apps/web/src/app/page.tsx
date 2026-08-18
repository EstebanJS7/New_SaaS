import { HealthIndicator } from "@/components/health-indicator";

import type { JSX } from "react";

export default function HomePage(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-4xl font-bold tracking-tight">NewSaaS</h1>
      <p className="text-muted-foreground">Foundation is running.</p>
      <HealthIndicator />
    </main>
  );
}
