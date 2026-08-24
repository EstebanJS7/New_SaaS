import type { JSX } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";

/**
 * Staff shell home.
 *
 * Hosts a self-contained sample card inside the bounded content region: it
 * consumes semantic tokens only (`bg-card`, `text-muted-foreground`), so it
 * re-themes with appearance/preset changes without component edits. This is
 * the seed of the future live-preview sample host.
 */
export default function AppHomePage(): JSX.Element {
  return (
    <Card data-testid="sample-card" className="max-w-xl">
      <CardHeader>
        <CardTitle>Staff workspace</CardTitle>
        <CardDescription>
          Sample card hosted by the shell content region, styled exclusively through resolved brand
          tokens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Placeholder content. Real destinations arrive with later epics.
        </p>
      </CardContent>
    </Card>
  );
}
