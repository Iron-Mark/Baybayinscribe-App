import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { z } from "zod";
import { createPasswordSchema } from "../lib/auth/passwordValidation";

type ResetRequest = { email: string; redirectTo: string };
type RequestOptions = {
  onSuccess: () => void;
  onError: (context: { error: { message: string } }) => void;
};
type HandlerFactory = (options: {
  router: { push: (path: string) => void };
  setError: (message: string) => void;
  setValidationError: (message: string) => void;
  setIsLoading: (loading: boolean) => void;
}) => { handleRequestReset: (values: { email: string }) => Promise<void> };

function loadHandlers(requestPasswordReset: (body: ResetRequest, options: RequestOptions) => Promise<void>) {
  const source = readFileSync("app/(screens)/auth/register/resetpassword/handlers.ts", "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const localRequire = createRequire(import.meta.url);
  const sandbox = { module: { exports: {} as { createResetPasswordHandlers?: HandlerFactory } } };
  runInNewContext(compiled, {
    ...sandbox,
    require: (specifier: string) => {
      if (specifier.endsWith("/auth-client")) return { authClient: { requestPasswordReset } };
      if (specifier === "zod") return { z };
      if (specifier === "@/lib/auth/passwordValidation") return { createPasswordSchema };
      if (specifier === "sonner") return { toast: { success() {}, error() {} } };
      return localRequire(specifier);
    },
    setTimeout: (callback: () => void) => callback(),
  });
  const factory = sandbox.module.exports.createResetPasswordHandlers;
  assert.ok(factory);
  return factory;
}

test("password reset request sends redirectTo in the supported API body", async () => {
  let body: ResetRequest | undefined;
  const factory = loadHandlers(async (request, options) => { body = request; options.onSuccess(); });
  const loading: boolean[] = [];
  const paths: string[] = [];
  const handlers = factory({ router: { push: (path) => paths.push(path) }, setError() {}, setValidationError() {}, setIsLoading: (value) => loading.push(value) });
  await handlers.handleRequestReset({ email: "synthetic@example.invalid" });
  assert.equal(body?.email, "synthetic@example.invalid");
  assert.equal(body?.redirectTo, "/auth/register/resetpassword");
  assert.deepEqual(loading, [true, false]);
  assert.deepEqual(paths, ["/auth/login"]);
});

test("invalid reset email never reaches the authentication API", async () => {
  let calls = 0;
  let validationError = "";
  const handlers = loadHandlers(async () => { calls += 1; })({ router: { push() {} }, setError() {}, setValidationError: (value) => { validationError = value; }, setIsLoading() {} });
  await handlers.handleRequestReset({ email: "invalid" });
  assert.equal(calls, 0);
  assert.ok(validationError);
});
