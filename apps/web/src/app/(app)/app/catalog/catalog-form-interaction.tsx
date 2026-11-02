"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

/** Catalog-only working-copy guard. Memory only; no router/history patch or persistence. */
export function useCatalogExit(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [destination, setDestination] = useState<(() => void) | null>(null);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        !dirtyRef.current ||
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
      // Keep only the destination URL, never copy form content into navigation state.
      setDestination(() => () => {
        if (url.origin === window.location.origin)
          router.push(url.pathname + url.search + url.hash);
        else window.location.assign(url.href);
      });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [router]);
  return {
    leave: (action: () => void) => (dirtyRef.current ? setDestination(() => action) : action()),
    dialog: (
      <ConfirmActionDialog
        open={destination !== null}
        onOpenChange={(open) => {
          if (!open) setDestination(null);
        }}
        title="¿Descartar los cambios sin guardar?"
        description="La copia de este formulario se perderá. Salir no cancela una operación que ya fue enviada."
        confirmLabel="Descartar y salir"
        cancelLabel="Seguir editando"
        onConfirm={() => {
          dirtyRef.current = false;
          destination?.();
        }}
      />
    ),
  };
}
