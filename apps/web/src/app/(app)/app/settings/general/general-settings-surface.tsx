"use client";

import type { JSX } from "react";
import { EmptyState } from "@/components/feedback";
import { visibleSections, type SettingsNamespace } from "./general-settings-rules";
import { NotificationsForm, PortalForm, SalesForm } from "./namespace-forms";
import { SchedulingSection } from "./scheduling-section";
import { SettingsSection } from "./settings-section";

export interface GeneralSettingsSurfaceProps {
  /**
   * The caller's permission keys when the shell knows them. UX only and
   * optional: unknown permissions show every section, and the API re-checks
   * the namespace's permission on every save.
   */
  readonly permissions?: readonly string[];
  /** The tenant's feature codes when the shell knows them; same default. */
  readonly entitlements?: readonly string[];
}

function Section({ namespace }: { namespace: SettingsNamespace }): JSX.Element {
  switch (namespace) {
    case "sales":
      return (
        <SettingsSection
          namespace="sales"
          title="Ventas"
          description="Reglas de la venta y la factura."
          renderForm={(props) => <SalesForm {...props} />}
        />
      );
    case "portal":
      return (
        <SettingsSection
          namespace="portal"
          title="Portal"
          description="Lo que pueden hacer los clientes desde el portal."
          renderForm={(props) => <PortalForm {...props} />}
        />
      );
    case "notifications":
      return (
        <SettingsSection
          namespace="notifications"
          title="Notificaciones"
          description="El recordatorio de turno que reciben los clientes."
          renderForm={(props) => <NotificationsForm {...props} />}
        />
      );
    case "scheduling":
      return <SchedulingSection />;
  }
}

/**
 * «Configuración › General» ([[CFG-001]]): one section per tenant-settings
 * namespace, each offered only with its permission and, for Ventas and Portal,
 * the clinic's feature. Each section reads and saves on its own.
 */
export function GeneralSettingsSurface({
  permissions,
  entitlements,
}: GeneralSettingsSurfaceProps = {}): JSX.Element {
  const sections = visibleSections(permissions, entitlements);
  return (
    <div className="space-y-6" data-testid="general-settings-surface">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Configuración / General</p>
          <h1 className="text-2xl font-semibold tracking-tight">General</h1>
          <p className="text-sm text-muted-foreground">
            Ajustes de la clínica. Cada sección se guarda por separado.
          </p>
        </div>
      </div>
      {sections.length === 0 ? (
        <EmptyState
          icon="shield"
          title="No tenés permiso para cambiar la configuración general"
          description="Pedile a quien administra la clínica que la gestione."
        />
      ) : (
        sections.map((namespace) => <Section key={namespace} namespace={namespace} />)
      )}
    </div>
  );
}
