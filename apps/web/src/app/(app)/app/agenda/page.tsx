import type { JSX } from "react";
import { Agenda } from "./agenda";

/**
 * Staff agenda index page.
 *
 * Data fetching, filters and mutations live in the client component so loading,
 * empty, error, success and permission-denied states are explicit and reactive.
 */
export default function AgendaPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl">
      <Agenda />
    </div>
  );
}
