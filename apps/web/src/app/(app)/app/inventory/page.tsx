import type { JSX } from "react";
import { StockSurface } from "./stock-surface";

/** MB-003 (DEC-094 §10): stock per branch and transfers between branches. */
export default function InventoryPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <StockSurface />
    </div>
  );
}
