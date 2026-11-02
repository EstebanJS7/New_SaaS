"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

/** POS working copy only. Does not patch history or persist transaction data. */
export function useCounterExit(dirty: boolean, pending: boolean, uncertain: boolean) {
  const router = useRouter();
  const state = useRef({ dirty, pending, uncertain });
  state.current = { dirty, pending, uncertain };
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!state.current.dirty && !state.current.pending && !state.current.uncertain) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        (!state.current.dirty && !state.current.pending && !state.current.uncertain) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(url.href);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, []);
  return (
    <ConfirmActionDialog
      open={destination !== null}
      onOpenChange={(open) => {
        if (!open) setDestination(null);
      }}
      title={pending ? "Hay una operación pendiente" : "¿Salir del punto de venta?"}
      description={
        pending
          ? "Esperá el resultado antes de salir. Cerrar la pantalla no cancela una operación enviada."
          : uncertain
            ? "No confirmamos el resultado del intento enviado. Salir pierde la copia local y no cancela ni confirma la venta. Revisá las ventas antes de crear otra."
            : "La copia local del carrito y del cliente se perderá. Una venta ya creada permanece en el sistema; salir no la cancela."
      }
      confirmLabel="Salir y descartar copia local"
      cancelLabel="Permanecer en el POS"
      confirmDisabled={pending}
      onConfirm={() => {
        if (state.current.pending || !destination) return;
        const url = new URL(destination);
        state.current = { dirty: false, pending: false, uncertain: false };
        if (url.origin === window.location.origin)
          router.push(url.pathname + url.search + url.hash);
        else window.location.assign(url.href);
      }}
    />
  );
}
