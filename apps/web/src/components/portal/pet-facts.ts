import type { PortalPet, PortalPetSex } from "@/lib/portal-api";

/** Holder-facing label for a stored sex value. */
function sexLabel(sex: PortalPetSex): string {
  switch (sex) {
    case "MALE":
      return "Male";
    case "FEMALE":
      return "Female";
    default:
      return "Sex not recorded";
  }
}

/**
 * Builds the one-line fact summary shown for a pet in the list and detail.
 *
 * Species and breed are rendered from the NAMES the API resolves server-side
 * (`speciesName`/`breedName`); the client never reads the global catalog and
 * never prints the raw `speciesId`/`breedId`. `breedName` is null for a pet with
 * no recorded breed, and an empty fact is simply omitted rather than padded.
 *
 * `birthDate` is sliced to its date component rather than parsed through
 * `new Date()`, so the displayed value cannot drift by timezone.
 */
export function petFacts(pet: PortalPet): string {
  const facts: string[] = [pet.speciesName];
  if (pet.breedName) {
    facts.push(pet.breedName);
  }
  facts.push(sexLabel(pet.sex));
  if (pet.birthDate) {
    facts.push(`Born ${pet.birthDate.slice(0, 10)}`);
  }
  if (!pet.isActive) {
    facts.push("Inactive");
  }
  return facts.join(" · ");
}
