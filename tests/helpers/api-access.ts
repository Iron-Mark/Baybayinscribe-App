import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

export type TestSession = { user: { id: string; role: string; banned?: boolean; email?: string; emailVerified?: boolean } } | null;
export type TestAccess = {
  requireApiAccess: (request: Request, options?: { admin?: boolean; userId?: string; allowGuest?: boolean }) => Promise<{
    session?: Exclude<TestSession, null>; response?: Response;
  }>;
};

/** Execute the real guard without importing auth configuration or any providers. */
export function loadApiAccess(session: TestSession, failSession = false): TestAccess {
  const holder = { exports: {} as TestAccess };
  const source = readFileSync("lib/auth/api-access.ts", "utf8");
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module: holder, URL, Set, process: { env: {} },
    require: (specifier: string) => {
      if (specifier === "next/server") return { NextResponse: { json: Response.json } };
      if (specifier === "@/app/lib/auth") return { auth: { api: { getSession: async () => {
        if (failSession) throw new Error("Synthetic session failure");
        return session;
      } } } };
      throw new Error(`Unexpected access-guard dependency: ${specifier}`);
    },
  });
  return holder.exports;
}
