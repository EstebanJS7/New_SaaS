import { expect, type APIRequestContext, type Browser } from "@playwright/test";
import type { MailWorker } from "./mail-worker.js";
import { resetLinkIn } from "./smtp-sink.js";
import { bff } from "./staff.js";

/**
 * A staff member with a role the spec chooses, created the way a clinic does ([[ONB-001]]): the
 * owner invites through the BFF, the activation link leaves BY MAIL (the worker mints the token at
 * send time) and the invitee sets a password on the real activation page.
 *
 * The address must be new on every run: a profile can never be erased once it has acted, and the
 * activation delivery is deduped per (profile, hour).
 */
export interface InvitedMember {
  readonly membershipId: string;
  readonly email: string;
  readonly password: string;
}

export async function inviteAndActivate(
  ownerRequest: APIRequestContext,
  browser: Browser,
  mail: MailWorker,
  input: {
    readonly displayName: string;
    readonly email: string;
    readonly roleCode: string;
    readonly password: string;
  }
): Promise<InvitedMember> {
  const { invitation } = await bff<{ invitation: { membershipId: string } }>(
    ownerRequest,
    "POST",
    "/api/memberships/invitations",
    { email: input.email, displayName: input.displayName, roleCode: input.roleCode }
  );
  const link = resetLinkIn(await mail.nextMessageTo(input.email), "/reset-password");
  expect(link).toContain("activate=1");

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Activá tu cuenta" })).toBeVisible();
    await page.fill("#reset-password", input.password);
    await page.fill("#reset-confirmation", input.password);
    await page.getByRole("button", { name: "Activar cuenta" }).click();
    await expect(page.getByTestId("reset-done")).toContainText(
      "Ya podés ingresar con tu email y la contraseña que elegiste."
    );
  } finally {
    await context.close();
  }
  return { membershipId: invitation.membershipId, email: input.email, password: input.password };
}

/** Closes the clinic to a member the spec created, through the same command the team screen uses. */
export async function suspendMember(
  ownerRequest: APIRequestContext,
  membershipId: string
): Promise<void> {
  await bff(ownerRequest, "POST", `/api/memberships/${membershipId}/suspend`, {});
}
