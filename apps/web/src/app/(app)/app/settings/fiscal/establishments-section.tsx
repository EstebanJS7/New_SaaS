"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import {
  createEstablishment,
  fiscalSettingsErrorMessage,
  updateEstablishment,
  type Establishment,
  type EstablishmentInput,
} from "./fiscal-settings-api";
import { DEPARTMENT_OPTIONS, labelFor } from "./fiscal-settings-display";
import {
  SelectField,
  SuccessNotice,
  TextField,
  blankToNull,
  optionalText,
  parseWhole,
} from "./fiscal-form-field";

type Editing = { readonly kind: "new" } | { readonly kind: "edit"; readonly item: Establishment };

/** The establishments the clinic issues from: list, add and edit. */
export function EstablishmentsSection({
  establishments,
  isLoading,
  error,
  onRetry,
  onSaved,
}: {
  establishments: readonly Establishment[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onSaved: () => void;
}): JSX.Element {
  const titleId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = (item: Establishment) => {
    setEditing(null);
    setNotice(`Se guardó el establecimiento ${item.code}.`);
    onSaved();
  };

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            Establecimientos
          </h2>
          <p className="text-sm text-muted-foreground">
            Los locales habilitados ante la SET, con su código de tres dígitos.
          </p>
        </div>
        {error ? null : (
          <Button
            type="button"
            size="sm"
            aria-expanded={editing?.kind === "new"}
            onClick={() => {
              setNotice(null);
              setEditing((current) => (current?.kind === "new" ? null : { kind: "new" }));
            }}
          >
            <Icon name={editing?.kind === "new" ? "close" : "plus"} />
            {editing?.kind === "new" ? "Cerrar" : "Agregar establecimiento"}
          </Button>
        )}
      </div>

      <SuccessNotice message={notice} />

      {editing?.kind === "new" ? (
        <EstablishmentForm
          title="Nuevo establecimiento"
          onCancel={() => setEditing(null)}
          onSave={createEstablishment}
          onSaved={saved}
        />
      ) : null}

      {isLoading ? <ListSkeleton label="Cargando establecimientos…" rows={1} /> : null}
      {error ? (
        <ErrorState message="No se pudo cargar la lista de establecimientos." onRetry={onRetry} />
      ) : null}

      {establishments && establishments.length > 0 ? (
        <ul className="space-y-3" aria-label="Establecimientos fiscales">
          {establishments.map((item) =>
            editing?.kind === "edit" && editing.item.id === item.id ? (
              <li key={item.id}>
                <EstablishmentForm
                  title={`Editar establecimiento ${item.code}`}
                  initial={item}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => updateEstablishment(item.id, input)}
                  onSaved={saved}
                />
              </li>
            ) : (
              <li key={item.id} className="record-row" data-testid="establishment-row">
                <div className="min-w-0 space-y-1">
                  <span className="font-semibold text-foreground">{item.code}</span>
                  <p className="truncate text-sm text-muted-foreground">
                    {`${item.addressLine} ${item.houseNumber} · ${labelFor(DEPARTMENT_OPTIONS, item.departmentCode)}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNotice(null);
                    setEditing({ kind: "edit", item });
                  }}
                >
                  Editar
                </Button>
              </li>
            )
          )}
        </ul>
      ) : establishments ? (
        <EmptyState
          icon="building"
          title="Todavía no hay establecimientos"
          description="Agregá el local desde el que la clínica emite sus documentos."
        />
      ) : null}
    </section>
  );
}

interface EstablishmentErrors {
  code?: string;
  addressLine?: string;
  houseNumber?: string;
  district?: string;
  cityCode?: string;
  cityName?: string;
  phone?: string;
  email?: string;
  branchName?: string;
}

const EMAIL = /^[0-9a-zA-Z]([0-9a-zA-Z._-])*@([0-9a-zA-Z][0-9a-zA-Z_-]*\.)+[a-zA-Z]{2,9}$/;

function EstablishmentForm({
  title,
  initial,
  onCancel,
  onSave,
  onSaved,
}: {
  title: string;
  initial?: Establishment;
  onCancel: () => void;
  onSave: (input: EstablishmentInput) => Promise<Establishment>;
  onSaved: (item: Establishment) => void;
}): JSX.Element {
  const [code, setCode] = useState(initial?.code ?? "");
  const [addressLine, setAddressLine] = useState(initial?.addressLine ?? "");
  const [houseNumber, setHouseNumber] = useState(
    initial === undefined ? "" : String(initial.houseNumber)
  );
  const [complement1, setComplement1] = useState("");
  const [complement2, setComplement2] = useState("");
  const [departmentCode, setDepartmentCode] = useState(String(initial?.departmentCode ?? 1));
  const [districtCode, setDistrictCode] = useState(optionalText(initial?.districtCode));
  const [districtName, setDistrictName] = useState("");
  const [cityCode, setCityCode] = useState(initial === undefined ? "" : String(initial.cityCode));
  const [cityName, setCityName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [branchName, setBranchName] = useState("");
  const [errors, setErrors] = useState<EstablishmentErrors>({});

  const save = useMutation({ mutationFn: onSave, onSuccess: onSaved });

  function build(): EstablishmentInput | null {
    const next: EstablishmentErrors = {};
    if (!/^[0-9]{3}$/.test(code.trim())) next.code = "Tres dígitos, por ejemplo 001.";
    const address = addressLine.trim();
    if (address.length === 0 || address.length > 255) next.addressLine = "Escribí la dirección.";
    const house = parseWhole(houseNumber, 0, 999_999);
    if (house === null) next.houseNumber = "Un número (0 si no tiene).";
    const hasDistrict = districtCode.trim() !== "" || districtName.trim() !== "";
    const district = parseWhole(districtCode, 1, 9_999);
    const districtLabel = districtName.trim();
    if (
      hasDistrict &&
      (district === null || districtLabel.length === 0 || districtLabel.length > 30)
    )
      next.district = "Completá código y nombre del distrito, o dejá ambos vacíos.";
    const city = parseWhole(cityCode, 1, 99_999);
    if (city === null) next.cityCode = "El código de ciudad de la SET.";
    const cityLabel = cityName.trim();
    if (cityLabel.length === 0 || cityLabel.length > 30) next.cityName = "Escribí la ciudad.";
    const phoneValue = phone.trim();
    if (phoneValue.length < 6 || phoneValue.length > 15) next.phone = "Entre 6 y 15 caracteres.";
    const emailValue = email.trim();
    if (!EMAIL.test(emailValue)) next.email = "Escribí un correo válido.";
    const branch = blankToNull(branchName);
    if (branch !== null && branch.length > 30) next.branchName = "Hasta 30 caracteres.";
    setErrors(next);
    if (Object.keys(next).length > 0 || house === null || city === null) return null;
    return {
      code: code.trim(),
      addressLine: address,
      houseNumber: house,
      addressComplement1: blankToNull(complement1),
      addressComplement2: blankToNull(complement2),
      departmentCode: Number(departmentCode),
      district: hasDistrict && district !== null ? { code: district, name: districtLabel } : null,
      cityCode: city,
      cityName: cityLabel,
      phone: phoneValue,
      email: emailValue,
      branchName: branch,
    };
  }

  return (
    <form
      noValidate
      aria-label={title}
      aria-busy={save.isPending}
      className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const input = build();
        if (input !== null) save.mutate(input);
      }}
    >
      <h3 className="text-sm font-semibold sm:col-span-3">{title}</h3>
      {initial ? (
        <p className="text-xs text-muted-foreground sm:col-span-3">
          Se guardan todos los datos juntos: volvé a escribir ciudad, teléfono, correo y los campos
          opcionales, que no se muestran.
        </p>
      ) : null}
      <TextField
        label="Código"
        value={code}
        onChange={setCode}
        error={errors.code}
        inputMode="numeric"
        maxLength={3}
        placeholder="001"
      />
      <TextField
        label="Dirección"
        value={addressLine}
        onChange={setAddressLine}
        error={errors.addressLine}
        maxLength={255}
      />
      <TextField
        label="Número de casa"
        value={houseNumber}
        onChange={setHouseNumber}
        error={errors.houseNumber}
        inputMode="numeric"
        maxLength={6}
      />
      <TextField
        label="Complemento de dirección 1"
        value={complement1}
        onChange={setComplement1}
        optional
        maxLength={255}
      />
      <TextField
        label="Complemento de dirección 2"
        value={complement2}
        onChange={setComplement2}
        optional
        maxLength={255}
      />
      <SelectField
        label="Departamento"
        value={departmentCode}
        onChange={setDepartmentCode}
        options={DEPARTMENT_OPTIONS}
      />
      <TextField
        label="Código de distrito"
        value={districtCode}
        onChange={setDistrictCode}
        error={errors.district}
        optional
        inputMode="numeric"
        maxLength={4}
      />
      <TextField
        label="Distrito"
        value={districtName}
        onChange={setDistrictName}
        optional
        maxLength={30}
      />
      <TextField
        label="Código de ciudad"
        value={cityCode}
        onChange={setCityCode}
        error={errors.cityCode}
        inputMode="numeric"
        maxLength={5}
      />
      <TextField
        label="Ciudad"
        value={cityName}
        onChange={setCityName}
        error={errors.cityName}
        maxLength={30}
      />
      <TextField
        label="Teléfono"
        type="tel"
        value={phone}
        onChange={setPhone}
        error={errors.phone}
        maxLength={15}
      />
      <TextField
        label="Correo"
        type="email"
        value={email}
        onChange={setEmail}
        error={errors.email}
        maxLength={255}
      />
      <TextField
        label="Nombre de la sucursal"
        value={branchName}
        onChange={setBranchName}
        error={errors.branchName}
        optional
        maxLength={30}
      />
      {save.error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {fiscalSettingsErrorMessage(
            save.error,
            "No se pudo guardar el establecimiento. Intentá nuevamente."
          )}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={save.isPending}>
          Guardar establecimiento
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
