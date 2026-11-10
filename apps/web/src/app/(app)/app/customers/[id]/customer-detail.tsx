"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@newsaas/ui/components/ui/card";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { ErrorState, ListSkeleton } from "@/components/feedback";
import {
  CustomerField,
  useCustomerValidation,
  useCustomerExit,
} from "../customer-form-interaction";
import {
  createAddress,
  createContact,
  deactivateAddress,
  deactivateContact,
  deactivateCustomer,
  getCustomer,
  listAddresses,
  listContacts,
  customerError,
  customerWriteBlocked,
  fiscalOperationTypeLabel,
  type CustomerAddress,
  type CustomerContact,
} from "../customers-api";
import { canUse, useCapabilities } from "@/lib/capabilities";
import { CUSTOMER_ACTIONS, CustomersNoAccess } from "../customer-capabilities";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
const emptyAddress = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  countryCode: "",
};
function AddAddressForm({
  customerId,
  onDirty,
}: {
  customerId: string;
  onDirty: (value: boolean) => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState(emptyAddress);
  const [success, setSuccess] = useState(false);
  const validation = useCustomerValidation();
  useEffect(
    () => onDirty(JSON.stringify(values) !== JSON.stringify(emptyAddress)),
    [values, onDirty]
  );
  const mutation = useMutation({
    retry: false,
    mutationFn: () =>
      createAddress(customerId, {
        label: values.label.trim() || undefined,
        line1: values.line1.trim(),
        line2: values.line2.trim() || undefined,
        city: values.city.trim() || undefined,
        state: values.state.trim() || undefined,
        postalCode: values.postalCode.trim() || undefined,
        countryCode: values.countryCode.trim() || undefined,
      }),
    onSuccess: () => {
      setValues(emptyAddress);
      setSuccess(true);
      void client.invalidateQueries({ queryKey: ["customers", customerId, "addresses"] });
    },
  });
  const blocked = mutation.isPending || customerWriteBlocked(mutation.error);
  const fields = [
    { key: "label", label: "Etiqueta de dirección", limit: 100 },
    { key: "line1", label: "Dirección", limit: 200 },
    { key: "line2", label: "Complemento", limit: 200 },
    { key: "city", label: "Ciudad", limit: 100 },
    { key: "state", label: "Departamento o estado", limit: 100 },
    { key: "postalCode", label: "Código postal", limit: 20 },
    { key: "countryCode", label: "Código de país", limit: 2 },
  ];
  return (
    <form
      noValidate
      onChange={(event) => {
        if (event.target instanceof HTMLInputElement) validation.clear(event.target.id);
      }}
      className="space-y-3"
      onSubmit={(e) => void validation.submit(e, () => mutation.mutateAsync(), blocked)}
    >
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {customerError(mutation.error)}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-status-success">
          Dirección agregada.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const key = field.key as keyof typeof values;
          const id = "address-" + key;
          return (
            <CustomerField
              key={key}
              id={id}
              label={field.label}
              limit={field.limit}
              exact={key === "countryCode"}
              required={key === "line1"}
              disabled={blocked}
              value={values[key]}
              error={validation.errors[id]}
              onChange={(e) => {
                setSuccess(false);
                setValues({ ...values, [key]: e.target.value });
              }}
            />
          );
        })}
      </div>
      <Button type="submit" loading={mutation.isPending} disabled={blocked}>
        Agregar dirección
      </Button>
    </form>
  );
}
const emptyContact = { kind: "EMAIL" as "EMAIL" | "PHONE", label: "", value: "", isPrimary: false };
function AddContactForm({
  customerId,
  onDirty,
}: {
  customerId: string;
  onDirty: (value: boolean) => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState(emptyContact);
  const [success, setSuccess] = useState(false);
  const validation = useCustomerValidation();
  useEffect(
    () => onDirty(JSON.stringify(values) !== JSON.stringify(emptyContact)),
    [values, onDirty]
  );
  const mutation = useMutation({
    retry: false,
    mutationFn: () =>
      createContact(customerId, {
        kind: values.kind,
        label: values.label.trim() || undefined,
        value: values.value.trim(),
        isPrimary: values.isPrimary,
      }),
    onSuccess: () => {
      setValues(emptyContact);
      setSuccess(true);
      void client.invalidateQueries({ queryKey: ["customers", customerId, "contacts"] });
    },
  });
  const blocked = mutation.isPending || customerWriteBlocked(mutation.error);
  return (
    <form
      noValidate
      onChange={(event) => {
        if (event.target instanceof HTMLInputElement) validation.clear(event.target.id);
      }}
      className="space-y-3"
      onSubmit={(e) => void validation.submit(e, () => mutation.mutateAsync(), blocked)}
    >
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {customerError(mutation.error)}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-status-success">
          Contacto agregado.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="contact-kind" className="text-sm font-medium">
            Tipo de contacto
          </label>
          <select
            id="contact-kind"
            value={values.kind}
            disabled={blocked}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            onChange={(e) => {
              setSuccess(false);
              setValues({ ...values, kind: e.target.value === "PHONE" ? "PHONE" : "EMAIL" });
            }}
          >
            <option value="EMAIL">Correo electrónico</option>
            <option value="PHONE">Teléfono</option>
          </select>
        </div>
        <CustomerField
          id="contact-label"
          label="Etiqueta del contacto"
          limit={100}
          disabled={blocked}
          value={values.label}
          error={validation.errors["contact-label"]}
          onChange={(e) => {
            setSuccess(false);
            setValues({ ...values, label: e.target.value });
          }}
        />
        <CustomerField
          id="contact-value"
          label={values.kind === "EMAIL" ? "Correo electrónico" : "Teléfono"}
          limit={255}
          required
          disabled={blocked}
          value={values.value}
          error={validation.errors["contact-value"]}
          onChange={(e) => {
            setSuccess(false);
            setValues({ ...values, value: e.target.value });
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={blocked}
            checked={values.isPrimary}
            onChange={(e) => {
              setSuccess(false);
              setValues({ ...values, isPrimary: e.target.checked });
            }}
          />
          Contacto principal
        </label>
      </div>
      <Button type="submit" loading={mutation.isPending} disabled={blocked}>
        Agregar contacto
      </Button>
    </form>
  );
}
function Deactivate({
  kind,
  id,
  customerId,
  inactive,
}: {
  kind: "cliente" | "dirección" | "contacto";
  id: string;
  customerId: string;
  inactive: boolean;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useMutation({
    retry: false,
    mutationFn: (): Promise<{ id: string }> =>
      kind === "cliente"
        ? deactivateCustomer(id)
        : kind === "dirección"
          ? deactivateAddress(customerId, id)
          : deactivateContact(customerId, id),
    onSuccess: () => {
      setConfirmed(true);
      void client.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={inactive || mutation.isPending || customerWriteBlocked(mutation.error)}
        onClick={() => setOpen(true)}
      >
        Desactivar {kind}
      </Button>
      {confirmed && (
        <p role="status" className="text-sm text-status-success">
          Desactivación confirmada.
        </p>
      )}
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={"Desactivar " + kind}
        description="El registro dejará de estar activo. Sus datos se conservarán."
        confirmLabel={"Desactivar " + kind}
        pendingLabel="Desactivando…"
        pending={mutation.isPending}
        confirmDisabled={customerWriteBlocked(mutation.error)}
        errorMessage={mutation.error ? customerError(mutation.error) : undefined}
        onConfirm={() => mutation.mutateAsync()}
      />
    </div>
  );
}
function AddressSection({
  customerId,
  onDirty,
  canManage = true,
}: {
  customerId: string;
  onDirty: (value: boolean) => void;
  canManage?: boolean;
}) {
  const query = useQuery({
    queryKey: ["customers", customerId, "addresses"],
    queryFn: () => listAddresses(customerId),
    retry: false,
  });
  return (
    <Section
      title="Direcciones"
      description="Direcciones de facturación, envío y otras referencias del cliente."
    >
      {!query.error && canManage && <AddAddressForm customerId={customerId} onDirty={onDirty} />}
      {query.isLoading ? (
        <ListSkeleton label="Cargando direcciones…" rows={1} />
      ) : query.error ? (
        <ErrorState message={customerError(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene direcciones registradas.
        </p>
      ) : (
        query.data?.map((address: CustomerAddress) => (
          <div
            key={address.id}
            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1 break-words text-sm">
              <p className="font-medium">{address.label ?? "Dirección"}</p>
              <p>
                {[
                  address.line1,
                  address.line2,
                  address.city,
                  address.state,
                  address.postalCode,
                  address.countryCode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              {!address.isActive && <p>Inactiva</p>}
            </div>
            {canManage && (
              <Deactivate
                kind="dirección"
                id={address.id}
                customerId={customerId}
                inactive={!address.isActive}
              />
            )}
          </div>
        ))
      )}
    </Section>
  );
}
function ContactSection({
  customerId,
  onDirty,
  canManage = true,
}: {
  customerId: string;
  onDirty: (value: boolean) => void;
  canManage?: boolean;
}) {
  const query = useQuery({
    queryKey: ["customers", customerId, "contacts"],
    queryFn: () => listContacts(customerId),
    retry: false,
  });
  return (
    <Section title="Contactos" description="Correos y teléfonos registrados para este cliente.">
      {!query.error && canManage && <AddContactForm customerId={customerId} onDirty={onDirty} />}
      {query.isLoading ? (
        <ListSkeleton label="Cargando contactos…" rows={1} />
      ) : query.error ? (
        <ErrorState message={customerError(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene contactos registrados.
        </p>
      ) : (
        query.data?.map((contact: CustomerContact) => (
          <div
            key={contact.id}
            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1 break-all text-sm">
              <p className="font-medium">
                {contact.label ?? (contact.kind === "EMAIL" ? "Correo electrónico" : "Teléfono")}
                {contact.isPrimary && (
                  <span className="ml-2 rounded bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                    Principal
                  </span>
                )}
              </p>
              <p>{contact.value}</p>
              {!contact.isActive && <p>Inactivo</p>}
            </div>
            {canManage && (
              <Deactivate
                kind="contacto"
                id={contact.id}
                customerId={customerId}
                inactive={!contact.isActive}
              />
            )}
          </div>
        ))
      )}
    </Section>
  );
}
export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [addressDirty, setAddressDirty] = useState(false),
    [contactDirty, setContactDirty] = useState(false);
  const exit = useCustomerExit(addressDirty || contactDirty);
  // UX-037: the shell's capabilities decide which actions are offered.
  const capabilities = useCapabilities();
  const canRead = canUse(capabilities, CUSTOMER_ACTIONS.read);
  const query = useQuery({
    queryKey: ["customers", id],
    queryFn: () => getCustomer(id),
    retry: false,
    enabled: canRead,
  });
  if (!canRead) return <CustomersNoAccess />;
  if (query.isLoading) return <ListSkeleton label="Cargando cliente…" />;
  if (query.error)
    return <ErrorState message={customerError(query.error)} onRetry={() => void query.refetch()} />;
  const customer = query.data;
  if (!customer) return <p>No encontramos el cliente.</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 break-words">
              <h1 className="text-2xl font-semibold tracking-tight">{customer.displayName}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {customer.kind === "COMPANY" ? "Empresa" : "Persona"} ·{" "}
                {customer.isActive ? "Activo" : "Inactivo"}
              </p>
              {customer.kind === "COMPANY" ? (
                <>
                  <p>{customer.legalName}</p>
                  <p>RUC: {customer.taxId}</p>
                </>
              ) : (
                <>
                  <p>{[customer.firstName, customer.lastName].filter(Boolean).join(" ")}</p>
                  {customer.documentNumber && <p>Documento: {customer.documentNumber}</p>}
                </>
              )}
              <p>
                Tipo de operación fiscal: {fiscalOperationTypeLabel(customer.fiscalOperationType)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canUse(capabilities, CUSTOMER_ACTIONS.update) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => exit.leave(() => router.push(`/app/customers/${id}/edit`))}
                >
                  Editar cliente
                </Button>
              )}
              {canUse(capabilities, CUSTOMER_ACTIONS.deactivate) && (
                <Deactivate kind="cliente" id={id} customerId={id} inactive={!customer.isActive} />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <AddressSection
        customerId={id}
        onDirty={setAddressDirty}
        canManage={canUse(capabilities, CUSTOMER_ACTIONS.manageAddresses)}
      />
      <ContactSection
        customerId={id}
        onDirty={setContactDirty}
        canManage={canUse(capabilities, CUSTOMER_ACTIONS.manageContacts)}
      />
      <p className="text-xs text-muted-foreground">
        Los formularios sin guardar se perderán al recargar, salir o volver a ingresar. No se
        guardan automáticamente.
      </p>
      {exit.dialog}
    </div>
  );
}
