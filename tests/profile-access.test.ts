import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { loadApiAccess } from "./helpers/api-access";

type Session = { user: { id: string; role: string } } | null;
type ResponseValue = { body: unknown; status: number };
type Route = { GET: (request: Request, context: { params: Promise<{ userId: string }> }) => Promise<ResponseValue> };

function loadProfileRoute(session: Session) {
  let queries = 0;
  let queryValues: unknown[] = [];
  const sandbox = { module: { exports: {} as Route } };
  const source = readFileSync("app/api/user.information/[userId]/route.ts", "utf8");
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    ...sandbox,
    process: { env: { NODE_ENV: "test" } },
    console,
    require: (specifier: string) => {
      if (specifier === "next/server") return { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } };
      if (specifier === "@/lib/auth/api-access") return loadApiAccess(session);
      if (specifier === "pg") return { Pool: class { async query(_sql: string, values: unknown[]) { queries += 1; queryValues = values; return { rows: [{ username: "synthetic" }] }; } } };
      throw new Error(`Unexpected module in isolated route test: ${specifier}`);
    },
  });
  return { route: sandbox.module.exports, queries: () => queries, queryValues: () => queryValues };
}

test("anonymous and cross-user profile requests fail before database access", async () => {
  for (const [session, status] of [[null, 401], [{ user: { id: "other-user", role: "user" } }, 403]] as const) {
    const loaded = loadProfileRoute(session);
    const result = await loaded.route.GET(new Request("https://example.invalid/api/user.information/target-user"), { params: Promise.resolve({ userId: "target-user" }) });
    assert.equal(result.status, status);
    assert.equal(loaded.queries(), 0);
  }
});

test("profile owners and administrators retain parameterized profile access", async () => {
  for (const session of [{ user: { id: "target-user", role: "user" } }, { user: { id: "admin-user", role: "admin" } }]) {
    const loaded = loadProfileRoute(session);
    const result = await loaded.route.GET(new Request("https://example.invalid/api/user.information/target-user"), { params: Promise.resolve({ userId: "target-user" }) });
    assert.equal(result.status, 200);
    assert.equal(loaded.queries(), 1);
    assert.equal(loaded.queryValues()[0], "target-user");
  }
});
