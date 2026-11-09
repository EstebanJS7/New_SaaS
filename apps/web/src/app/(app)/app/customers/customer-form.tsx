"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  FISCAL_OPERATION_TYPES,
  customerError,
  customerWriteBlocked,
  type Customer,
  type FiscalOperationType,
} from "./customers-api";
import { CustomerField, useCustomerExit, useCustomerValidation } from "./customer-form-interaction";
interface CustomerFormValues {
  kind: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  legalName: string;
  taxId: string;
  /** Empty string is the form's "not declared" choice; the wire uses omission/null. */
  fiscalOperationType: "" | FiscalOperationType;
}

function emptyValues(): CustomerFormValues {
  return {
    kind: "INDIVIDUAL",
    displayName: "",
    firstName: "",
    lastName: "",
    documentNumber: "",
    legalName: "",
    taxId: "",
    fiscalOperationType: "",
  };
}

function customerToValues(customer: Customer): CustomerFormValues {
  return {
    kind: customer.kind,
    displayName: customer.displayName,
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    documentNumber: customer.documentNumber ?? "",
    legalName: customer.legalName ?? "",
    taxId: customer.taxId ?? "",
    fiscalOperationType: customer.fiscalOperationType ?? "",
  };
}

function buildCreateBody(values: CustomerFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: values.kind,
    displayName: values.displayName.trim(),
  };

  if (values.kind === "INDIVIDUAL") {
    const firstName = values.firstName.trim();
    const lastName = values.lastName.trim();
    const documentNumber = values.documentNumber.trim();
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;
    if (documentNumber) body.documentNumber = documentNumber;
  } else {
    body.legalName = values.legalName.trim();
    body.taxId = values.taxId.trim();
  }

  // "Sin declarar" sends nothing: the create must not invent a declaration.
  if (values.fiscalOperationType) body.fiscalOperationType = values.fiscalOperationType;

  return body;
}

function buildUpdateBody(values: CustomerFormValues, customer: Customer): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const displayName = values.displayName.trim();

  if (displayName !== customer.displayName) {
    body.displayName = displayName;
  }

  if (customer.kind === "INDIVIDUAL") {
    const firstName = values.firstName.trim();
    const lastName = values.lastName.trim();
    const documentNumber = values.documentNumber.trim();
    if (firstName && firstName !== (customer.firstName ?? "")) body.firstName = firstName;
    if (lastName && lastName !== (customer.lastName ?? "")) body.lastName = lastName;
    if (documentNumber && documentNumber !== (customer.documentNumber ?? "")) {
      body.documentNumber = documentNumber;
    }
  } else {
    const legalName = values.legalName.trim();
    const taxId = values.taxId.trim();
    if (legalName && legalName !== (customer.legalName ?? "")) body.legalName = legalName;
    if (taxId && taxId !== (customer.taxId ?? "")) body.taxId = taxId;
  }

  // Omission preserves the stored declaration; only an explicit change is sent,
  // and "Sin declarar" sends `null` (the intentional undeclared state).
  const fiscalOperationType = values.fiscalOperationType || null;
  if (fiscalOperationType !== (customer.fiscalOperationType ?? null)) {
    body.fiscalOperationType = fiscalOperationType;
  }

  return body;
}

export function CustomerForm({
  customer,
  onSubmit,
  isPending,
  error,
}: {
  customer?: Customer;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  isPending: boolean;
  error: Error | null;
}) {
  const router = useRouter();
  const [initialValues] = useState(() => (customer ? customerToValues(customer) : emptyValues()));
  const [values, setValues] = useState(initialValues);
  const validation = useCustomerValidation();
  const exit = useCustomerExit(
    isPending || JSON.stringify(values) !== JSON.stringify(initialValues)
  );
  const blocked = isPending || customerWriteBlocked(error);
  const fields =
    values.kind === "INDIVIDUAL"
      ? [
          { key: "firstName", label: "Nombres", limit: 100 },
          { key: "lastName", label: "Apellidos", limit: 100 },
          { key: "documentNumber", label: "Número de documento", limit: 50 },
        ]
      : [
          { key: "legalName", label: "Razón social", limit: 200 },
          { key: "taxId", label: "RUC", limit: 32 },
        ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{customer ? "Editar cliente" : "Nuevo cliente"}</CardTitle>
        <CardDescription>
          {customer
            ? "Actualizá los datos del cliente. El tipo no se puede cambiar."
            : "Registrá una persona o empresa. Los campos obligatorios están indicados."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-destructive p-3 text-sm">
            {customerError(error)}
          </p>
        )}
        <form
          noValidate
          onChange={(event) => {
            if (event.target instanceof HTMLInputElement) validation.clear(event.target.id);
          }}
          onSubmit={(event) =>
            void validation.submit(
              event,
              () =>
                onSubmit(customer ? buildUpdateBody(values, customer) : buildCreateBody(values)),
              blocked
            )
          }
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="kind" className="text-sm font-medium">
              Tipo de cliente
            </label>
            <select
              id="kind"
              value={values.kind}
              disabled={Boolean(customer) || blocked}
              onChange={(e) =>
                setValues({
                  ...values,
                  kind: e.target.value === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
                })
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="INDIVIDUAL">Persona</option>
              <option value="COMPANY">Empresa</option>
            </select>
          </div>
          <CustomerField
            id="displayName"
            label="Nombre visible"
            limit={200}
            required
            disabled={blocked}
            value={values.displayName}
            onChange={(e) => setValues({ ...values, displayName: e.target.value })}
            error={validation.errors.displayName}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => {
              const key = field.key as keyof CustomerFormValues;
              return (
                <CustomerField
                  key={key}
                  id={key}
                  label={field.label}
                  limit={field.limit}
                  required={values.kind === "COMPANY"}
                  disabled={blocked}
                  value={values[key]}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  error={validation.errors[key]}
                />
              );
            })}
          </div>
          <div className="space-y-2">
            <label htmlFor="fiscalOperationType" className="text-sm font-medium">
              Tipo de operación fiscal (iTiOpe)
            </label>
            <select
              id="fiscalOperationType"
              value={values.fiscalOperationType}
              disabled={blocked}
              onChange={(e) =>
                setValues({
                  ...values,
                  fiscalOperationType: e.target.value as "" | FiscalOperationType,
                })
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sin declarar</option>
              {FISCAL_OPERATION_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Se declara por cliente y no se deduce de su tipo. Sin declararlo, la emisión
              electrónica rechaza a este cliente en lugar de suponer una operación.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Los cambios sin guardar se conservan solo mientras este formulario está abierto.
            Recargar o volver a ingresar no los recupera.
          </p>
          {customer && (
            <p className="text-xs text-muted-foreground">
              Dejar vacío un dato opcional no borra el valor guardado.
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" loading={isPending} disabled={blocked}>
              {isPending ? "Guardando…" : customer ? "Guardar cambios" : "Crear cliente"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => exit.leave(() => router.back())}
            >
              Cancelar
            </Button>
          </div>
        </form>
        {exit.dialog}
      </CardContent>
    </Card>
  );
}
