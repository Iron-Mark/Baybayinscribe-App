import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { saveProfileChanges, ProfileEmailChangeError, type ProfileUpdate } from "../lib/auth/profile-update";

const currentEmail = "current@example.invalid";
const profile: ProfileUpdate = { firstName: "Test", lastName: "Person", username: "synthetic", email: currentEmail, profilePictureUrl: null };
const success = () => Response.json({ success: true });
const pending = () => Response.json({ status: "confirmation-required", emailChangeRequested: true }, { status: 202 });

function transport(...responses: (Response | Error)[]) {
  const calls: { path: string; method: string | undefined; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ path: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    assert.ok(next, "Unexpected duplicate request");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetcher };
}

test("unchanged email saves the profile once without serializing email or requesting confirmation", async () => {
  const stub = transport(success());
  const result = await saveProfileChanges(currentEmail, { ...profile, email: " CURRENT@example.invalid " }, stub.fetcher);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].path, "/api/user.information/update");
  assert.equal(stub.calls[0].method, "PUT");
  assert.equal("email" in stub.calls[0].body, false);
  assert.equal(stub.calls[0].body.profilePictureUrl, null);
  assert.equal(result.profile.email, currentEmail);
});

test("changed email uses the separate confirmation route and keeps the current address", async () => {
  const stub = transport(success(), pending());
  const result = await saveProfileChanges(currentEmail, { ...profile, email: " NEW@example.invalid " }, stub.fetcher);
  assert.equal(stub.calls.length, 2);
  assert.equal("email" in stub.calls[0].body, false);
  assert.equal(stub.calls[1].path, "/api/user.information/change-email");
  assert.deepEqual(stub.calls[1].body, { newEmail: "new@example.invalid" });
  assert.equal(result.profile.email, currentEmail);
  assert.match(result.message, /If the new address is available/);
  assert.match(result.message, /current email remains unchanged/);
  assert.doesNotMatch(result.message, /email (updated|sent)/i);
});

test("unverified accounts show the current-mailbox prerequisite rather than a pending new address", async () => {
  const stub = transport(success(), Response.json({ status: "current-email-verification-required", emailChangeRequested: false }, { status: 202 }));
  const result = await saveProfileChanges(currentEmail, { ...profile, email: "new@example.invalid" }, stub.fetcher);
  assert.equal(result.profile.email, currentEmail);
  assert.match(result.message, /Verify your current email/);
  assert.match(result.message, /request the email change again/);
});

test("failed profile writes do not request email changes", async () => {
  const stub = transport(Response.json({ error: "Profile unavailable" }, { status: 503 }));
  await assert.rejects(saveProfileChanges(currentEmail, { ...profile, email: "new@example.invalid" }, stub.fetcher), /Profile unavailable/);
  assert.equal(stub.calls.length, 1);
});

test("email failures report partial success, preserve saved fields/current email and never auto-retry", async () => {
  const stub = transport(success(), Response.json({ error: "Sign in again to confirm this change" }, { status: 401 }));
  await assert.rejects(saveProfileChanges(currentEmail, { ...profile, firstName: "Updated", email: "new@example.invalid" }, stub.fetcher), (error: unknown) => {
    assert.ok(error instanceof ProfileEmailChangeError);
    assert.equal(error.profile.firstName, "Updated");
    assert.equal(error.profile.email, currentEmail);
    assert.match(error.message, /Profile saved/);
    assert.match(error.message, /Sign in again/);
    return true;
  });
  assert.equal(stub.calls.length, 2);
});

test("network and malformed email responses never become confirmed-email UI state", async () => {
  for (const failure of [new Error("Network unavailable"), Response.json({ status: "confirmation-required", emailChangeRequested: false }, { status: 202 }), Response.json({ success: true })]) {
    const stub = transport(success(), failure);
    await assert.rejects(saveProfileChanges(currentEmail, { ...profile, email: "new@example.invalid" }, stub.fetcher), (error: unknown) => {
      assert.ok(error instanceof ProfileEmailChangeError);
      assert.equal(error.profile.email, currentEmail);
      return true;
    });
    assert.equal(stub.calls.length, 2);
  }
});

test("fresh-session and rate-limit responses retain actionable partial-save messaging", async () => {
  for (const [body, status, expected] of [
    [{ code: "SESSION_NOT_FRESH", message: "Session is not fresh" }, 403, /Sign in again/],
    [{ code: "TOO_MANY_REQUESTS", message: "Wait before requesting another confirmation" }, 429, /Wait before requesting/],
  ] as const) {
    const stub = transport(success(), Response.json(body, { status }));
    await assert.rejects(saveProfileChanges(currentEmail, { ...profile, email: "new@example.invalid" }, stub.fetcher), (error: unknown) => {
      assert.ok(error instanceof ProfileEmailChangeError);
      assert.match(error.message, expected);
      assert.match(error.message, /Profile saved/);
      assert.equal(error.profile.email, currentEmail);
      return true;
    });
    assert.equal(stub.calls.length, 2);
  }
});

test("explicit retry makes one new request and still retains the current address", async () => {
  const first = transport(success(), new Error("Network unavailable"));
  await assert.rejects(saveProfileChanges(currentEmail, { ...profile, email: "new@example.invalid" }, first.fetcher));
  const retry = transport(success(), pending());
  const result = await saveProfileChanges(currentEmail, { ...profile, email: "new@example.invalid" }, retry.fetcher);
  assert.equal(first.calls.length, 2);
  assert.equal(retry.calls.length, 2);
  assert.equal(result.profile.email, currentEmail);
});

test("desktop/mobile editors own persistence and parent callbacks do not duplicate requests", () => {
  for (const file of ["desktop.profile.tsx", "mobile.profile.tsx", "modal.profile.tsx"]) {
    const source = readFileSync(`components/profile.settings/accounts/${file}`, "utf8");
    assert.doesNotMatch(source, /\/api\/user\.information\/update/);
    assert.match(source, /status\.keepEditing/);
    assert.match(source, /role="status"/);
  }
  for (const file of ["desktop.edit.tsx", "mobile.edit.tsx"]) {
    const source = readFileSync(`components/profile.settings/accounts/edit.profile/${file}`, "utf8");
    assert.doesNotMatch(source, /\/api\/user\.information\/update/);
    assert.match(source, /await saveProfileChanges\(userData\.email, dataToUpdate\)/);
    assert.match(source, /await onSave\(saved\.profile/);
    assert.match(source, /if \(savingRef\.current\) return/);
    assert.match(source, /disabled=\{isSaving\}/);
    assert.match(source, /role="alert"/);
    assert.match(source, /retryEmailRef\.current = formData\.email/);
    assert.match(source, /email: retryEmailRef\.current \?\? userData\.email/);
  }
});
