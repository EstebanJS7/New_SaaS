"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  isPortalDeniedError,
  listPortalPets,
  userFacingPortalError,
  type PortalPet,
} from "@/lib/portal-api";
import { petFacts } from "@/components/portal/pet-facts";

interface PortalPetsListProps {
  readonly slug: string;
}

/** Shared alert chrome so denied/error/not-found read the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

function PetRow({ pet, slug }: { readonly pet: PortalPet; readonly slug: string }): JSX.Element {
  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground">
      <Link
        href={`/${encodeURIComponent(slug)}/pets/${pet.id}`}
        className="font-medium text-primary hover:underline"
        data-testid="portal-pet-link"
      >
        {pet.name}
      </Link>
      <p className="mt-1 text-sm text-muted-foreground">{petFacts(pet)}</p>
    </li>
  );
}

/**
 * Holder-facing pets list.
 *
 * States are kept visibly distinct: loading, denied (403), error, empty and
 * success. An empty list is a NORMAL state for a holder — a guardian link may
 * not exist yet — so it never renders as an error.
 *
 * `speciesId`/`breedId` are intentionally not rendered; see `pet-facts.ts` for
 * why a catalog read is required before species/breed names can appear.
 */
export function PortalPetsList({ slug }: PortalPetsListProps): JSX.Element {
  const query = useQuery({
    queryKey: ["portal", "pets"],
    queryFn: listPortalPets,
  });

  const pets = query.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My pets</h1>
        <p className="text-sm text-muted-foreground">The pets linked to your account.</p>
      </div>

      {query.isLoading ? (
        <p
          role="status"
          data-testid="portal-pets-loading"
          className="text-sm text-muted-foreground"
        >
          Loading your pets...
        </p>
      ) : query.error ? (
        isPortalDeniedError(query.error) ? (
          <div role="alert" data-testid="portal-pets-denied" className={alertClassName}>
            {userFacingPortalError(query.error)}
          </div>
        ) : (
          <div role="alert" data-testid="portal-pets-error" className={alertClassName}>
            {userFacingPortalError(query.error)}
          </div>
        )
      ) : pets.length === 0 ? (
        <div
          data-testid="portal-pets-empty"
          className="rounded-lg border bg-card p-6 text-card-foreground"
        >
          <h2 className="font-medium">No pets yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When your clinic links a pet to your account, it will appear here.
          </p>
        </div>
      ) : (
        <ul data-testid="portal-pets-list" className="space-y-3">
          {pets.map((pet) => (
            <PetRow key={pet.id} pet={pet} slug={slug} />
          ))}
        </ul>
      )}
    </div>
  );
}
