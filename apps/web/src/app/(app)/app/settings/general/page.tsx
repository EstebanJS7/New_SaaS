import type { JSX } from "react";
import { GeneralSettingsScreen } from "./general-settings-surface";

/**
 * Staff «Configuración › General» route ([[CFG-001]]).
 *
 * The container reads the caller's permissions and the clinic's features from
 * the staff shell ([[UX-037]]), so a section the caller cannot change is not
 * offered. When the shell could not load them, every section shows and the API
 * refuses a save without the namespace's permission or feature, which the
 * section explains.
 */
export default function GeneralSettingsPage(): JSX.Element {
  return <GeneralSettingsScreen />;
}
