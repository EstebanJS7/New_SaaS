"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@newsaas/ui/components/ui/input";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

/** Customers-only working-copy guard. Memory only; no router/history patch or persistence. */
export function useCustomerExit(dirty: boolean) {
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

/** Only mirrors current length/required contracts; never truncates the entered value. */
export function validateCustomerFields(form: HTMLFormElement): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of form.querySelectorAll<HTMLInputElement>("input[data-limit]")) {
    if (field.disabled) continue;
    const text = field.value.trim();
    const limit = Number(field.dataset.limit);
    if (field.required && !text) errors[field.id] = "Completá este campo.";
    else if (text.length > limit) errors[field.id] = `Usá hasta ${limit} caracteres.`;
    else if (text && field.dataset.exact && text.length !== limit)
      errors[field.id] = `Ingresá ${limit} caracteres.`;
  }
  return errors;
}

export function useCustomerValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sending = useRef(false);
  return {
    errors,
    clear: (id: string) => setErrors((previous) => ({ ...previous, [id]: "" })),
    submit: async (
      event: FormEvent<HTMLFormElement>,
      work: () => Promise<unknown>,
      blocked = false
    ) => {
      event.preventDefault();
      if (sending.current || blocked) return;
      const form = event.currentTarget;
      const next = validateCustomerFields(form);
      setErrors(next);
      if (Object.keys(next).length) {
        // Render the associated error first, then focus its input.
        requestAnimationFrame(() =>
          form.querySelector<HTMLInputElement>("[aria-invalid=true]")?.focus()
        );
        return;
      }
      sending.current = true;
      try {
        await work();
      } catch {
        /* Mutation owner presents the sanitized error. */
      } finally {
        sending.current = false;
      }
    },
  };
}

export function CustomerField({
  label,
  limit,
  exact = false,
  error,
  ...props
}: ComponentProps<"input"> & {
  label: string;
  limit: number;
  exact?: boolean;
  error?: string;
}) {
  const generated = useId();
  const id = props.id ?? generated;
  const hint = `${id}-help`;
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {props.required ? " (obligatorio)" : " (opcional)"}
      </label>
      <Input
        {...props}
        id={id}
        data-limit={limit}
        data-exact={exact || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={hint}
      />
      <p id={hint} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {error ?? (exact ? `${limit} caracteres.` : `Hasta ${limit} caracteres.`)}
      </p>
    </div>
  );
}
