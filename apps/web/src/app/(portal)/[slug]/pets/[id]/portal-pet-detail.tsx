"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  getPortalPet,
  isPortalDeniedError,
  isPortalNotFoundError,
  userFacingPortalError,
  type PortalClinicalSummary,
  type PortalVaccination,
} from "@/lib/portal-api";
import { petFacts } from "@/components/portal/pet-facts";

interface PortalPetDetailViewProps {
  readonly slug: string;
  readonly petId: string;
}

const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

/** Date-only rendering; the ISO instant is sliced so timezone cannot shift it. */
function toDate(value: string): string {
  return value.slice(0, 10);
}

function EncounterItem({ encounter }: { readonly encounter: PortalClinicalSummary }): JSX.Element {
  return (
    <li className="rounded-lg border bg-background p-3">
      <p className="text-sm text-foreground">{encounter.clientSummary}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {encounter.status === "CLOSED" ? "Closed" : "Open"}
        {encounter.closedAt ? ` · ${toDate(encounter.closedAt)}` : ""}
      </p>
    </li>
  );
}

function VaccinationItem({
  vaccination,
}: {
  readonly vaccination: PortalVaccination;
}): JSX.Element {
  return (
    <li className="rounded-lg border bg-background p-3">
      <p className="text-sm text-foreground">{vaccination.vaccine}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Given {toDate(vaccination.administeredAt)}
      </p>
    </li>
  );
}

/**
 * Holder-facing pet detail.
 *
 * Renders the pet identity and the allowlisted clinical block the API exposes
 * (`clientSummary` encounters and vaccinations only) — never staff free text or
 * `internalNotes`, which are not even returned by the read boundary.
 *
 * A `404` is handled honestly: the API masks a pet that is not the holder's as
 * the SAME not-found it returns for a pet that does not exist, so the copy says
 * both may be true instead of claiming the pet exists elsewhere.
 *
 * `speciesId`/`breedId` are intentionally not rendered; see `pet-facts.ts`.
 *
 * A link into the booking grid is preserved with the tenant slug so the holder
 * moves between portal pages without ever leaving their own tenant.
 */
export function PortalPetDetailView({ slug, petId }: PortalPetDetailViewProps): JSX.Element | null {
  const query = useQuery({
    queryKey: ["portal", "pets", petId],
    queryFn: () => getPortalPet(petId),
  });

  if (query.isLoading) {
    return (
      <p role="status" data-testid="portal-pet-loading" className="text-sm text-muted-foreground">
        Loading pet...
      </p>
    );
  }

  if (query.error) {
    const testId = isPortalNotFoundError(query.error)
      ? "portal-pet-not-found"
      : isPortalDeniedError(query.error)
        ? "portal-pet-denied"
        : "portal-pet-error";
    return (
      <div role="alert" data-testid={testId} className={alertClassName}>
        {userFacingPortalError(query.error)}
      </div>
    );
  }

  const pet = query.data;
  if (!pet) {
    // Defensive only: React Query has no data while not loading and without an
    // error. Render nothing rather than fabricate an identity or a summary.
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{pet.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{petFacts(pet)}</p>
        <Link
          href={`/${encodeURIComponent(slug)}/pets/${petId}/book`}
          className="mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="portal-book-link"
        >
          Request an appointment
        </Link>
      </div>

      <section className="space-y-3" data-testid="portal-pet-encounters">
        <h2 className="text-lg font-medium">Visit summaries</h2>
        {pet.clinical.encounters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visit summaries yet.</p>
        ) : (
          <ul className="space-y-2">
            {pet.clinical.encounters.map((encounter) => (
              <EncounterItem key={encounter.id} encounter={encounter} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" data-testid="portal-pet-vaccinations">
        <h2 className="text-lg font-medium">Vaccinations</h2>
        {pet.clinical.vaccinations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vaccinations recorded.</p>
        ) : (
          <ul className="space-y-2">
            {pet.clinical.vaccinations.map((vaccination) => (
              <VaccinationItem key={vaccination.id} vaccination={vaccination} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
