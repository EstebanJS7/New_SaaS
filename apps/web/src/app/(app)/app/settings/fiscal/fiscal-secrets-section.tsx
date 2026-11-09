"use client";

import { useId, useState, type FormEvent, type JSX } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Input } from "@newsaas/ui/components/ui/input";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { fiscalSettingsRequest, isFiscalPermissionDenied } from "./fiscal-settings-api";
import { SuccessNotice } from "./fiscal-form-field";
import { selectClassName, textareaClassName } from "./fiscal-settings-display";

interface SecretMetadata {
  id: string;
  environment: "TEST" | "PRODUCTION";
  status: "ACTIVE" | "RETIRED";
  idCsc?: string;
  certificateSubject?: string;
  certificateSerial?: string;
  notAfter?: string;
  createdAt: string;
  retiredAt: string | null;
}

/** Secrets use uncontrolled inputs, never React/query mutation state or persistent caches. */
export function FiscalSecretsSection({ kind }: { kind: "csc" | "signing-material" }): JSX.Element {
  const titleId = useId();
  const reasonId = useId();
  const formId = useId();
  const csc = kind === "csc";
  const title = csc ? "CSC" : "Certificado de firma";
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<SecretMetadata | null>(null);
  const [reason, setReason] = useState("");
  const records = useQuery({
    queryKey: ["fiscal-settings", kind],
    retry: false,
    queryFn: () => fiscalSettingsRequest<{ items: SecretMetadata[] }>(kind),
  });
  const retire = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fiscalSettingsRequest(`${kind}/${id}/retire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      setRetiring(null);
      setNotice("Se retiró el material fiscal.");
      void records.refetch();
    },
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const fileElement = form.elements.namedItem("file");
    if (fileElement instanceof HTMLInputElement && fileElement.files?.[0])
      data.set("file", fileElement.files[0]);
    // Clear even on rejection. Only this local request owns the submitted secret.
    form.reset();
    const fileInput = form.elements.namedItem("file");
    if (fileInput instanceof HTMLInputElement) fileInput.value = "";
    setNotice(null);
    setError(null);
    const environment = data.get("environment");
    if (environment !== "TEST" && environment !== "PRODUCTION") {
      setError("Seleccioná un ambiente válido.");
      return;
    }
    const value = data.get("value");
    const idCsc = data.get("idCsc");
    const file = data.get("file");
    if (
      csc
        ? typeof idCsc !== "string" ||
          !/^[A-Za-z0-9]{4}$/.test(idCsc) ||
          typeof value !== "string" ||
          !/^[A-Za-z0-9]{32}$/.test(value)
        : !(file instanceof File) || file.size === 0 || file.size > 65_536
    ) {
      setError(
        csc
          ? "Ingresá el identificador de 4 caracteres y el CSC de 32 caracteres alfanuméricos."
          : "Seleccioná un archivo PKCS#12 de hasta 64 KiB."
      );
      return;
    }
    setPending(true);
    try {
      await fiscalSettingsRequest(
        kind,
        csc
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ environment, idCsc, value }),
            }
          : { method: "POST", body: data }
      );
      setNotice(csc ? "Se guardó el CSC." : "Se guardó el certificado de firma.");
      void records.refetch();
    } catch {
      setError(
        "No se pudo guardar el material fiscal. Revisá los datos y los permisos; si hay un CSC activo con ese identificador, retirá el anterior antes de cargarlo."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-5">
      <h2 id={titleId} className="text-base font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">
        {csc
          ? "El código de seguridad del contribuyente se guarda cifrado y nunca se vuelve a mostrar. Hasta dos activos por ambiente."
          : "Subí el certificado PKCS#12 del contribuyente. La contraseña no se guarda; una carga reemplaza el certificado activo del mismo ambiente."}
      </p>
      <SuccessNotice message={notice} />
      {records.isLoading ? (
        <ListSkeleton label={`Cargando ${title}…`} rows={1} />
      ) : records.error ? (
        isFiscalPermissionDenied(records.error) ? (
          <p>No tenés permiso para gestionar este material fiscal.</p>
        ) : (
          <ErrorState
            message="No se pudo cargar el material fiscal."
            onRetry={() => void records.refetch()}
          />
        )
      ) : (
        <>
          {records.data?.items.length ? (
            <ul aria-label={`${title}: metadatos`} className="space-y-2">
              {records.data.items.map((row) => (
                <li key={row.id} className="record-row">
                  <div>
                    <p>
                      {csc ? row.idCsc : row.certificateSubject} ·{" "}
                      {row.environment === "TEST" ? "Pruebas" : "Producción"} ·{" "}
                      {row.status === "ACTIVE" ? "Activo" : "Retirado"}
                    </p>
                    {!csc ? (
                      <p className="text-sm text-muted-foreground">
                        Serie {row.certificateSerial} · Vence {row.notAfter?.slice(0, 10)}
                      </p>
                    ) : null}
                  </div>
                  {row.status === "ACTIVE" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        retire.reset();
                        setRetiring(row);
                        setReason("");
                      }}
                    >
                      Retirar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="shield"
              title={csc ? "Todavía no hay CSC" : "Todavía no hay certificado"}
              description="Cargá el material del contribuyente para emitir documentos electrónicos."
            />
          )}
          <form
            aria-label={csc ? "Cargar CSC" : "Subir certificado"}
            className="space-y-3"
            onSubmit={(event) => void submit(event)}
          >
            <label htmlFor={`${formId}-environment`}>Ambiente</label>
            <select
              id={`${formId}-environment`}
              name="environment"
              className={selectClassName}
              defaultValue="TEST"
              disabled={pending}
            >
              <option value="TEST">Pruebas</option>
              <option value="PRODUCTION">Producción</option>
            </select>
            {csc ? (
              <>
                <label htmlFor={`${formId}-id`}>Identificador CSC</label>
                <Input
                  id={`${formId}-id`}
                  name="idCsc"
                  maxLength={4}
                  required
                  autoComplete="off"
                  disabled={pending}
                />
                <label htmlFor={`${formId}-value`}>Valor del CSC</label>
                <Input
                  id={`${formId}-value`}
                  name="value"
                  type="password"
                  maxLength={32}
                  required
                  autoComplete="new-password"
                  disabled={pending}
                />
              </>
            ) : (
              <>
                <label htmlFor={`${formId}-file`}>Archivo PKCS#12</label>
                <Input
                  id={`${formId}-file`}
                  name="file"
                  type="file"
                  accept=".p12,.pfx"
                  required
                  disabled={pending}
                />
                <label htmlFor={`${formId}-password`}>Contraseña del certificado</label>
                <Input
                  id={`${formId}-password`}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  disabled={pending}
                />
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : csc ? "Cargar CSC" : "Subir certificado"}
            </Button>
          </form>
        </>
      )}
      <ConfirmActionDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null);
        }}
        title={`¿Retirar ${csc ? "el CSC" : "el certificado"}?`}
        description="El secreto se elimina y queda el registro del retiro. Esta operación no se puede deshacer."
        confirmLabel="Retirar material"
        confirmDisabled={!reason.trim()}
        pending={retire.isPending}
        errorMessage={retire.error ? "No se pudo retirar el material fiscal." : undefined}
        onConfirm={() =>
          retiring ? retire.mutateAsync({ id: retiring.id, reason: reason.trim() }) : undefined
        }
      >
        <label htmlFor={reasonId}>Motivo</label>
        <textarea
          id={reasonId}
          className={textareaClassName}
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmActionDialog>
    </section>
  );
}
