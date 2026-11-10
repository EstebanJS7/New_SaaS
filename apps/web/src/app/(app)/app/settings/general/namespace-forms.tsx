"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { Input } from "@newsaas/ui/components/ui/input";
import {
  REMINDER_CHANNELS,
  REMINDER_LEAD_HOURS_MAX,
  REMINDER_LEAD_HOURS_MIN,
  changedFields,
  isValidLeadHours,
  normalizeChannels,
  type ReminderChannel,
} from "./general-settings-rules";
import { SaveButton, type SectionFormProps } from "./settings-section";

const CHANNEL_LABELS: Readonly<Record<ReminderChannel, string>> = {
  EMAIL: "Correo electrónico",
  WHATSAPP: "WhatsApp",
};

function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Ventas: only `requireCustomerForInvoice` is editable; the currency is shown as is. */
export function SalesForm({ settings, onSave, saving }: SectionFormProps): JSX.Element {
  const currencyId = useId();
  const [requireCustomer, setRequireCustomer] = useState(
    settings.requireCustomerForInvoice === true
  );
  const patch = changedFields(settings, { requireCustomerForInvoice: requireCustomer });
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
      <CheckboxField
        label="La factura exige cliente"
        hint="Sin cliente, la venta no se puede facturar."
        checked={requireCustomer}
        onChange={setRequireCustomer}
      />
      <div className="max-w-40 space-y-1">
        <label htmlFor={currencyId} className="text-sm font-medium">
          Moneda
        </label>
        {/* Read-only on purpose (CFG-001): today the clinic only invoices in PYG. */}
        <Input
          id={currencyId}
          readOnly
          value={typeof settings.defaultCurrency === "string" ? settings.defaultCurrency : ""}
        />
      </div>
      <SaveButton dirty={dirty} saving={saving} />
    </form>
  );
}

/** Portal: whether a customer's booking waits for staff approval. */
export function PortalForm({ settings, onSave, saving }: SectionFormProps): JSX.Element {
  const [requiresApproval, setRequiresApproval] = useState(
    settings.bookingRequiresApproval === true
  );
  const patch = changedFields(settings, { bookingRequiresApproval: requiresApproval });
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
      <CheckboxField
        label="Las reservas necesitan aprobación"
        hint="Un turno pedido desde el portal queda pendiente hasta que alguien del equipo lo confirme."
        checked={requiresApproval}
        onChange={setRequiresApproval}
      />
      <SaveButton dirty={dirty} saving={saving} />
    </form>
  );
}

/** Notificaciones: the appointment reminder's lead time and channels. */
export function NotificationsForm({ settings, onSave, saving }: SectionFormProps): JSX.Element {
  const ids = { hours: useId(), channels: useId() };
  const storedHours = settings.appointmentReminderLeadHours;
  const storedChannels = normalizeChannels(
    Array.isArray(settings.appointmentReminderChannels)
      ? settings.appointmentReminderChannels.filter(
          (value): value is string => typeof value === "string"
        )
      : []
  );
  const [hours, setHours] = useState(typeof storedHours === "number" ? String(storedHours) : "");
  const [channels, setChannels] = useState<ReminderChannel[]>(storedChannels);
  const [touched, setTouched] = useState(false);

  const parsedHours = hours.trim() === "" ? Number.NaN : Number(hours);
  const hoursInvalid = !isValidLeadHours(parsedHours);
  const channelsInvalid = channels.length === 0;
  // Compared against the stored list as sent (not normalized), so a repeated
  // stored value is rewritten once on the next save.
  const patch = changedFields(settings, {
    appointmentReminderLeadHours: hoursInvalid ? hours : parsedHours,
    appointmentReminderChannels: channels,
  });
  const dirty = Object.keys(patch).length > 0;

  return (
    <form
      noValidate
      className="space-y-4"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!dirty || hoursInvalid || channelsInvalid) return;
        onSave(patch);
      }}
    >
      <div className="max-w-60 space-y-1">
        <label htmlFor={ids.hours} className="text-sm font-medium">
          Horas de anticipación del recordatorio
        </label>
        <Input
          id={ids.hours}
          type="number"
          inputMode="numeric"
          min={REMINDER_LEAD_HOURS_MIN}
          max={REMINDER_LEAD_HOURS_MAX}
          step={1}
          value={hours}
          aria-invalid={touched && hoursInvalid}
          aria-describedby={touched && hoursInvalid ? `${ids.hours}-error` : undefined}
          onChange={(event) => setHours(event.target.value)}
        />
        {touched && hoursInvalid ? (
          <p id={`${ids.hours}-error`} className="text-xs text-destructive">
            {`Elegí un número entero de horas entre ${REMINDER_LEAD_HOURS_MIN} y ${REMINDER_LEAD_HOURS_MAX}.`}
          </p>
        ) : null}
      </div>
      <fieldset className="space-y-2" aria-describedby={`${ids.channels}-error`}>
        <legend className="text-sm font-medium">Canales del recordatorio</legend>
        {REMINDER_CHANNELS.map((channel) => (
          <CheckboxField
            key={channel}
            label={CHANNEL_LABELS[channel]}
            checked={channels.includes(channel)}
            onChange={(checked) =>
              setChannels((current) =>
                normalizeChannels(
                  checked ? [...current, channel] : current.filter((value) => value !== channel)
                )
              )
            }
          />
        ))}
        {touched && channelsInvalid ? (
          <p id={`${ids.channels}-error`} className="text-xs text-destructive">
            Elegí al menos un canal.
          </p>
        ) : null}
      </fieldset>
      <SaveButton dirty={dirty} saving={saving} />
    </form>
  );
}
