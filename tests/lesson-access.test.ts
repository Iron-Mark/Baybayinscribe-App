import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import * as lessonSchema from "../db/schema/learning-resources";
import * as authSchema from "../db/schema/auth-schema";
import * as fileSchema from "../db/schema/file-schema";
import * as quizSchema from "../db/schema/quiz-schema";
import * as orm from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

type Viewer = { id: string; role: string; banned?: boolean };
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteExports = Record<string, Handler>;

function compileModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = { exports: {} };
  runInNewContext(transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: output, exports: output.exports, Request, Response, Headers, URL, crypto,
    process: { env: {} }, console: { log() {}, error() {} },
    require(specifier: string) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });
  return output.exports as T;
}

function harness(path: string, viewer: Viewer | null, options: { readable?: boolean; moduleExists?: boolean; fixtures?: unknown[][] } = {}) {
  let databaseCalls = 0;
  let storeCalls = 0;
  const storedArguments: unknown[][] = [];
  const predicates: unknown[] = [];
  const values: unknown[] = [];
  const helperCalls: unknown[][] = [];
  const next = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
  const access = compileModule<{ requireApiAccess: (request: Request, options?: unknown) => Promise<unknown> }>("lib/auth/api-access.ts", {
    "next/server": next,
    "@/app/lib/auth": { auth: { api: { getSession: async () => viewer ? { user: viewer } : null } } },
  });
  const db = {
    select() {
      const fixture = options.fixtures?.[databaseCalls] ?? [];
      databaseCalls += 1;
      const chain = {
        from() { return chain; },
        where(predicate: unknown) { predicates.push(predicate); return chain; },
        leftJoin() { return chain; },
        orderBy() { return chain; },
        limit() { return chain; },
        then<TResult1 = unknown[], TResult2 = never>(onfulfilled?: ((result: unknown[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
          return Promise.resolve(fixture).then(onfulfilled, onrejected);
        },
      };
      return chain;
    },
    insert() {
      databaseCalls += 1;
      return { values(value: unknown) { values.push(value); return { returning: async () => [value] }; } };
    },
    delete() { databaseCalls += 1; return { where: async (predicate: unknown) => { predicates.push(predicate); return []; } }; },
  };
  const store = {
    getState() {
      storeCalls += 1;
      return Object.fromEntries(["createLesson", "deleteLesson", "updateLesson", "createModule", "deleteModule", "updateModule", "getModule", "getModules"].map((key) => [key, async (...args: unknown[]) => {
        storedArguments.push(args);
        return key.startsWith("get") ? [] : { id: "created" };
      }]));
    },
  };
  const lessonAccess = {
    async findReadableLesson(...args: unknown[]) { helperCalls.push(args); return options.readable === false ? null : { id: "lesson", is_visible: true }; },
    async findLessonModule(...args: unknown[]) { helperCalls.push(args); return options.moduleExists === false ? null : { id: "module" }; },
  };
  const dependencies = {
    "next/server": next, "@/db/drizzle": db, "drizzle-orm": orm,
    "@/db/schema/learning-resources": lessonSchema, "@/db/schema/auth-schema": authSchema,
    "@/db/schema/file-schema": fileSchema, "@/db/schema/quiz-schema": quizSchema, "@/lib/auth/api-access": access,
    "@/lib/auth/lesson-access": lessonAccess,
    "@/app/store/server/server.store.lr": { useServerLrStore: store },
    "@/app/store/server/server.store.modules": { useModuleStore: store },
  };
  return {
    route: compileModule<RouteExports>(path, dependencies),
    databaseCalls: () => databaseCalls, storeCalls: () => storeCalls,
    storedArguments, predicates, values, helperCalls,
    loadLessonAccess: () => compileModule<{ findReadableLesson: (resource: string, user: Viewer) => Promise<unknown>; findLessonModule: (resource: string, module: string, byFile?: boolean) => Promise<unknown> }>("lib/auth/lesson-access.ts", dependencies),
  };
}

const base = "app/api/lessons/";
const context = (overrides: Record<string, string> = {}) => ({ params: Promise.resolve({ resource_id: "lesson", module_id: "module", user_id: "owner", ...overrides }) });
const request = (method: string, body: unknown = {}) => new Request("https://example.invalid/api/lessons/test", {
  method, headers: { "content-type": "application/json", origin: "https://example.invalid" },
  ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
const adminRoutes = [
  ["create/route.ts", "POST"], ["[resource_id]/delete/route.ts", "DELETE"],
  ["[resource_id]/update/route.ts", "PUT"], ["[resource_id]/module/create/route.ts", "POST"],
  ["[resource_id]/module/[module_id]/delete/route.ts", "DELETE"],
  ["[resource_id]/module/[module_id]/update/route.ts", "PUT"],
  ["[resource_id]/module/[module_id]/update/route.ts", "PATCH"],
] as const;
const learnerRoutes = [
  ["all/route.ts", "GET"], ["my/route.ts", "POST"], ["[resource_id]/route.ts", "POST"],
  ["[resource_id]/modules/route.ts", "GET"], ["[resource_id]/module/[module_id]/route.ts", "GET"],
  ["[resource_id]/module/[module_id]/finish/route.ts", "POST"],
  ["progress/[user_id]/clear/route.ts", "POST"], ["progress/[user_id]/last/route.ts", "GET"],
  ["progress/[user_id]/quiz/average/route.ts", "GET"],
] as const;

test("private lesson handlers deny anonymous requests before stores/database work", async () => {
  for (const [path, method] of [...adminRoutes, ...learnerRoutes]) {
    if (method === 'GET' && ['all/route.ts', '[resource_id]/modules/route.ts', '[resource_id]/module/[module_id]/route.ts'].includes(path)) continue;
    const loaded = harness(base + path, null);
    const result = await loaded.route[method](request(method), context());
    assert.equal(result.status, 401, `${method} ${path}`);
    assert.equal(loaded.databaseCalls(), 0, path);
    assert.equal(loaded.storeCalls(), 0, path);
    assert.equal(loaded.helperCalls.length, 0, path);
  }
});

test('guest lesson listing filters hidden content and detail never queries account progress', async () => {
  const listing = harness(base + 'all/route.ts', null);
  assert.equal((await listing.route.GET(request('GET'), context())).status, 200);
  const dialect = new PgDialect();
  const sql = dialect.sqlToQuery(listing.predicates[0] as orm.SQL);
  assert.ok(sql.sql.includes('is_visible'));
  assert.deepEqual(sql.params, [true]);
  const detail = harness(base + '[resource_id]/route.ts', null, { fixtures: [[{
    learning_resource: { id: 'lesson', created_by: 'author' },
    learning_resource_module: { id: 'module' }, file: null,
  }], [{ id: 'author', name: 'Author' }]] });
  const response = await detail.route.GET(new Request('https://example.invalid/api/lessons/lesson?userId=victim'), context());
  assert.equal(response.status, 200);
  assert.equal(detail.databaseCalls(), 2, 'content and author only, no progress lookup');
  assert.equal((await response.json()).learning_resource_module[0].is_finished, false);
  const hidden = harness(base + '[resource_id]/route.ts', null);
  assert.equal((await hidden.route.GET(request('GET'), context())).status, 404);
});

test('guest module reads require a visible parent and matching module URL', async () => {
  for (const path of ['[resource_id]/modules/route.ts', '[resource_id]/module/[module_id]/route.ts']) {
    const allowed = harness(base + path, null);
    assert.equal((await allowed.route.GET(request('GET'), context())).status, 200);
    const hidden = harness(base + path, null, { readable: false });
    assert.equal((await hidden.route.GET(request('GET'), context())).status, 404);
    assert.equal(hidden.storeCalls(), 0);
  }
  const mismatch = harness(base + '[resource_id]/module/[module_id]/route.ts', null, { moduleExists: false });
  assert.equal((await mismatch.route.GET(request('GET'), context())).status, 404);
  assert.equal(mismatch.storeCalls(), 0);
});

test("every lesson/module CRUD handler denies ordinary users before side effects", async () => {
  for (const [path, method] of adminRoutes) {
    const loaded = harness(base + path, { id: "owner", role: "user" });
    assert.equal((await loaded.route[method](request(method), context())).status, 403, path);
    assert.equal(loaded.databaseCalls() + loaded.storeCalls() + loaded.helperCalls.length, 0, path);
  }
});

test("every lesson handler denies banned sessions before data access", async () => {
  for (const [path, method] of [...adminRoutes, ...learnerRoutes]) {
    const loaded = harness(base + path, { id: "owner", role: "admin", banned: true });
    assert.equal((await loaded.route[method](request(method), context())).status, 403, path);
    assert.equal(loaded.databaseCalls() + loaded.storeCalls() + loaded.helperCalls.length, 0, path);
  }
});

test("progress reads and clear require the matching user or administrator", async () => {
  for (const [path, method] of learnerRoutes.filter(([path]) => path.startsWith("progress/"))) {
    const denied = harness(base + path, { id: "intruder", role: "user" });
    assert.equal((await denied.route[method](request(method), context())).status, 403, path);
    assert.equal(denied.databaseCalls(), 0);
    for (const viewer of [{ id: "owner", role: "user" }, { id: "administrator", role: "admin" }]) {
      const loaded = harness(base + path, viewer, { fixtures: [[{ totalAnswers: 0, correctAnswers: 0, quizzesAnswered: 0 }]] });
      assert.equal((await loaded.route[method](request(method), context())).status, 200, path);
      assert.ok(loaded.databaseCalls() > 0);
    }
  }
});

test("completion rejects impersonation and mismatched module parents before progress writes", async () => {
  const path = base + "[resource_id]/module/[module_id]/finish/route.ts";
  const denied = harness(path, { id: "owner", role: "user" });
  assert.equal((await denied.route.POST(request("POST", { userId: "victim" }), context())).status, 403);
  assert.equal(denied.databaseCalls(), 0);
  for (const options of [{ readable: false }, { moduleExists: false }]) {
    const missing = harness(path, { id: "owner", role: "user" }, options);
    assert.equal((await missing.route.POST(request("POST", { userId: "owner" }), context())).status, 404);
    assert.equal(missing.databaseCalls(), 0);
  }
  const allowed = harness(path, { id: "owner", role: "user" });
  assert.equal((await allowed.route.POST(request("POST"), context())).status, 201);
  assert.equal(Reflect.get(allowed.values[0] as object, "user_id"), "owner");
});

test("administrator creation binds author to the session; updates bind the path ID", async () => {
  const admin = { id: "administrator", role: "admin" };
  const created = harness(base + "create/route.ts", admin);
  assert.equal((await created.route.POST(request("POST", { title: "Lesson", description: "Description", created_by: "spoofed" }), context())).status, 201);
  assert.equal(created.storedArguments[0][2], "administrator");
  const update = harness(base + "[resource_id]/update/route.ts", admin);
  assert.equal((await update.route.PUT(request("PUT", { id: "other", title: "Lesson" }), context())).status, 400);
  assert.equal(update.storeCalls(), 0);
  assert.equal((await update.route.PUT(request("PUT", { title: "Lesson", created_by: "spoofed" }), context())).status, 200);
  assert.equal(Reflect.get(update.storedArguments[0][0] as object, "id"), "lesson");
  assert.equal(Reflect.has(update.storedArguments[0][0] as object, "created_by"), false);
});

test("hidden/module-mismatch reads return 404 without fetching content", async () => {
  for (const path of ["[resource_id]/modules/route.ts", "[resource_id]/module/[module_id]/route.ts"]) {
    const loaded = harness(base + path, { id: "owner", role: "user" }, { readable: false });
    assert.equal((await loaded.route.GET(request("GET"), context())).status, 404);
    assert.equal(loaded.storeCalls(), 0);
  }
  const loaded = harness(base + "[resource_id]/module/[module_id]/route.ts", { id: "owner", role: "user" }, { moduleExists: false });
  assert.equal((await loaded.route.GET(request("GET"), context())).status, 404);
  assert.equal(loaded.storeCalls(), 0);
  assert.equal(loaded.helperCalls[1][2], true, "View URLs must use their established file-ID contract");
});

test("administrator module edits cannot target another lesson's module", async () => {
  for (const [path, method] of adminRoutes.filter(([path]) => path.includes("[module_id]"))) {
    const loaded = harness(base + path, { id: "administrator", role: "admin" }, { moduleExists: false });
    assert.equal((await loaded.route[method](request(method), context())).status, 404, path);
    assert.equal(loaded.storeCalls(), 0);
    assert.deepEqual(Array.from(loaded.helperCalls[0]), ["lesson", "module"]);
  }
});

test("lesson listing includes a visibility filter for learners but not administrators", async () => {
  const dialect = new PgDialect();
  for (const role of ["user", "admin"]) {
    const loaded = harness(base + "all/route.ts", { id: "owner", role });
    assert.equal((await loaded.route.GET(request("GET"), context())).status, 200);
    if (role === "admin") assert.equal(loaded.predicates[0], undefined);
    else {
      const query = dialect.sqlToQuery(loaded.predicates[0] as orm.SQL);
      assert.match(query.sql, /is_visible/);
      assert.deepEqual(query.params, [true]);
    }
  }
});

test("lesson visibility and module parent predicates are enforced in SQL", async () => {
  const loaded = harness(base + "all/route.ts", { id: "owner", role: "user" });
  const helper = loaded.loadLessonAccess();
  await helper.findReadableLesson("lesson", { id: "owner", role: "user" });
  await helper.findLessonModule("lesson", "module");
  const dialect = new PgDialect();
  const visibility = dialect.sqlToQuery(loaded.predicates[0] as orm.SQL);
  assert.match(visibility.sql, /is_visible/);
  assert.ok(visibility.params.includes(true));
  const modulePredicate = dialect.sqlToQuery(loaded.predicates[1] as orm.SQL);
  assert.match(modulePredicate.sql, /learning_resource_id/);
  assert.deepEqual(modulePredicate.params, ["lesson", "module"]);
});
