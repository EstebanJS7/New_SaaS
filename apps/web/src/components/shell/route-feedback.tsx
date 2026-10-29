"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/** Navigation starts on an actual link; query activity also covers client data loading. */
export function RouteFeedback() {
  const pathname = usePathname();
  const search = useSearchParams();
  const fetching = useIsFetching({ predicate: (query) => query.state.data === undefined });
  const mutating = useIsMutating();
  const [navigating, setNavigating] = useState(false);
  useEffect(() => {
    setNavigating(false);
  }, [pathname, search]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      setNavigating(true);
      clearTimeout(timeout);
      // A cancelled/failed route must not leave an endless indicator.
      timeout = setTimeout(() => setNavigating(false), 15000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(timeout);
    };
  }, []);
  return navigating || fetching > 0 || mutating > 0 ? (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-primary/15"
    >
      <span
        aria-hidden="true"
        className="route-progress block h-full w-1/3 rounded-full bg-primary"
      />
      <span className="sr-only">{mutating > 0 ? "Guardando cambios…" : "Cargando…"}</span>
    </div>
  ) : null;
}
