import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { isPromise } from "../lib/isPromise";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createPasswordSchema,
  createRegistrationSchema,
} from "../lib/auth/passwordValidation";

const syntheticPassword = "Tala#4827Bughaw";

test("promise detection accepts promises and rejects non-callable then values", () => {
  assert.equal(isPromise(Promise.resolve("synthetic")), true);
  assert.equal(isPromise({ then: () => undefined }), true);
  for (const value of [null, undefined, false, 0, "then", {}, { then: true }]) {
    assert.equal(isPromise(value), false);
  }
});

test("Zod 4 preserves password validation and exposes issues to the UI", () => {
  const result = createPasswordSchema().safeParse("weak");
  assert.equal(result.success, false);
  if (result.success) assert.fail("Weak passwords must not validate");
  assert.ok(result.error.issues.length > 0);
  assert.equal(typeof result.error.issues[0].message, "string");
  assert.equal(createPasswordSchema().safeParse(syntheticPassword).success, true);
});

test("registration validation preserves password confirmation paths", () => {
  const result = createRegistrationSchema().safeParse({
    email: "synthetic-security-test@example.invalid",
    password: syntheticPassword,
    confirmPassword: `${syntheticPassword}!`,
  });
  assert.equal(result.success, false);
  if (result.success) assert.fail("Different passwords must not validate");
  assert.ok(result.error.issues.some((issue) => issue.path[0] === "confirmPassword"));
});

test("registration accepts a valid synthetic payload", () => {
  assert.equal(createRegistrationSchema().safeParse({
    email: "synthetic-security-test@example.invalid",
    password: syntheticPassword,
    confirmPassword: syntheticPassword,
  }).success, true);
});

test("React Hook Form receives Zod 4 password-confirmation errors", async () => {
  const resolve = zodResolver(createRegistrationSchema());
  const result = await resolve({
    email: "synthetic-security-test@example.invalid",
    password: syntheticPassword,
    confirmPassword: `${syntheticPassword}!`,
  }, {}, { fields: {}, shouldUseNativeValidation: false });
  assert.ok("confirmPassword" in result.errors);
  const confirmationError = result.errors.confirmPassword;
  assert.ok(confirmationError && typeof confirmationError === "object" && "message" in confirmationError);
  assert.equal(typeof confirmationError.message, "string");

  const valid = await resolve({
    email: "synthetic-security-test@example.invalid",
    password: syntheticPassword,
    confirmPassword: syntheticPassword,
  }, {}, { fields: {}, shouldUseNativeValidation: false });
  assert.deepEqual(valid.errors, {});
  assert.ok("email" in valid.values);
  assert.equal(valid.values.email, "synthetic-security-test@example.invalid");
});

test("application validation paths do not use Zod's removed error.errors API", () => {
  function inspect(folder: string) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const usesRemovedApi = /\.error(?:\?\.|\.)errors\b/.test(readFileSync(path, "utf8"));
        assert.equal(usesRemovedApi, false, `Removed Zod API consumer: ${path}`);
      }
    }
  }
  for (const folder of ["app", "components", "lib"]) inspect(join(process.cwd(), folder));
});

test("Nodemailer renders a message locally without connecting to SMTP", async () => {
  const transport = nodemailer.createTransport({
    jsonTransport: true,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const message = await transport.sendMail({
    from: "synthetic-sender@example.invalid",
    to: "synthetic-recipient@example.invalid",
    subject: "Synthetic compatibility test - not delivered",
    text: "No external delivery is performed by this test.",
  });
  const serialized = JSON.parse(message.message.toString());
  assert.equal(serialized.subject, "Synthetic compatibility test - not delivered");
  assert.equal(serialized.to[0].address, "synthetic-recipient@example.invalid");
});

test("Drizzle generates a parameterized query without opening a database", () => {
  const table = pgTable("synthetic_compatibility", { name: text("name") });
  const query = drizzle.mock().select().from(table).where(eq(table.name, "value' OR 1=1 --")).toSQL();
  assert.ok(query.sql.includes("$1"));
  assert.ok(!query.sql.includes("OR 1=1"));
  assert.deepEqual(query.params, ["value' OR 1=1 --"]);
});

test("Next.js resolves a working patched Sharp image processor", async () => {
  const requireFromNext = createRequire(join(process.cwd(), "node_modules", "next", "package.json"));
  const sharp = requireFromNext("sharp");
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  }).png().toBuffer();
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.format, "png");
});

test("the legacy Drizzle loader uses patched esbuild for sync and async transforms", async () => {
  const requireFromRoot = createRequire(join(process.cwd(), "package.json"));
  const loaderPath = requireFromRoot.resolve("@esbuild-kit/core-utils");
  const requireFromLoader = createRequire(loaderPath);
  const version: string = requireFromLoader("esbuild/package.json").version;
  assert.match(version, /^0\.25\./);
  assert.ok(Number(version.split(".")[2]) >= 12);

  const loader = requireFromRoot("@esbuild-kit/core-utils");
  const source = "export const answer: number = 42;";
  const outputs = [
    loader.transformSync(source, "synthetic-loader-check.ts", { format: "cjs" }),
    await loader.transform(source, "synthetic-loader-check.ts", { format: "cjs" }),
  ];
  for (const output of outputs) {
    const testModule = { exports: {} as { answer?: number } };
    runInNewContext(output.code, { module: testModule, exports: testModule.exports });
    assert.equal(testModule.exports.answer, 42);
  }
});

test("glob overrides preserve the callback API required by legacy rimraf callers", () => {
  const requireFromRoot = createRequire(join(process.cwd(), "package.json"));
  for (const owner of ["del", "@tensorflow-models/face-detection"]) {
    const requireFromOwner = createRequire(requireFromRoot.resolve(owner));
    const requireFromRimraf = createRequire(requireFromOwner.resolve("rimraf"));
    const glob = requireFromRimraf("glob");
    assert.equal(typeof glob, "function", `${owner} still requires glob's callback API`);
    assert.equal(typeof glob.sync, "function");
  }

  const requireFromModernRimraf = createRequire(requireFromRoot.resolve("rimraf"));
  assert.equal(typeof requireFromModernRimraf("glob").glob, "function");
});
