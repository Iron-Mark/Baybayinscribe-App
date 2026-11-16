import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { z } from "zod";
import { loadApiAccess, type TestSession } from "./helpers/api-access";

function loadRoute(session: TestSession, upstreamStatus = 200, fail = false) {
  const dispatched: Request[] = [];
  const holder = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  runInNewContext(transformSync(readFileSync("app/api/user.information/change-email/route.ts", "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: holder, Request, URL, Headers,
    require: (specifier: string) => {
      if (specifier === "next/server") return { NextResponse: { json: Response.json } };
      if (specifier === "zod") return { z };
      if (specifier === "@/lib/auth/api-access") return loadApiAccess(session);
      if (specifier === "@/app/lib/auth") return { auth: { handler: async (request: Request) => {
        dispatched.push(request);
        if (fail) throw new Error("Synthetic dispatch failure");
        return Response.json(upstreamStatus === 200 ? { status: true } : { error: "Rate limited" }, { status: upstreamStatus });
      } } };
      throw new Error(`Unexpected email-change route dependency: ${specifier}`);
    },
  });
  return { route: holder.exports, dispatched };
}

const actor = { user: { id: "self", role: "user", email: "current@example.invalid", emailVerified: true } };
const request = (body: unknown, origin?: string) => new Request("https://example.invalid/api/user.information/change-email", {
  method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
});

test("email-change wrapper denies anonymous/banned/cross-origin requests without dispatch", async () => {
  for (const [session, origin, expected] of [[null, undefined, 401], [{ user: { ...actor.user, banned: true } }, undefined, 403], [actor, "https://attacker.invalid", 403]] as const) {
    const loaded = loadRoute(session);
    assert.equal((await loaded.route.POST(request({ newEmail: "next@example.invalid" }, origin))).status, expected);
    assert.equal(loaded.dispatched.length, 0);
  }
});

test("email-change wrapper validates email and does not trust actor or callback input", async () => {
  const loaded = loadRoute(actor);
  for (const newEmail of ["invalid", actor.user.email]) {
    assert.equal((await loaded.route.POST(request({ newEmail }))).status, 400);
  }
  assert.equal(loaded.dispatched.length, 0);
  const response = await loaded.route.POST(request({ newEmail: " Next@Example.Invalid ", userId: "victim", callbackURL: "https://attacker.invalid" }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "confirmation-required", emailChangeRequested: true });
  assert.equal(loaded.dispatched[0].url, "https://example.invalid/api/auth/change-email");
  assert.deepEqual(await loaded.dispatched[0].json(), { newEmail: "next@example.invalid", callbackURL: "/auth/login" });
});

test("unverified actors verify their current email before any change request", async () => {
  const loaded = loadRoute({ user: { ...actor.user, emailVerified: false } });
  const response = await loaded.route.POST(request({ newEmail: "next@example.invalid" }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "current-email-verification-required", emailChangeRequested: false });
  assert.equal(loaded.dispatched[0].url, "https://example.invalid/api/auth/send-verification-email");
  assert.deepEqual(await loaded.dispatched[0].json(), { email: actor.user.email, callbackURL: "/auth/login" });
});

test("email-change wrapper preserves auth rate limits and fails closed on dispatch failures", async () => {
  const limited = loadRoute(actor, 429);
  assert.equal((await limited.route.POST(request({ newEmail: "next@example.invalid" }))).status, 429);
  const failed = loadRoute(actor, 200, true);
  assert.equal((await failed.route.POST(request({ newEmail: "next@example.invalid" }))).status, 503);
});
