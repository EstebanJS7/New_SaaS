import type { JSX } from "react";
import { ImportsIndex } from "./imports-index";

/**
 * Staff imports route ([[IMP-005]]).
 *
 * A thin server page: the upload, the history and their states live in the client
 * surface, so loading, refused and failed reads stay reactive without a second
 * read on the server.
 *
 * No permission list is passed to the surface, and that is the honest state of the
 * shell today rather than a decision: no staff page supplies the caller's claims to
 * a surface yet (the reports workspace has the same gap), so the component takes
 * `permissions` as an optional prop that defaults to "shown", and the API remains
 * the only authorization authority.
 */
export default function ImportsPage(): JSX.Element {
  return <ImportsIndex />;
}
