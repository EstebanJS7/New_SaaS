"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import {
  fiscalSettingsErrorMessage,
  saveEmitterProfile,
  type EmitterProfile,
  type EmitterProfileInput,
} from "./fiscal-settings-api";
import {
  EMISSION_TYPE_OPTIONS,
  RESPONSIBLE_ISSUER_TYPE_OPTIONS,
  TAXPAYER_TYPE_OPTIONS,
  TAX_TYPE_OPTIONS,
  TRANSACTION_TYPE_OPTIONS,
  labelFor,
} from "./fiscal-settings-display";
import {
  SelectField,
  SuccessNotice,
  TextField,
  blankToNull,
  optionalText,
  parseWhole,
} from "./fiscal-form-field";

/**
 * The emitter profile: read, created when the clinic has none, and saved whole
 * (the API's `PUT` replaces it). The form prefills every field the API answers,
 * the responsible issuer included, so saving keeps what was there.
 */
export function ProfileSection({
  profile,
  isLoading,
  error,
  onRetry,
  onSaved,
}: {
  profile: EmitterProfile | null | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onSaved: () => void;
}): JSX.Element {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            Perfil del emisor
          </h2>
          <p className="text-sm text-muted-foreground">
            Los datos del contribuyente que figuran en cada documento electrónico.
          </p>
        </div>
        {profile && !editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setNotice(null);
              setEditing(true);
            }}
          >
            Editar perfil
          </Button>
        ) : null}
      </div>

      <SuccessNotice message={notice} />

      {isLoading ? <ListSkeleton label="Cargando perfil fiscal…" rows={1} /> : null}
      {error ? (
        <ErrorState message="No se pudo cargar el perfil fiscal." onRetry={onRetry} />
      ) : null}

      {editing ? (
        <ProfileForm
          initial={profile ?? null}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice("Se guardó el perfil fiscal.");
            onSaved();
          }}
        />
      ) : profile ? (
        <ProfileSummary profile={profile} />
      ) : profile === null ? (
        <EmptyState
          icon="receipt"
          title="Todavía no hay perfil fiscal"
          description="Cargá los datos del contribuyente para poder emitir documentos electrónicos."
        >
          <Button
            type="button"
            onClick={() => {
              setNotice(null);
              setEditing(true);
            }}
          >
            <Icon name="plus" />
            Crear perfil fiscal
          </Button>
        </EmptyState>
      ) : null}
    </section>
  );
}

function ProfileSummary({ profile }: { profile: EmitterProfile }): JSX.Element {
  const rows: readonly [string, string][] = [
    ["RUC", `${profile.ruc}-${profile.checkDigit}`],
    ["Razón social", profile.legalName],
    ["Nombre de fantasía", profile.tradeName ?? "Sin nombre de fantasía"],
    ["Tipo de contribuyente", labelFor(TAXPAYER_TYPE_OPTIONS, profile.taxpayerType)],
    ["Tipo de impuesto", labelFor(TAX_TYPE_OPTIONS, profile.taxType)],
    ["Tipo de transacción", labelFor(TRANSACTION_TYPE_OPTIONS, profile.transactionType)],
    ["Tipo de emisión", labelFor(EMISSION_TYPE_OPTIONS, profile.emissionType)],
    [
      "Actividades",
      profile.activities.map((activity) => `${activity.code} · ${activity.description}`).join("; "),
    ],
  ];
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface ActivityDraft {
  code: string;
  description: string;
}

interface ProfileErrors {
  ruc?: string;
  checkDigit?: string;
  legalName?: string;
  tradeName?: string;
  regimeCode?: string;
  activities?: string;
  responsible?: string;
}

const RUC = /^[1-9][0-9]*[0-9A-D]?$/;

function ProfileForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: EmitterProfile | null;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [ruc, setRuc] = useState(initial?.ruc ?? "");
  const [checkDigit, setCheckDigit] = useState(initial?.checkDigit ?? "");
  const [taxpayerType, setTaxpayerType] = useState(String(initial?.taxpayerType ?? 1));
  const [regimeCode, setRegimeCode] = useState(optionalText(initial?.regimeCode));
  const [legalName, setLegalName] = useState(initial?.legalName ?? "");
  const [tradeName, setTradeName] = useState(initial?.tradeName ?? "");
  const [transactionType, setTransactionType] = useState(optionalText(initial?.transactionType));
  const [taxType, setTaxType] = useState(String(initial?.taxType ?? 1));
  const [emissionType, setEmissionType] = useState(String(initial?.emissionType ?? 1));
  const [activities, setActivities] = useState<ActivityDraft[]>(
    initial && initial.activities.length > 0
      ? initial.activities.map((activity) => ({ ...activity }))
      : [{ code: "", description: "" }]
  );
  const declared = initial?.responsibleIssuer ?? null;
  const [withResponsible, setWithResponsible] = useState(declared !== null);
  const [responsible, setResponsible] = useState({
    type: String(declared?.type ?? 1),
    id: declared?.id ?? "",
    name: declared?.name ?? "",
    role: declared?.role ?? "",
  });
  const [errors, setErrors] = useState<ProfileErrors>({});

  const save = useMutation({
    mutationFn: (input: EmitterProfileInput) => saveEmitterProfile(input),
    onSuccess: onSaved,
  });

  function build(): EmitterProfileInput | null {
    const next: ProfileErrors = {};
    const rucValue = ruc.trim().toUpperCase();
    if (!RUC.test(rucValue) || rucValue.length < 3 || rucValue.length > 8)
      next.ruc = "Escribí un RUC válido.";
    if (!/^[0-9]$/.test(checkDigit.trim())) next.checkDigit = "Un solo dígito.";
    const legal = legalName.trim();
    if (legal.length < 4) next.legalName = "Escribí la razón social (al menos 4 caracteres).";
    const trade = blankToNull(tradeName);
    if (trade !== null && trade.length < 4)
      next.tradeName = "Al menos 4 caracteres, o dejalo vacío.";
    const regime = regimeCode.trim() === "" ? null : parseWhole(regimeCode, 1, 8);
    if (regimeCode.trim() !== "" && regime === null) next.regimeCode = "Un número del 1 al 8.";
    const cleanActivities = activities.map((activity) => ({
      code: activity.code.trim().toUpperCase(),
      description: activity.description.trim(),
    }));
    if (
      cleanActivities.some(
        (activity) => !/^[0-9A-Z]{1,8}$/.test(activity.code) || activity.description.length === 0
      )
    )
      next.activities = "Cada actividad necesita código (hasta 8 caracteres) y descripción.";
    const responsibleType = Number(responsible.type);
    if (
      withResponsible &&
      (!/^[0-9A-Za-z-]{1,20}$/.test(responsible.id.trim()) ||
        responsible.name.trim().length < 4 ||
        responsible.role.trim().length < 4)
    )
      next.responsible = "Completá documento, nombre y cargo (al menos 4 caracteres).";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      ruc: rucValue,
      checkDigit: checkDigit.trim(),
      taxpayerType: Number(taxpayerType),
      regimeCode: regime,
      legalName: legal,
      tradeName: trade,
      responsibleIssuer: withResponsible
        ? {
            type: responsibleType,
            typeName: labelFor(RESPONSIBLE_ISSUER_TYPE_OPTIONS, responsibleType),
            id: responsible.id.trim(),
            name: responsible.name.trim(),
            role: responsible.role.trim(),
          }
        : null,
      transactionType: transactionType === "" ? null : Number(transactionType),
      taxType: Number(taxType),
      emissionType: Number(emissionType),
      activities: cleanActivities,
    };
  }

  return (
    <form
      noValidate
      aria-label={initial ? "Editar perfil fiscal" : "Nuevo perfil fiscal"}
      aria-busy={save.isPending}
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const input = build();
        if (input !== null) save.mutate(input);
      }}
    >
      <TextField label="RUC" value={ruc} onChange={setRuc} error={errors.ruc} maxLength={8} />
      <TextField
        label="Dígito verificador"
        value={checkDigit}
        onChange={setCheckDigit}
        error={errors.checkDigit}
        inputMode="numeric"
        maxLength={1}
      />
      <SelectField
        label="Tipo de contribuyente"
        value={taxpayerType}
        onChange={setTaxpayerType}
        options={TAXPAYER_TYPE_OPTIONS}
      />
      <TextField
        label="Razón social"
        value={legalName}
        onChange={setLegalName}
        error={errors.legalName}
        maxLength={255}
        className="space-y-1 sm:col-span-2"
      />
      <TextField
        label="Nombre de fantasía"
        value={tradeName}
        onChange={setTradeName}
        error={errors.tradeName}
        optional
        maxLength={255}
      />
      <SelectField
        label="Tipo de impuesto"
        value={taxType}
        onChange={setTaxType}
        options={TAX_TYPE_OPTIONS}
      />
      <SelectField
        label="Tipo de transacción"
        value={transactionType}
        onChange={setTransactionType}
        options={TRANSACTION_TYPE_OPTIONS}
        emptyLabel="Sin declarar"
      />
      <SelectField
        label="Tipo de emisión"
        value={emissionType}
        onChange={setEmissionType}
        options={EMISSION_TYPE_OPTIONS}
      />
      <TextField
        label="Régimen"
        value={regimeCode}
        onChange={setRegimeCode}
        error={errors.regimeCode}
        optional
        inputMode="numeric"
        maxLength={1}
      />

      <fieldset className="space-y-3 sm:col-span-3">
        <legend className="text-sm font-medium">Actividades económicas</legend>
        {activities.map((activity, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
            <TextField
              label={`Código de actividad ${index + 1}`}
              value={activity.code}
              maxLength={8}
              onChange={(code) =>
                setActivities((current) =>
                  current.map((item, at) => (at === index ? { ...item, code } : item))
                )
              }
            />
            <TextField
              label={`Descripción de actividad ${index + 1}`}
              value={activity.description}
              maxLength={300}
              onChange={(description) =>
                setActivities((current) =>
                  current.map((item, at) => (at === index ? { ...item, description } : item))
                )
              }
            />
            {activities.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-end"
                onClick={() => setActivities((current) => current.filter((_, at) => at !== index))}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        ))}
        {errors.activities ? <p className="text-xs text-destructive">{errors.activities}</p> : null}
        {activities.length < 50 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActivities((current) => [...current, { code: "", description: "" }])}
          >
            Agregar actividad
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3 sm:col-span-3">
        <legend className="text-sm font-medium">Responsable de la emisión</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withResponsible}
            onChange={(event) => setWithResponsible(event.target.checked)}
          />
          Declarar un responsable de la emisión
        </label>
        {withResponsible ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Tipo de documento del responsable"
              value={responsible.type}
              onChange={(type) => setResponsible((current) => ({ ...current, type }))}
              options={RESPONSIBLE_ISSUER_TYPE_OPTIONS}
            />
            <TextField
              label="Número de documento del responsable"
              value={responsible.id}
              maxLength={20}
              onChange={(id) => setResponsible((current) => ({ ...current, id }))}
            />
            <TextField
              label="Nombre del responsable"
              value={responsible.name}
              maxLength={255}
              onChange={(name) => setResponsible((current) => ({ ...current, name }))}
            />
            <TextField
              label="Cargo del responsable"
              value={responsible.role}
              maxLength={100}
              onChange={(role) => setResponsible((current) => ({ ...current, role }))}
            />
            {errors.responsible ? (
              <p className="text-xs text-destructive sm:col-span-2">{errors.responsible}</p>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {save.error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {fiscalSettingsErrorMessage(
            save.error,
            "No se pudo guardar el perfil. Intentá nuevamente."
          )}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={save.isPending}>
          Guardar perfil
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
