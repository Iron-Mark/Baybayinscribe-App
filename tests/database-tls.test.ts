import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { rootCertificates } from "node:tls";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { Client, Pool, type PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as orm from "drizzle-orm";
import { sql } from "drizzle-orm";
import { DatabasePool, databasePoolOptions } from "../db/pool";
import * as authSchema from "../db/schema/auth-schema";
import * as fileSchema from "../db/schema/file-schema";
import * as lessonSchema from "../db/schema/learning-resources";
import * as quizSchema from "../db/schema/quiz-schema";

const databaseUrl = "postgresql://synthetic:synthetic@database.example.invalid/app";

function effectiveSsl(config: PoolConfig) {
  // Constructing a Client parses its effective settings but does not connect.
  return (new Client(config) as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;
}

test("database TLS verifies certificates by default in development and production", () => {
  for (const NODE_ENV of ["development", "production"]) {
    const options = databasePoolOptions({ DATABASE_URL: databaseUrl, NODE_ENV });
    assert.deepEqual(effectiveSsl(options), { rejectUnauthorized: true });
  }
});

test("safe redundant URL TLS flags cannot replace the verified SSL object", () => {
  const ca = rootCertificates[0];
  for (const flag of ["sslmode=require", "sslmode=verify-full", "ssl=true", "ssl=1"]) {
    const options = databasePoolOptions({
      DATABASE_URL: `${databaseUrl}?${flag}`,
      DATABASE_CA_CERT: ca.replace(/\n/g, "\\n"),
      NODE_ENV: "production",
    });
    assert.deepEqual(effectiveSsl(options), { rejectUnauthorized: true, ca: ca.trim() });
    assert.equal(new URL(options.connectionString!).search, "");
  }
});

test("insecure URL TLS flags and certificate-file overrides fail closed", () => {
  for (const flag of ["sslmode=disable", "sslmode=no-verify", "sslmode=prefer", "sslmode=verify-ca", "ssl=no-verify", "ssl=0", "ssl=false", "sslrootcert=untrusted.pem", "sslcert=client.pem", "sslkey=client.key", "uselibpqcompat=true", "sslmode=require&sslmode=no-verify"]) {
    assert.throws(() => databasePoolOptions({ DATABASE_URL: `${databaseUrl}?${flag}`, NODE_ENV: "production" }), /TLS overrides/);
  }
});

test("plaintext access requires explicit loopback development configuration", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(databasePoolOptions({ DATABASE_URL: `postgresql://synthetic@${host}/app`, DATABASE_SSL_MODE: "disable", NODE_ENV: "development" }).ssl, false);
  }
  for (const env of [
    { DATABASE_URL: databaseUrl },
    { DATABASE_URL: "postgresql://synthetic@127.0.0.1/app", NODE_ENV: "production" },
    { DATABASE_URL: "postgresql://synthetic@127.0.0.1/app", NODE_ENV: "development", VERCEL: "1" },
    { DATABASE_URL: "postgresql://synthetic@127.0.0.1/app?host=database.example.invalid", NODE_ENV: "development" },
  ]) {
    assert.throws(() => databasePoolOptions({ ...env, DATABASE_SSL_MODE: "disable" }), /loopback development/);
  }
});

test("missing, malformed and unsupported database settings fail without echoing credentials", () => {
  for (const DATABASE_URL of [undefined, "", " "]) assert.throws(() => databasePoolOptions({ DATABASE_URL }), /DATABASE_URL is required/);
  for (const DATABASE_URL of ["not-a-url", "https://private-user:private-password@database.example.invalid/app"]) {
    assert.throws(() => databasePoolOptions({ DATABASE_URL }), (error) => error instanceof Error && !error.message.includes("private-password") && /PostgreSQL URL/.test(error.message));
  }
  assert.throws(() => databasePoolOptions({ DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "prefer" }), /DATABASE_SSL_MODE/);
  assert.throws(() => databasePoolOptions({ DATABASE_URL: databaseUrl, DATABASE_CA_CERT: "/private/ca.pem" }), /PEM CA certificate/);
});

test("an unconfigured Pool remains import-safe but promise/callback operations fail before networking", async () => {
  const pool = new DatabasePool({});
  assert.ok(pool instanceof Pool);
  assert.equal(pool.totalCount, 0);
  await assert.rejects(pool.connect(), /DATABASE_URL is required/);
  await assert.rejects(pool.query("SELECT 1"), /DATABASE_URL is required/);
  await new Promise<void>((resolve, reject) => pool.connect((error, client, release) => {
    try {
      assert.match(error!.message, /DATABASE_URL is required/);
      assert.equal(client, undefined);
      assert.equal(typeof release, "function");
      resolve();
    } catch (failure) { reject(failure); }
  }));
  await new Promise<void>((resolve, reject) => pool.query("SELECT 1", (error) => {
    try { assert.match(error.message, /DATABASE_URL is required/); resolve(); }
    catch (failure) { reject(failure); }
  }));
  assert.equal(pool.totalCount, 0);
  await pool.end();
});

test("Drizzle retains actual Pool transaction semantics without a configured database", async () => {
  const pool = new DatabasePool({});
  const db = drizzle({ client: pool });
  assert.equal(db.$client, pool);
  await assert.rejects(db.transaction(async (tx) => tx.execute(sql`select 1`)), /DATABASE_URL is required/);
  assert.equal(pool.totalCount, 0);
  await pool.end();
});

test("configured connections delegate promise and callback APIs with the real Pool receiver", async () => {
  const connectOwner: object = Object.getPrototypeOf(Pool.prototype);
  const original = Object.getOwnPropertyDescriptor(connectOwner, "connect")!;
  const pool = new DatabasePool({ DATABASE_URL: databaseUrl });
  const client = {} as import("pg").PoolClient;
  const receivers: Pool[] = [];
  try {
    Object.defineProperty(connectOwner, "connect", { ...original, value: function (
      this: Pool,
      callback?: (error: Error | undefined, client: import("pg").PoolClient | undefined, release: () => void) => void,
    ) {
      receivers.push(this);
      if (callback) { callback(undefined, client, () => {}); return; }
      return Promise.resolve(client);
    } });
    assert.equal(await pool.connect(), client);
    await new Promise<void>((resolve, reject) => pool.connect((error, connected, release) => {
      try { assert.equal(error, undefined); assert.equal(connected, client); assert.equal(typeof release, "function"); resolve(); }
      catch (failure) { reject(failure); }
    }));
    assert.deepEqual(receivers, [pool, pool]);
    assert.equal(pool.totalCount, 0);
  } finally {
    Object.defineProperty(connectOwner, "connect", original);
    await pool.end();
  }
});

test("all runtime database routes share the verified pool rather than constructing another client", () => {
  const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? visit(full) : full.endsWith(".ts") ? [full] : [];
  });
  for (const file of visit("app/api")) assert.doesNotMatch(readFileSync(file, "utf8"), /new\s+Pool\s*\(|rejectUnauthorized\s*:\s*false/, file);
  assert.match(readFileSync("db/drizzle.ts", "utf8"), /drizzle\(\{ client: pool \}\)/);
});

test("guest content GET routes handle unconfigured DATABASE_URL without 500 error spam", async () => {
  const pool = new DatabasePool({});
  const unconfiguredDb = drizzle({ client: pool });
  const errors: unknown[][] = [];
  const next = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
  const compile = <T>(file: string, deps: Record<string, unknown>): T => {
    const mod = { exports: {} as T };
    runInNewContext(transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs" }).code, {
      module: mod,
      exports: mod.exports,
      Request,
      Response,
      Headers,
      URL,
      crypto,
      console: { log() {}, error: (...args: unknown[]) => errors.push(args) },
      require(specifier: string) {
        if (specifier in deps) return deps[specifier];
        throw new Error(`Unexpected import ${specifier} in ${file}`);
      },
    });
    return mod.exports;
  };
  const access = {
    requireApiAccess: async () => ({ session: null }),
  };
  const commonDeps: Record<string, unknown> = {
    "next/server": next,
    "drizzle-orm": orm,
    "@/db/drizzle": unconfiguredDb,
    "@/db/schema/learning-resources": lessonSchema,
    "@/db/schema/quiz-schema": quizSchema,
    "@/db/schema/file-schema": fileSchema,
    "@/db/schema/auth-schema": authSchema,
    "@/lib/auth/api-access": access,
    "@/app/store/server/server.store.modules": { useModuleStore: { getState: () => { throw new Error("Store must not run"); } } },
  };
  commonDeps["@/lib/auth/lesson-access"] = compile("lib/auth/lesson-access.ts", commonDeps);

  type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const req = () => new Request("https://app.invalid/api/guest", { method: "GET" });
  const ctx = () => ({ params: Promise.resolve({ quiz_id: "sample", resource_id: "sample", module_id: "sample" }) });

  try {
    for (const file of ["app/api/lessons/all/route.ts", "app/api/quiz/all/route.ts"]) {
      const route = compile<{ GET: Handler }>(file, commonDeps);
      const res = await route.GET(req(), ctx());
      assert.equal(res.status, 200, file);
      assert.deepEqual(await res.json(), [], file);
    }
    for (const file of [
      "app/api/quiz/get/[quiz_id]/route.ts",
      "app/api/lessons/[resource_id]/route.ts",
      "app/api/lessons/[resource_id]/modules/route.ts",
      "app/api/lessons/[resource_id]/module/[module_id]/route.ts",
    ]) {
      const route = compile<{ GET: Handler }>(file, commonDeps);
      const res = await route.GET(req(), ctx());
      assert.equal(res.status, 404, file);
    }
    assert.equal(errors.length, 0, "unconfigured database must not emit console.error logs");

    const failingDb = {
      $count: () => 0,
      select: () => {
        const chain = {
          from: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          orderBy: () => chain,
          groupBy: () => Promise.reject(new Error("Connection reset")),
          then: (_res: unknown, rej: (e: Error) => unknown) => Promise.reject(new Error("Connection reset")).then(_res as never, rej),
        };
        return chain;
      },
    };
    for (const file of ["app/api/lessons/all/route.ts", "app/api/quiz/all/route.ts"]) {
      const route = compile<{ GET: Handler }>(file, { ...commonDeps, "@/db/drizzle": failingDb });
      const res = await route.GET(req(), ctx());
      assert.equal(res.status, 500, `${file} should still return 500 for unexpected DB errors`);
    }
  } finally {
    await pool.end();
  }
});
