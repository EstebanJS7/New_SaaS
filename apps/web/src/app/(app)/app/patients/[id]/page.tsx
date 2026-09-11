import type { JSX } from "react";
import { PatientDetail } from "./patient-detail";

/**
 * Staff patient detail page.
 *
 * The interactive shell is a client component so loading, empty, error, and
 * mutation states remain explicit and reactive.
 */
export default function PatientDetailPage(): JSX.Element {
  return <PatientDetail />;
}
