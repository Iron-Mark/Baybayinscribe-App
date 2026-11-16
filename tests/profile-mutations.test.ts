import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { loadApiAccess, type TestSession } from "./helpers/api-access";

type Handler = (request: Request) => Promise<Response>;
const protectedRoutes = [
  ["app/api/user.information/route.ts", ["GET", "POST", "PATCH"]],
  ["app/api/user.information/update/route.ts", ["PUT"]],
  ["app/api/user.information/delete/route.ts", ["DELETE"]],
  ["app/api/user.information/upload-profile-picture/route.ts", ["POST"]],
  ["app/api/user.information/delete-profile-picture/route.ts", ["DELETE"]],
  ["app/api/auth/agree.terms/route.ts", ["POST"]],
  ["app/api/auth/check.user.info/route.ts", ["GET"]],
  ["app/api/auth/verify.admin.session/route.ts", ["GET"]],
  ["app/api/auth/check.email/route.ts", ["GET"]],
  ["app/api/translate/route.ts", ["POST"]],
] as const;

function loadRoute(path: string, session: TestSession, picture?: string) {
  const effects: { query: string; values: unknown[] }[] = [];
  let blobCalls = 0;
  let profileClears = 0;
  const holder = { exports: {} as Record<string, Handler> };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ profilePictureUrl: picture }] }) }) }),
    update: () => ({ set: () => ({ where: async () => { profileClears++; } }) }),
  };
  runInNewContext(transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: holder, process: { env: {} }, console, URL, File, crypto,
    require: (specifier: string) => {
      if (specifier === "next/server") return { NextResponse: { json: Response.json } };
      if (specifier === "@/lib/auth/api-access") return loadApiAccess(session);
      if (specifier === "pg") return { Pool: class {
        async query(query: string, values: unknown[] = []) { effects.push({ query, values }); return { rows: [] }; }
      } };
      if (specifier === "@vercel/blob") return {
        del: async () => { blobCalls++; }, put: async () => { blobCalls++; return { url: "https://example.invalid/mock" }; },
      };
      if (specifier === "@/db/drizzle") return { __esModule: true, default: db };
      if (specifier === "@/db/schema/auth-schema") return { userInformation: { userId: "userId", profilePictureUrl: "profilePictureUrl" } };
      if (specifier === "drizzle-orm") return { eq: () => undefined };
      throw new Error(`Unexpected dependency in profile test: ${specifier}`);
    },
  });
  return { handlers: holder.exports, effects, blobCalls: () => blobCalls, profileClears: () => profileClears };
}

test("every custom profile/auth route denies anonymous and banned users before side effects", async () => {
  for (const [path, methods] of protectedRoutes) {
    for (const method of methods) {
      for (const [session, expected] of [[null, 401], [{ user: { id: "self", role: "admin", banned: true } }, 403]] as const) {
        const loaded = loadRoute(path, session);
        const response = await loaded.handlers[method](new Request("https://example.invalid/api/test", { method }));
        assert.equal(response.status, expected, `${path} ${method}`);
        assert.equal(loaded.effects.length, 0);
        assert.equal(loaded.blobCalls(), 0);
        assert.equal(loaded.profileClears(), 0);
      }
    }
  }
});

test("profile mutations reject hostile origins before parsing bodies or using providers", async () => {
  for (const [path, methods] of protectedRoutes) {
    for (const method of methods.filter((value) => value !== "GET")) {
      const loaded = loadRoute(path, { user: { id: "self", role: "user" } });
      const response = await loaded.handlers[method](new Request("https://example.invalid/api/test", { method, headers: { origin: "https://attacker.invalid" } }));
      assert.equal(response.status, 403, path);
      assert.equal(loaded.effects.length, 0);
      assert.equal(loaded.blobCalls(), 0);
    }
  }
});

test("profile updates use session identity rather than body userId", async () => {
  const loaded = loadRoute("app/api/user.information/update/route.ts", { user: { id: "self", role: "user", email: "synthetic@example.invalid" } });
  const response = await loaded.handlers.PUT(new Request("https://example.invalid/api/test", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "victim", username: "synthetic", firstName: "Test", lastName: "Person", email: "synthetic@example.invalid" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(loaded.effects.length, 2);
  assert.ok(loaded.effects.every((effect) => effect.values.includes("self") && !effect.values.includes("victim")));
  assert.ok(loaded.effects.every((effect) => !/UPDATE "user"/.test(effect.query)));
});

test("profile updates reject changed email before database queries", async () => {
  const loaded = loadRoute("app/api/user.information/update/route.ts", { user: { id: "self", role: "user", email: "current@example.invalid" } });
  const response = await loaded.handlers.PUT(new Request("https://example.invalid/api/test", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", firstName: "Test", lastName: "Person", email: "changed@example.invalid" }),
  }));
  assert.equal(response.status, 409);
  assert.equal(loaded.effects.length, 0);
});

test("profile updates accept omitted email and never write the auth user table", async () => {
  const loaded = loadRoute("app/api/user.information/update/route.ts", { user: { id: "self", role: "user", email: "current@example.invalid" } });
  const response = await loaded.handlers.PUT(new Request("https://example.invalid/api/test", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", firstName: "Test", lastName: "Person" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(loaded.effects.length, 2);
  assert.ok(loaded.effects.every((effect) => !/UPDATE "user"/.test(effect.query)));
});

test("profile deletion cannot delete another user's blob via a stored URL", async () => {
  const loaded = loadRoute("app/api/user.information/delete-profile-picture/route.ts", { user: { id: "self", role: "user" } },
    "https://synthetic.public.blob.vercel-storage.com/profile-pictures/victim/image.png");
  const response = await loaded.handlers.DELETE(new Request("https://example.invalid/api/test", { method: "DELETE" }));
  assert.equal(response.status, 200);
  assert.equal(loaded.blobCalls(), 0);
  assert.equal(loaded.profileClears(), 1);
});

test("external and relative avatars can be unlinked without deleting external objects", async () => {
  for (const picture of ["https://example.invalid/avatar.png", "/images/user.profile/user.avatar.webp"]) {
    const loaded = loadRoute("app/api/user.information/delete-profile-picture/route.ts", { user: { id: "self", role: "user" } }, picture);
    const response = await loaded.handlers.DELETE(new Request("https://example.invalid/api/test", { method: "DELETE" }));
    assert.equal(response.status, 200);
    assert.equal(loaded.blobCalls(), 0);
    assert.equal(loaded.profileClears(), 1);
  }
});

test("email enumeration endpoint requires an administrator", async () => {
  const loaded = loadRoute("app/api/auth/check.email/route.ts", { user: { id: "self", role: "user" } });
  const response = await loaded.handlers.GET(new Request("https://example.invalid/api/auth/check.email?email=synthetic@example.invalid"));
  assert.equal(response.status, 403);
  assert.equal(loaded.effects.length, 0);
});
