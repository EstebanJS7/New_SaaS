import type { JSX } from "react";
import { ImportsIndexScreen } from "./imports-index";

/**
 * Staff imports route ([[IMP-005]]).
 *
 * A thin server page: the upload, the history and their states live in the client
 * surface, so loading, refused and failed reads stay reactive without a second
 * read on the server.
 *
 * The container reads the caller's permissions from the staff shell ([[UX-037]]).
 * When the shell could not load them the surface shows every action, and the API
 * remains the only authorization authority either way.
 */
export default function ImportsPage(): JSX.Element {
  return <ImportsIndexScreen />;
}
