import type { JSX } from "react";
import { ReportsIndex } from "./reports-index";

/**
 * Staff reports route ([[REP-008]]).
 *
 * A thin server page: the index and its access probe live in the client surface,
 * so the loading, refused and failed states stay reactive without a second read
 * on the server.
 */
export default function ReportsPage(): JSX.Element {
  return <ReportsIndex />;
}
