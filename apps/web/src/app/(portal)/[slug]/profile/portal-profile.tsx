"use client";

import { useState, type FormEvent, type JSX } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPortalProfile,
  isPortalDeniedError,
  updatePortalProfile,
  userFacingPortalProfileError,
  type PortalProfile,
  type PortalProfileAddressInput,
  type UpdatePortalProfileInput,
} from "@/lib/portal-api";

/** Shared alert chrome so denied/error/validation read the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

const fieldClassName =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const labelClassName = "block text-sm font-medium text-foreground";

const saveButtonClassName =
  "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The address keys the holder may edit, in contract order. Kept as a list so
 * the form and the optional-field compaction share one source of truth.
 */
type AddressField = "label" | "line1" | "line2" | "city" | "state" | "postalCode" | "countryCode";

const ADDRESS_FIELDS: readonly AddressField[] = [
  "label",
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "countryCode",
];

/** Holder-facing labels. These are the SEVEN fields the API accepts, no more. */
const ADDRESS_FIELD_LABELS: Record<AddressField, string> = {
  label: "Address label",
  line1: "Address line 1",
  line2: "Address line 2",
  city: "City",
  state: "State or province",
  postalCode: "Postal code",
  countryCode: "Country code",
};

const ADDRESS_FIELD_TEST_IDS: Record<AddressField, string> = {
  label: "portal-profile-address-label",
  line1: "portal-profile-address-line1",
  line2: "portal-profile-address-line2",
  city: "portal-profile-address-city",
  state: "portal-profile-address-state",
  postalCode: "portal-profile-address-postal-code",
  countryCode: "portal-profile-address-country-code",
};

const ADDRESS_FIELD_AUTOCOMPLETE: Record<AddressField, string> = {
  label: "off",
  line1: "address-line1",
  line2: "address-line2",
  city: "address-level2",
  state: "address-level1",
  postalCode: "postal-code",
  countryCode: "country",
};

/**
 * Address-field length limits, mirrored EXACTLY from the API's zod schema in
 * `apps/api/src/portal/portal-profile.dto.ts`: `label` max 100, `line1` max
 * 200, `line2` max 200, `city` max 100, `state` max 100, `postalCode` max 20
 * and `countryCode` EXACTLY 2. `exact` is only set for `countryCode`; every
 * other field is an upper bound. The form uses `max` for the input attribute
 * and re-checks it in validation, because `maxLength` is a UI convenience the
 * API does not rely on.
 */
const ADDRESS_FIELD_LIMITS: Record<
  AddressField,
  { readonly max: number; readonly exact?: number }
> = {
  label: { max: 100 },
  line1: { max: 200 },
  line2: { max: 200 },
  city: { max: 100 },
  state: { max: 100 },
  postalCode: { max: 20 },
  countryCode: { max: 2, exact: 2 },
};

/** The API's phone limit: `z.string().min(1).max(255)`. */
const PHONE_MAX_LENGTH = 255;

/**
 * Editable profile state: the phone plus every address field as plain strings.
 * An empty string means "not supplied" rather than an empty value, because the
 * API rejects a blank `phone`/`line1` and treats an absent optional key as
 * "leave the stored value alone".
 */
interface ProfileFormState {
  readonly phone: string;
  readonly label: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

function formStateFrom(profile: PortalProfile): ProfileFormState {
  const address = profile.address;
  return {
    phone: profile.phone ?? "",
    label: address?.label ?? "",
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
    postalCode: address?.postalCode ?? "",
    countryCode: address?.countryCode ?? "",
  };
}

/** Trimmed value, or `undefined` when the holder left the field blank. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function hasAddressInput(form: ProfileFormState): boolean {
  return ADDRESS_FIELDS.some((field) => optional(form[field]) !== undefined);
}

/**
 * The first API length limit the form can check before submitting, or null when
 * nothing exceeds its limit. Empty optional fields are omitted from the payload
 * (see `optional`), so the API's `min(1)` rules are already satisfied and only
 * the upper bounds plus `countryCode`'s exact length need checking here.
 */
function constraintError(form: ProfileFormState): string | null {
  const phone = optional(form.phone);
  if (phone !== undefined && phone.length > PHONE_MAX_LENGTH) {
    return `Your phone number must be ${PHONE_MAX_LENGTH} characters or fewer.`;
  }
  if (!hasAddressInput(form)) {
    return null;
  }
  for (const field of ADDRESS_FIELDS) {
    const value = optional(form[field]);
    if (value === undefined) {
      continue;
    }
    const limit = ADDRESS_FIELD_LIMITS[field];
    if (value.length > limit.max) {
      return `${ADDRESS_FIELD_LABELS[field]} must be ${limit.max} characters or fewer.`;
    }
    if (limit.exact !== undefined && value.length !== limit.exact) {
      return `${ADDRESS_FIELD_LABELS[field]} must be exactly ${limit.exact} characters.`;
    }
  }
  return null;
}

/**
 * The address block for the PUT body: `line1` plus every non-empty optional
 * field. `line1` is required exactly when the API's `.strict()` schema requires
 * it (an address is being sent), which `validate` guarantees before this runs.
 */
function addressPayload(form: ProfileFormState): PortalProfileAddressInput {
  const address: {
    line1: string;
    label?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode?: string;
  } = { line1: form.line1.trim() };
  for (const field of ADDRESS_FIELDS) {
    if (field === "line1") continue;
    const value = optional(form[field]);
    if (value !== undefined) {
      address[field] = value;
    }
  }
  return address;
}

type ValidationResult = { readonly error: string } | { readonly payload: UpdatePortalProfileInput };

/**
 * Builds the strict PUT body or returns the holder-facing problem that stops
 * the save. The two rules mirror the API contract: an address needs a `line1`,
 * and the payload needs at least one of `phone`/`address`. A client-side stop
 * never sends a request the API is certain to refuse, and it never clears what
 * the holder typed.
 */
function validate(form: ProfileFormState): ValidationResult {
  const phone = optional(form.phone);
  if (hasAddressInput(form) && optional(form.line1) === undefined) {
    return {
      error:
        "Enter the first line of your address, or leave every address field empty to keep your saved address.",
    };
  }
  if (phone === undefined && !hasAddressInput(form)) {
    return { error: "Enter a phone number or an address before saving." };
  }
  const constraint = constraintError(form);
  if (constraint !== null) {
    return { error: constraint };
  }
  return {
    payload: {
      ...(phone !== undefined && { phone }),
      ...(hasAddressInput(form) && { address: addressPayload(form) }),
    },
  };
}

interface PortalProfileFormProps {
  readonly initial: PortalProfile;
}

/**
 * The holder's editable profile form.
 *
 * It offers EXACTLY the fields `PUT /portal/profile` accepts — a phone and the
 * seven address fields — and nothing else. Email is not a field here on
 * purpose: it is staff-operated and no email is accepted or returned, so the
 * form says that plainly instead of leaving a holder to hunt for it.
 *
 * On success the form resets from the RESPONSE, so the holder reads what the
 * API actually persisted, and the query cache is updated with the same object.
 * A validation failure keeps every typed value and sends no request; a failed
 * save keeps the form usable and never renders the server's message text.
 */
function PortalProfileForm({ initial }: PortalProfileFormProps): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProfileFormState>(() => formStateFrom(initial));
  const [validationError, setValidationError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: updatePortalProfile,
    onSuccess: (saved) => {
      setForm(formStateFrom(saved));
      setValidationError(null);
      queryClient.setQueryData(["portal", "profile"], saved);
    },
  });

  const isEmpty = initial.phone === null && initial.address === null;

  function setField(field: keyof ProfileFormState, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = validate(form);
    if ("error" in result) {
      setValidationError(result.error);
      return;
    }
    setValidationError(null);
    save.mutate(result.payload);
  }

  return (
    <form onSubmit={onSubmit} data-testid="portal-profile-form" className="space-y-6" noValidate>
      <aside
        data-testid="portal-profile-email-note"
        className="rounded-lg border bg-card p-4 text-sm text-card-foreground"
      >
        Your email address is managed by clinic staff and cannot be changed here. Contact your
        clinic if it needs updating.
      </aside>

      <aside
        data-testid="portal-profile-removal-note"
        className="rounded-lg border bg-card p-4 text-sm text-card-foreground"
      >
        You can update your phone number and address here, but you cannot remove them. Contact your
        clinic if you need a detail removed.
      </aside>

      {isEmpty ? (
        <p data-testid="portal-profile-empty" className="text-sm text-muted-foreground">
          You have no phone number or address recorded yet. You can add them below.
        </p>
      ) : null}

      <div className="space-y-1">
        <label className={labelClassName} htmlFor="portal-profile-phone">
          Phone
        </label>
        <input
          id="portal-profile-phone"
          data-testid="portal-profile-phone"
          type="tel"
          value={form.phone}
          onChange={(event) => setField("phone", event.target.value)}
          className={fieldClassName}
          autoComplete="tel"
          maxLength={PHONE_MAX_LENGTH}
        />
      </div>

      <fieldset className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground">
        <legend className="px-1 text-sm font-medium">Address</legend>
        <p className="text-sm text-muted-foreground">
          The first line is required whenever you enter an address.
        </p>
        {ADDRESS_FIELDS.map((field) => (
          <div key={field} className="space-y-1">
            <label className={labelClassName} htmlFor={ADDRESS_FIELD_TEST_IDS[field]}>
              {ADDRESS_FIELD_LABELS[field]}
            </label>
            <input
              id={ADDRESS_FIELD_TEST_IDS[field]}
              data-testid={ADDRESS_FIELD_TEST_IDS[field]}
              type="text"
              value={form[field]}
              onChange={(event) => setField(field, event.target.value)}
              className={fieldClassName}
              autoComplete={ADDRESS_FIELD_AUTOCOMPLETE[field]}
              maxLength={ADDRESS_FIELD_LIMITS[field].max}
            />
            {field === "countryCode" ? (
              <p className="text-xs text-muted-foreground">Two-letter country code.</p>
            ) : null}
          </div>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className={saveButtonClassName}
          data-testid="portal-profile-save"
        >
          Save profile
        </button>
        {save.isPending ? (
          <p
            role="status"
            data-testid="portal-profile-saving"
            className="text-sm text-muted-foreground"
          >
            Saving your profile...
          </p>
        ) : null}
        {save.isSuccess ? (
          <p
            role="status"
            data-testid="portal-profile-save-success"
            className="text-sm text-muted-foreground"
          >
            Your profile has been updated. Details cannot be removed from this page; contact your
            clinic if you need one removed.
          </p>
        ) : null}
      </div>

      {validationError ? (
        <div role="alert" data-testid="portal-profile-validation-error" className={alertClassName}>
          {validationError}
        </div>
      ) : null}

      {save.error ? (
        <div role="alert" data-testid="portal-profile-save-error" className={alertClassName}>
          {userFacingPortalProfileError(save.error)}
        </div>
      ) : null}
    </form>
  );
}

/**
 * Holder-facing profile view.
 *
 * States are kept visibly distinct: loading, denied, error and the form. A
 * holder with no phone and no address is NORMAL, not an error — the API answers
 * with nulls rather than a 404 — so the form renders with empty fields and an
 * informational note, never an alert. Every error is mapped by stable API code
 * (never the server message), and a masked `NOT_FOUND` keeps both of its causes
 * rather than asserting one.
 */
export function PortalProfileView(): JSX.Element {
  const query = useQuery({
    queryKey: ["portal", "profile"],
    queryFn: getPortalProfile,
  });

  const profile = query.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          Keep your contact details up to date so your clinic can reach you.
        </p>
      </div>

      {query.isLoading ? (
        <p
          role="status"
          data-testid="portal-profile-loading"
          className="text-sm text-muted-foreground"
        >
          Loading your profile...
        </p>
      ) : query.error ? (
        isPortalDeniedError(query.error) ? (
          <div role="alert" data-testid="portal-profile-denied" className={alertClassName}>
            {userFacingPortalProfileError(query.error)}
          </div>
        ) : (
          <div role="alert" data-testid="portal-profile-error" className={alertClassName}>
            {userFacingPortalProfileError(query.error)}
          </div>
        )
      ) : profile ? (
        <PortalProfileForm initial={profile} />
      ) : null}
    </div>
  );
}
