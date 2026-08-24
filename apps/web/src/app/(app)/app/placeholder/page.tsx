import type { JSX } from "react";

/**
 * Deep-link proof for the staff shell.
 *
 * Visiting `/app/placeholder` directly must render this content inside the
 * same `(app)` route-group chrome (spec scenario: sub-route keeps the shell).
 */
export default function AppPlaceholderPage(): JSX.Element {
  return (
    <div data-testid="placeholder-content" className="text-sm text-muted-foreground">
      Sub-route placeholder rendered inside the staff shell.
    </div>
  );
}
