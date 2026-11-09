"use client";

import type { JSX, ReactNode } from "react";
import { useId } from "react";
import { Input } from "@newsaas/ui/components/ui/input";
import { selectClassName } from "./fiscal-settings-display";
import type { CodeLabel } from "./fiscal-settings-display";

/** A labelled input with its optional marker and its inline error. */
export function TextField({
  label,
  value,
  onChange,
  error,
  optional = false,
  type = "text",
  inputMode,
  maxLength,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  optional?: boolean;
  type?: "text" | "email" | "tel" | "date";
  inputMode?: "numeric" | "text";
  maxLength?: number;
  placeholder?: string;
  className?: string;
}): JSX.Element {
  const id = useId();
  return (
    <div className={className ?? "space-y-1"}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** A labelled native select over a code catalogue; `emptyLabel` adds a "none" option. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  emptyLabel,
  error,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly CodeLabel[] | readonly { code: string; label: string }[];
  emptyLabel?: string;
  error?: string | null;
  className?: string;
}): JSX.Element {
  const id = useId();
  return (
    <div className={className ?? "space-y-1"}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        className={selectClassName}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {emptyLabel === undefined ? null : <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={String(option.code)} value={String(option.code)}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function FieldLabel({
  htmlFor,
  optional = false,
  children,
}: {
  htmlFor: string;
  optional?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
      {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

/** A section's success line, shown only after the API answered. */
export function SuccessNotice({ message }: { message: string | null }): JSX.Element | null {
  if (message === null) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-status-success/20 bg-status-success/10 p-3 text-sm"
    >
      {message}
    </p>
  );
}

/** The optional-text convention of the API: blank is `null`. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A whole number within bounds, or `null` when the text is not one. */
export function parseWhole(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= min && parsed <= max ? parsed : null;
}

/** A nullable code as form text: absent is the empty string. */
export function optionalText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}
