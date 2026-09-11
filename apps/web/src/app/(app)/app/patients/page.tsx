import type { JSX } from "react";
import { PatientsList } from "./patients-list";

/**
 * Staff patients index page.
 *
 * Data fetching and mutations live in the client list component so loading,
 * empty, error, and success states are explicit and reactive.
 */
export default function PatientsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PatientsList />
    </div>
  );
}
