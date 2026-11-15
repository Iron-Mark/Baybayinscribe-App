export type ProfileUpdate = {
  firstName: string;
  lastName: string;
  username: string;
  contactNumber?: string;
  dateOfBirth?: string;
  email: string;
  profilePictureUrl?: string | null;
};

export type ProfileSaveStatus = { message?: string; keepEditing?: boolean };
export type ProfileSaveResult = { profile: ProfileUpdate; message: string };

export class ProfileEmailChangeError extends Error {
  constructor(message: string, public readonly profile: ProfileUpdate) {
    super(`Profile saved. ${message} Your current email is unchanged. Retry the email change after resolving this error.`);
    this.name = "ProfileEmailChangeError";
  }
}

async function readError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      if ("code" in body && (body.code === "SESSION_NOT_FRESH" || body.code === "SESSION_EXPIRED")) {
        return "Sign in again before requesting an email change.";
      }
      if ("error" in body && typeof body.error === "string") return body.error;
      if ("message" in body && typeof body.message === "string") return body.message;
    }
  } catch { /* A non-JSON error must not become a false success. */ }
  return fallback;
}

/** Save non-email data once; the auth confirmation flow owns email changes. */
export async function saveProfileChanges(
  currentEmail: string,
  updated: ProfileUpdate,
  fetcher: typeof fetch = fetch,
): Promise<ProfileSaveResult> {
  const profile: ProfileUpdate = {
    firstName: updated.firstName, lastName: updated.lastName, username: updated.username,
    contactNumber: updated.contactNumber, dateOfBirth: updated.dateOfBirth,
    profilePictureUrl: updated.profilePictureUrl, email: currentEmail,
  };
  const response = await fetcher("/api/user.information/update", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: updated.firstName, lastName: updated.lastName, username: updated.username,
      contactNumber: updated.contactNumber, dateOfBirth: updated.dateOfBirth,
      profilePictureUrl: updated.profilePictureUrl,
    }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to update profile"));

  const newEmail = updated.email.trim().toLowerCase();
  if (newEmail === currentEmail.trim().toLowerCase()) return { profile, message: "Profile saved." };

  try {
    const change = await fetcher("/api/user.information/change-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail }),
    });
    if (!change.ok) throw new Error(await readError(change, "Email confirmation could not be requested."));
    const result: unknown = await change.json();
    if (change.status !== 202 || typeof result !== "object" || result === null || !("status" in result)) {
      throw new Error("Email confirmation returned an unexpected response.");
    }
    if (result.status === "current-email-verification-required" && "emailChangeRequested" in result && result.emailChangeRequested === false) {
      return { profile, message: "Profile saved. Verify your current email using the link sent to it, then request the email change again. Your email address is unchanged." };
    }
    if (result.status !== "confirmation-required" || !("emailChangeRequested" in result) || result.emailChangeRequested !== true) {
      throw new Error("Email confirmation returned an unexpected status.");
    }
    return { profile, message: "Profile saved. If the new address is available, follow the confirmation instructions in your current mailbox, then verify the new address. Your current email remains unchanged until verification completes." };
  } catch (error) {
    throw new ProfileEmailChangeError(error instanceof Error ? error.message : "Email confirmation could not be requested.", profile);
  }
}
