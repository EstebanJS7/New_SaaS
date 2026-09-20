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
 * INTENTIONAL OMISSION: the portal read returns `speciesId` and `breedId` as
 * stable ids only and there is no holder-facing catalog route, so species and
 * breed NAMES cannot be resolved. A catalog read (or an API that joins the
 * names) is required before those labels can be rendered. Until then nothing is
 * printed for them — a raw UUID is never shown to a holder and no local
 * lookup/fixture is invented to fake the name.
 *
 * `birthDate` is sliced to its date component rather than parsed through
 * `new Date()`, so the displayed value cannot drift by timezone.
 */
export function petFacts(pet: PortalPet): string {
  const facts: string[] = [sexLabel(pet.sex)];
  if (pet.birthDate) {
    facts.push(`Born ${pet.birthDate.slice(0, 10)}`);
  }
  if (!pet.isActive) {
    facts.push("Inactive");
  }
  return facts.join(" · ");
}
