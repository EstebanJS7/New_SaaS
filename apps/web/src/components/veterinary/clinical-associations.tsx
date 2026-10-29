"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { getClinicalLinks, linkClinicalRecord } from "@/app/(app)/app/patients/[id]/clinical-api";
import { listSales } from "@/app/(app)/app/sales/sales-api";
import { formatEsPyInstant } from "@/lib/es-py-format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ClinicalAssociations({
  patientId,
  encounterId,
  appointmentId,
  currentSaleId,
  inPOS = false,
}: {
  patientId: string;
  encounterId: string;
  appointmentId?: string;
  currentSaleId?: string;
  inPOS?: boolean;
}) {
  const client = useQueryClient();
  const valid = UUID.test(patientId) && UUID.test(encounterId);
  const key = ["clinical-links", patientId, encounterId];
  const links = useQuery({
    queryKey: key,
    queryFn: () => getClinicalLinks(patientId, encounterId),
    enabled: valid,
    retry: false,
  });
  const [saleId, setSaleId] = useState("");
  const [chooseSale, setChooseSale] = useState(false);
  const [target, setTarget] = useState<{ appointmentId: string } | { saleId: string } | null>(null);
  const sales = useQuery({
    queryKey: ["sales", "link-options"],
    queryFn: () => listSales({ status: "DRAFT" }),
    enabled: chooseSale && links.data?.canReadSales === true,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (value: { appointmentId: string } | { saleId: string }) =>
      linkClinicalRecord(patientId, encounterId, value),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
      await client.invalidateQueries({ queryKey: ["clinical-appointment-encounters", patientId] });
    },
  });
  if (!valid || links.isError)
    return (
      <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        No pudimos consultar los vínculos de esta atención. Revisá el acceso o volvé a intentar
        antes de asociar registros.
      </p>
    );
  if (!links.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando vínculos de atención…
      </p>
    );
  const data = links.data;
  return (
    <section
      aria-label="Vínculos de atención"
      className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4"
    >
      <h3 className="font-semibold">Vínculos de esta atención</h3>
      <p className="text-xs text-muted-foreground">
        Vincular conserva una relación en el historial. No modifica la consulta, completa el turno
        ni cobra una venta. Un vínculo existente no se reemplaza.
      </p>
      {data.canReadAppointments ? (
        <p className="text-sm">
          {data.appointmentId
            ? `Cita vinculada #${data.appointmentId.slice(0, 8)}`
            : "Sin cita vinculada"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No tenés acceso a los vínculos de agenda.</p>
      )}
      {appointmentId && data.appointmentId && appointmentId !== data.appointmentId && (
        <p role="alert" className="text-sm text-destructive">
          Esta consulta ya está vinculada a otra cita. Revisá el origen antes de continuar; el
          vínculo no se reemplazará.
        </p>
      )}
      {appointmentId &&
        UUID.test(appointmentId) &&
        data.canReadAppointments &&
        !data.appointmentId && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              mutation.reset();
              setTarget({ appointmentId });
            }}
          >
            Vincular esta consulta a la cita de origen
          </Button>
        )}
      {data.canReadSales ? (
        <>
          {data.sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay ventas vinculadas.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.sales.map((sale) => (
                <li key={sale.id}>
                  <Link className="text-primary underline" href={`/app/sales/${sale.id}`}>
                    Abrir venta #{sale.id.slice(0, 8)}
                  </Link>{" "}
                  ·{" "}
                  {sale.status === "DRAFT"
                    ? "Borrador pendiente"
                    : sale.status === "COMPLETED"
                      ? "Completada"
                      : "Cancelada"}
                </li>
              ))}
            </ul>
          )}
          {currentSaleId && !data.sales.some((sale) => sale.id === currentSaleId) && (
            <Button
              type="button"
              onClick={() => {
                mutation.reset();
                setTarget({ saleId: currentSaleId });
              }}
            >
              Vincular esta venta a la consulta
            </Button>
          )}
          {!inPOS && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setChooseSale((value) => !value)}
              >
                Elegir un borrador de venta existente
              </Button>
              {chooseSale && (
                <div className="flex flex-wrap gap-2">
                  <label className="w-full text-sm" htmlFor={`sale-link-${encounterId}`}>
                    Borrador a vincular
                  </label>
                  <select
                    id={`sale-link-${encounterId}`}
                    className="min-h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={saleId}
                    onChange={(event) => setSaleId(event.target.value)}
                    disabled={sales.isPending || sales.isError}
                  >
                    <option value="">Elegí un borrador</option>
                    {sales.data?.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        #{sale.id.slice(0, 8)} · {formatEsPyInstant(sale.createdAt)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    disabled={!saleId || sales.isError}
                    onClick={() => {
                      mutation.reset();
                      setTarget({ saleId });
                    }}
                  >
                    Vincular borrador
                  </Button>
                  {sales.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      No pudimos consultar las ventas disponibles.
                    </p>
                  )}
                  {sales.isSuccess && sales.data.length === 0 && (
                    <p className="text-sm">No hay borradores disponibles.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No tenés acceso a los vínculos de venta.</p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-sm text-status-success">
          Vínculo confirmado por el servidor.
        </p>
      )}
      <ConfirmActionDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title="Confirmar vínculo"
        description="Se guardará esta asociación en el historial. Si ya existe el mismo vínculo, no se duplicará. No se realizará ningún cobro ni cambio de estado."
        confirmLabel="Confirmar vínculo"
        confirmVariant="default"
        pending={mutation.isPending}
        errorMessage={
          mutation.isError
            ? "No pudimos vincular los registros. Comprobá permisos, organización y que no exista otro vínculo de origen."
            : undefined
        }
        onConfirm={async () => {
          if (target) await mutation.mutateAsync(target);
        }}
      />
    </section>
  );
}
