import assert from "node:assert/strict";
import test from "node:test";
import { loadApiAccess } from "./helpers/api-access";

const user = { user: { id: "self", role: "user" } };
const admin = { user: { id: "admin", role: "admin" } };
const request = (method = "GET", headers?: HeadersInit) => new Request("https://example.invalid/api/example", { method, headers });

test("real API guard rejects anonymous, banned, cross-user and non-admin requests", async () => {
  for (const [session, options, expected] of [
    [null, {}, 401],
    [{ user: { id: "self", role: "admin", banned: true } }, {}, 403],
    [user, { admin: true }, 403],
    [user, { userId: "other" }, 403],
    [{ user: { id: "self", role: "user,admin" } }, { admin: true }, 403],
  ] as const) {
    assert.equal((await loadApiAccess(session).requireApiAccess(request(), options)).response?.status, expected);
  }
});

test("real API guard preserves authenticated self and admin access", async () => {
  for (const [session, options] of [[user, { userId: "self" }], [admin, { userId: "other", admin: true }]] as const) {
    const access = await loadApiAccess(session).requireApiAccess(request(), options);
    assert.equal(access.response, undefined);
    assert.equal(access.session?.user.id, session.user.id);
  }
});

test("mutations reject hostile/null Origin and browser cross-site requests", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const hostileHeaders: HeadersInit[] = [{ origin: "https://attacker.invalid" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of hostileHeaders) {
      assert.equal((await loadApiAccess(user).requireApiAccess(request(method, headers))).response?.status, 403);
    }
    assert.equal((await loadApiAccess(user).requireApiAccess(request(method, { origin: "https://example.invalid" }))).response, undefined);
    assert.equal((await loadApiAccess(user).requireApiAccess(request(method))).response, undefined);
  }
});

test("session verification failures do not grant access", async () => {
  const access = await loadApiAccess(user, true).requireApiAccess(request());
  assert.equal(access.response?.status, 503);
  assert.equal(access.session, undefined);
});

test('guest access is explicit, read-only, never an owner/admin grant and never an auth-error fallback', async () => {
  const anonymous = loadApiAccess(null);
  const read = await anonymous.requireApiAccess(request(), { allowGuest: true });
  assert.equal(read.response, undefined);
  assert.equal(read.session, null);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await anonymous.requireApiAccess(request(method), { allowGuest: true })).response?.status, 401);
  }
  for (const options of [{ allowGuest: true, admin: true }, { allowGuest: true, userId: 'other' }]) {
    assert.equal((await anonymous.requireApiAccess(request(), options)).response?.status, 401);
  }
  assert.equal((await loadApiAccess(null, true).requireApiAccess(request(), { allowGuest: true })).response?.status, 503);
  assert.equal((await loadApiAccess({ user: { id: 'banned', role: 'admin', banned: true } }).requireApiAccess(request(), { allowGuest: true })).response?.status, 403);
});
