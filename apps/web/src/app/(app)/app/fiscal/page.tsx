import type { JSX } from "react";
import { FiscalSurface } from "./fiscal-surface";

/** Staff Fiscal route. Reads and commands live in the client surface. */
export default function FiscalPage(): JSX.Element {
  return <FiscalSurface />;
}
