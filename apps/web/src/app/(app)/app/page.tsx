import type { JSX } from "react";
import { Dashboard } from "./dashboard";

/**
 * Staff shell home — the dashboard ([[REP-008]], [[DEC-062]]).
 *
 * A thin server page: the surface itself is a client component because every
 * figure on it comes from a live report read, and its four states (loading,
 * permission-denied, error, success) only exist while that read is in flight.
 *
 * It replaces the placeholder that stood here from the shell epic. The
 * placeholder's card was the seed of this host, and what it proved — that the
 * bounded content region surrounds real content and that the content re-themes
 * through semantic tokens alone — is now proven against `app-dashboard` by the
 * shell's own tests.
 */
export default function AppHomePage(): JSX.Element {
  return <Dashboard />;
}
