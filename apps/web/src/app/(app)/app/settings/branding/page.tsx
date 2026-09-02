import type { JSX } from "react";
import { BrandingForm } from "./branding-form";

/**
 * Staff branding settings page.
 *
 * The route lives under the existing `/app` shell so the layout chrome is
 * inherited. All data fetching and mutations are handled by the client form
 * so loading, error, and success states can be explicit and reactive.
 */
export default function BrandingSettingsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Branding</h1>
      <BrandingForm />
    </div>
  );
}
