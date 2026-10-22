import type { JSX } from "react";
import { ImportsDetail } from "./imports-detail";

/**
 * One staff import route ([[IMP-005]]).
 *
 * A thin server page: everything the screen does — polling, the two commands, the
 * paged summary — is client-side, because all three are reactions to a state the
 * server moves on its own once work is queued ([[DEC-072]]).
 *
 * `key={importId}` is deliberate. Navigating from one import to another keeps the
 * same component at the same position in the tree, so React would preserve the
 * pager's offset and the query observers across two different imports; keying by
 * the id remounts the screen and starts both at the truth of the import being
 * opened.
 *
 * No permission list is passed, for the reason `../page.tsx` records: the shell does
 * not hand the caller's claims to a surface yet, so `permissions` stays optional and
 * the API remains authoritative.
 */
export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}): Promise<JSX.Element> {
  const { importId } = await params;
  return <ImportsDetail key={importId} importId={importId} />;
}
