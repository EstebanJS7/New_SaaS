"use client";
import { useRef, useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import type { ClinicalRecordCopy, ClinicalRecordRecovery } from "./clinical-record-recovery";
import { ClinicalRecordRecoveryPanel } from "./clinical-record-recovery-panel";
import {
  saveServerDraft,
  searchServerDrafts,
  readServerDraft,
  discardServerDraft,
  draftMessage,
  draftReference,
  serverDraftRecovery,
  type DurableDraftRef,
  type ServerClinicalDraft,
} from "./clinical-server-drafts-api";

export function useServerClinicalDraft(patient: string, copy: ClinicalRecordCopy) {
  const [reference, setReference] = useState<DurableDraftRef | undefined>(copy.fields.durable);
  const newId = useRef<string | undefined>(undefined);
  const [saving, setSaving] = useState(false),
    [notice, setNotice] = useState<string>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const locked = Boolean(copy.fields.creation?.command);
  const busy = useRef(false);
  async function save() {
    if (busy.current || locked) return;
    busy.current = true;
    setSaving(true);
    setUnconfirmed(true);
    setNotice(undefined);
    newId.current ??= crypto.randomUUID();
    try {
      const item = await saveServerDraft(
        patient,
        reference?.id ?? newId.current,
        reference?.version ?? 0,
        copy
      );
      setReference(draftReference(item));
      setUnconfirmed(false);
      setNotice(
        "Borrador guardado en el servidor. Solo vos podés recuperarlo; los cambios posteriores requieren otro guardado manual."
      );
    } catch (error) {
      setNotice(draftMessage(error));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return { reference, saving, blocked: saving || unconfirmed, locked, notice, save };
}
export function ClinicalDraftSave({
  draft,
  disabled,
}: {
  draft: ReturnType<typeof useServerClinicalDraft>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || draft.saving || draft.locked}
        onClick={() => {
          void draft.save();
        }}
      >
        {draft.saving ? "Guardando borrador…" : "Guardar borrador"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Guardado manual y privado en el servidor. Completar o descartar retira la copia de la lista;
        no borra su contenido.
      </p>
      {draft.notice && (
        <p role="status" className="text-sm">
          {draft.notice}
        </p>
      )}
    </div>
  );
}
export function ClinicalServerDrafts({
  patientId,
  kind,
  onRecover,
}: {
  patientId: string;
  kind: ClinicalRecordCopy["kind"];
  onRecover: (copy: ClinicalRecordRecovery) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [items, setItems] = useState<ServerClinicalDraft[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  async function load(before?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await searchServerDrafts(patientId, kind, before);
      setItems(result.items);
      setCursor(result.nextCursor);
    } catch (failure) {
      setItems([]);
      setError(draftMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Borradores privados guardados" className="space-y-3">
      <Button
        variant="outline"
        type="button"
        disabled={busy}
        onClick={() => {
          if (!open) {
            setOpen(true);
            void load();
          } else setOpen(false);
        }}
      >
        {open ? "Ocultar borradores guardados" : "Borradores guardados"}
      </Button>
      {open && (
        <>
          <p className="text-sm text-muted-foreground">
            Solo se muestran tus copias guardadas manualmente para este paciente. Recuperar no
            registra ni corrige datos clínicos.
          </p>
          {busy && <p role="status">Consultando borradores…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && !error && items.length === 0 && (
            <p>No tenés borradores guardados de este tipo.</p>
          )}
          {!busy &&
            items.map((item) => (
              <ClinicalRecordRecoveryPanel
                key={item.id + ":" + item.version}
                patientId={patientId}
                entry={serverDraftRecovery(item)}
                onRecover={() => {
                  setBusy(true);
                  void readServerDraft(patientId, item.id)
                    .then((fresh) => {
                      if (fresh.version !== item.version || fresh.state !== item.state)
                        throw Error("Draft changed");
                      onRecover(serverDraftRecovery(fresh));
                    })
                    .catch((failure) => {
                      setItems([]);
                      setError(draftMessage(failure));
                    })
                    .finally(() => setBusy(false));
                }}
                onDiscard={async () => {
                  await discardServerDraft(patientId, draftReference(item));
                  await load();
                }}
              />
            ))}
          {!busy && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void load();
                }}
              >
                Actualizar borradores
              </Button>
              {cursor && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void load(cursor);
                  }}
                >
                  Más borradores
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
