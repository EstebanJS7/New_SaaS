"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@newsaas/ui/components/ui/button";

/** A native modal keeps focus inside, restores it to the trigger, and closes on Escape. */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Volver",
  pendingLabel = "Guardando…",
  confirmVariant = "destructive",
  confirmDisabled = false,
  errorMessage,
  pending = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  confirmVariant?: "default" | "destructive";
  confirmDisabled?: boolean;
  errorMessage?: string;
  pending?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<unknown>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [confirming, setConfirming] = useState(false);
  const busy = pending || confirming;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } else if (!open && dialog.open && !busy) {
      dialog.close();
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
      triggerRef.current = null;
    } else if (open && busy && !dialog.contains(document.activeElement)) {
      dialog.focus();
    }
  }, [busy, open]);

  async function confirm(): Promise<void> {
    setConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller supplies the authoritative, sanitized error copy.
    } finally {
      setConfirming(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          ),
        ].filter((element) => {
          const style = window.getComputedStyle(element);
          return (
            element.tabIndex >= 0 &&
            !element.closest("[hidden], [inert]") &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (first === undefined || last === undefined) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClose={() => {
        if (!busy) onOpenChange(false);
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false);
      }}
      className="m-auto w-[min(92vw,34rem)] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-foreground/40"
    >
      <div className="space-y-5 p-6">
        <div className="space-y-2">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          {children}
        </div>
        {open && errorMessage ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            loading={busy}
            disabled={confirmDisabled}
            onClick={() => void confirm()}
          >
            {busy ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
