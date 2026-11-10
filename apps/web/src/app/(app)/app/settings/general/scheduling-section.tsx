"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { changedFields } from "./general-settings-rules";
import { SaveButton, SettingsSection, type SectionFormProps } from "./settings-section";

const CONFLICT_POLICIES = [
  {
    value: "REJECT",
    label: "No permitir turnos superpuestos",
    hint: "Un turno que se cruza con otro del mismo profesional se rechaza.",
  },
  {
    value: "ALLOW",
    label: "Permitir turnos superpuestos",
    hint: "Se pueden agendar dos turnos a la misma hora para el mismo profesional.",
  },
] as const;

/**
 * Agenda: the conflict policy. Its patch carries `conflictPolicy` only, so the
 * stored `availability` and `blocks` are never sent and never overwritten.
 */
export function ConflictPolicyForm({ settings, onSave, saving }: SectionFormProps): JSX.Element {
  const name = useId();
  const [policy, setPolicy] = useState(settings.conflictPolicy === "ALLOW" ? "ALLOW" : "REJECT");
  const patch = changedFields(settings, { conflictPolicy: policy });
  const dirty = Object.keys(patch).length > 0;
  return (
    <form
      noValidate
      className="space-y-4"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) onSave(patch);
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Turnos superpuestos</legend>
        {CONFLICT_POLICIES.map((option) => (
          <label key={option.value} className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name={name}
              value={option.value}
              className="mt-0.5 size-4 accent-primary"
              checked={policy === option.value}
              onChange={() => setPolicy(option.value)}
            />
            <span className="space-y-0.5">
              <span className="block font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SaveButton dirty={dirty} saving={saving} />
    </form>
  );
}

/**
 * The «Agenda» section.
 *
 * T2 EXTENSION POINT (CFG-001 S4): the availability windows and blocks editor
 * mounts below `ConflictPolicyForm` as its own form with its own save, sending
 * ONLY `availability` and/or `blocks` (the API merges the patch). Until then
 * this section neither renders nor edits them, and its save never sends them.
 */
export function SchedulingSection(): JSX.Element {
  return (
    <SettingsSection
      namespace="scheduling"
      title="Agenda"
      description="Cómo la agenda trata los turnos de un mismo profesional."
      renderForm={(props) => <ConflictPolicyForm {...props} />}
    />
  );
}
