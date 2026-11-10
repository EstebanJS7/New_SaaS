import type { JSX } from "react";
import { GeneralSettingsSurface } from "./general-settings-surface";

/**
 * Staff «Configuración › General» route ([[CFG-001]]).
 *
 * No permission or entitlement list is passed to the surface, the same honest
 * gap the imports and reports pages document: the shell does not load the
 * caller's claims yet (the memberships proxy deliberately refuses
 * `me/permissions`, and no staff route serves the tenant's features). The
 * surface therefore shows every section, and the API refuses a save without the
 * namespace's permission or feature, which the section explains.
 */
export default function GeneralSettingsPage(): JSX.Element {
  return <GeneralSettingsSurface />;
}
