import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin, jwt } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx, createEmailVerificationToken } from "better-auth/api";

const baseURL = "https://example.invalid";
const secret = "synthetic-only-email-flow-secret-for-offline-tests";
type Mail = { to: string; subject: string; text: string };

function loadActualOptions(mails: Mail[], failMail = false): BetterAuthOptions {
  const holder = { exports: {} as { auth: BetterAuthOptions } };
  runInNewContext(transformSync(readFileSync("app/lib/auth.ts", "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: holder, process: { env: {} }, Date, Number,
    require: (specifier: string) => {
      if (specifier === "better-auth") return { betterAuth: (options: BetterAuthOptions) => options };
      if (specifier === "better-auth/adapters/drizzle") return { drizzleAdapter: () => ({}) };
      if (specifier === "../../db/drizzle") return { __esModule: true, default: {} };
      if (specifier === "../../db/schema/auth-schema") return { schema: {} };
      if (specifier === "better-auth/plugins") return { admin, jwt };
      if (specifier === "better-auth/api") return { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx };
      if (specifier === "./email") return { sendEmail: async (mail: Mail) => {
        if (failMail) throw new Error("Synthetic delivery failure");
        mails.push(mail); return { success: true };
      } };
      throw new Error(`Unexpected auth-config dependency: ${specifier}`);
    },
  });
  return holder.exports.auth;
}

async function fixture(failMail = false, enableRateLimit = false) {
  const mails: Mail[] = [];
  const database: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] };
  const options = loadActualOptions(mails, failMail);
  const auth = betterAuth({
    ...options, database: memoryAdapter(database), plugins: [admin()],
    baseURL, secret, trustedOrigins: [baseURL], socialProviders: {},
    rateLimit: enableRateLimit ? { ...options.rateLimit, storage: "memory" } : { enabled: false },
    telemetry: { enabled: false }, logger: { disabled: true },
  });
  const signUp = await auth.handler(new Request(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ name: "Synthetic Person", email: "current@example.invalid", password: "Synthetic#Pass4728" }),
  }));
  assert.equal(signUp.status, 200);
  const cookie = signUp.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  assert.ok(cookie);
  const user = database.user[0];
  user.emailVerified = true;
  const call = (path: string, body?: unknown, useCookie = true) => auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": "198.51.100.42", ...(useCookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { auth, options, mails, database, user, call, cookie };
}

function verificationURL(mail: Mail) {
  const match = mail.text.match(/https:\/\/\S+/);
  assert.ok(match);
  return new URL(match[0]);
}

test("actual installed auth flow confirms both mailboxes before updating email", async () => {
  const loaded = await fixture();
  const initial = await loaded.call("/change-email", { newEmail: "next@example.invalid", callbackURL: "/auth/login" });
  assert.equal(initial.status, 200);
  assert.equal(loaded.user.email, "current@example.invalid");
  assert.equal(loaded.mails.length, 1);
  assert.equal(loaded.mails[0].to, "current@example.invalid");
  const confirmation = verificationURL(loaded.mails[0]);
  const confirmed = await loaded.auth.handler(new Request(confirmation));
  assert.equal(confirmed.status, 302);
  assert.equal(loaded.user.email, "current@example.invalid");
  assert.equal(loaded.mails.length, 2);
  assert.equal(loaded.mails[1].to, "next@example.invalid");
  const verification = verificationURL(loaded.mails[1]);
  const verified = await loaded.auth.handler(new Request(verification));
  assert.equal(verified.status, 302);
  assert.equal(loaded.database.user[0].email, "next@example.invalid");
  assert.equal(loaded.database.user[0].emailVerified, true);
  // Tokens remain bound to the previous address, so cannot be reused after completion.
  const replay = await loaded.auth.handler(new Request(verification));
  assert.match(replay.headers.get("location") ?? "", /error=INVALID_TOKEN/);
  assert.equal(loaded.database.user[0].email, "next@example.invalid");
});

test("current-email verification permits the existing authoritative session to enter the two-mailbox flow", async () => {
  const loaded = await fixture();
  loaded.user.emailVerified = false;
  const requested = await loaded.call("/send-verification-email", {
    email: "current@example.invalid", callbackURL: "/auth/login",
  });
  assert.equal(requested.status, 200);
  assert.equal(loaded.mails.length, 1);
  assert.equal(loaded.mails[0].to, "current@example.invalid");
  assert.equal(loaded.database.user[0].emailVerified, false);

  // Follow the mailbox link without cookies: verification must not sign in.
  const verifiedCurrent = await loaded.auth.handler(new Request(verificationURL(loaded.mails[0])));
  assert.equal(verifiedCurrent.status, 302);
  assert.equal(verifiedCurrent.headers.getSetCookie().length, 0);
  assert.equal(loaded.database.user[0].email, "current@example.invalid");
  assert.equal(loaded.database.user[0].emailVerified, true);

  // Reuse the original session cookie; the sensitive hook must re-read the user.
  const change = await loaded.call("/change-email", {
    newEmail: "next@example.invalid", callbackURL: "/auth/login",
  });
  assert.equal(change.status, 200);
  assert.equal(loaded.mails.length, 2);
  assert.equal(loaded.mails[1].to, "current@example.invalid");
  assert.equal(loaded.database.user[0].email, "current@example.invalid");
  assert.equal((await loaded.auth.handler(new Request(verificationURL(loaded.mails[1])))).status, 302);
  assert.equal(loaded.mails.length, 3);
  assert.equal(loaded.mails[2].to, "next@example.invalid");
  assert.equal(loaded.database.user[0].email, "current@example.invalid");
  assert.equal((await loaded.auth.handler(new Request(verificationURL(loaded.mails[2])))).status, 302);
  assert.equal(loaded.database.user[0].email, "next@example.invalid");
  assert.equal(loaded.database.user[0].emailVerified, true);
});

test("direct built-in email changes reject stale, unverified and banned sessions before mail", async () => {
  for (const state of ["stale", "unverified", "banned"] as const) {
    const loaded = await fixture();
    if (state === "stale") {
      loaded.database.session[0].createdAt = new Date(Date.now() - 16 * 60 * 1000);
      loaded.database.session[0].updatedAt = new Date();
    }
    if (state === "unverified") loaded.user.emailVerified = false;
    if (state === "banned") loaded.user.banned = true;
    const response = await loaded.call("/change-email", { newEmail: "next@example.invalid" });
    assert.equal(response.status, 403, state);
    assert.equal(loaded.mails.length, 0);
    assert.equal(loaded.database.user[0].email, "current@example.invalid");
  }
});

test("invalid and expired email-change tokens leave the current address intact", async () => {
  const loaded = await fixture();
  const expired = await createEmailVerificationToken(secret, "current@example.invalid", "next@example.invalid", -1, {
    requestType: "change-email-verification", userId: String(loaded.user.id),
  });
  for (const token of ["synthetic-invalid-token", expired]) {
    const response = await loaded.call(`/verify-email?token=${encodeURIComponent(token)}`, undefined, false);
    assert.equal(response.status, 401);
    assert.equal(loaded.database.user[0].email, "current@example.invalid");
  }
});

test("mail failure never updates email or returns successful verification initiation", async (t) => {
  t.mock.method(console, "error", () => {});
  const loaded = await fixture(true);
  const response = await loaded.call("/change-email", { newEmail: "next@example.invalid" });
  assert.equal(response.status, 500);
  assert.equal(loaded.database.user[0].email, "current@example.invalid");
});

test("another signed-in user cannot consume an email-change confirmation", async () => {
  const loaded = await fixture();
  assert.equal((await loaded.call("/change-email", { newEmail: "next@example.invalid", callbackURL: "/auth/login" })).status, 200);
  const confirmation = verificationURL(loaded.mails[0]);
  const signUp = await loaded.auth.handler(new Request(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ name: "Other Synthetic User", email: "other@example.invalid", password: "Synthetic#Pass4728" }),
  }));
  assert.equal(signUp.status, 200);
  const cookie = signUp.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  const wrongUser = await loaded.auth.handler(new Request(confirmation, { headers: { cookie } }));
  assert.match(wrongUser.headers.get("location") ?? "", /error=INVALID_USER/);
  assert.equal(loaded.database.user[0].email, "current@example.invalid");
  assert.equal(loaded.mails.length, 1);
});

test("actual config never enables unverified immediate updates or auto sign-in", () => {
  const options = loadActualOptions([]);
  assert.equal(options.user?.changeEmail?.updateEmailWithoutVerification, false);
  assert.equal(options.emailVerification?.autoSignInAfterVerification, false);
  assert.ok(options.user?.changeEmail?.sendChangeEmailConfirmation);
  assert.ok(options.emailVerification?.sendVerificationEmail);
  assert.equal(JSON.stringify(options.rateLimit?.customRules?.["/change-email"]), JSON.stringify({ window: 3600, max: 5 }));
});

test("real HTTP email-initiation and confirmation limits bound repeated mail sends", async () => {
  const loaded = await fixture(false, true);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await loaded.call("/change-email", { newEmail: "next@example.invalid", callbackURL: "/auth/login" })).status, 200);
  }
  assert.equal(loaded.mails.length, 5);
  assert.equal((await loaded.call("/change-email", { newEmail: "next@example.invalid" })).status, 429);
  assert.equal(loaded.mails.length, 5);
  const confirmation = verificationURL(loaded.mails[0]);
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await loaded.auth.handler(new Request(confirmation, { headers: { "x-forwarded-for": "198.51.100.43" } }));
    assert.equal(response.status, 302);
  }
  assert.equal(loaded.mails.length, 20);
  const limited = await loaded.auth.handler(new Request(confirmation, { headers: { "x-forwarded-for": "198.51.100.43" } }));
  assert.equal(limited.status, 429);
  assert.equal(loaded.mails.length, 20);
  assert.equal(loaded.database.user[0].email, "current@example.invalid");
});
