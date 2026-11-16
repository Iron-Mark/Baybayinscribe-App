import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

function loadMailer(configured: boolean, fail = false, accepted = true) {
  let initializations = 0;
  let sends = 0;
  const logs: unknown[] = [];
  const holder = { exports: {} as { sendEmail: (mail: { to: string; subject: string; text: string }) => Promise<{ success: boolean }> } };
  runInNewContext(transformSync(readFileSync("app/lib/email.ts", "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: holder,
    process: { env: configured ? { NODE_ENV: "development", GMAIL_USER: "synthetic-sender@example.invalid", GMAIL_APP_PASSWORD: "synthetic-not-a-real-password" } : { NODE_ENV: "development" } },
    console: { log: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) },
    require: (specifier: string) => {
      if (specifier === "server-only") return {};
      if (specifier === "nodemailer") return { __esModule: true, default: { createTransport: () => {
        initializations++;
        return { sendMail: async () => {
          sends++;
          if (fail) throw new Error("Synthetic provider failure containing token/private diagnostics");
          return { accepted: accepted ? ["synthetic-recipient@example.invalid"] : [], messageId: "synthetic-message" };
        } };
      } } };
      throw new Error(`Unexpected mail dependency: ${specifier}`);
    },
  });
  return { mailer: holder.exports, initializations: () => initializations, sends: () => sends, logs };
}

const mail = { to: "synthetic-recipient@example.invalid", subject: "Synthetic verification", text: "Synthetic token URL not to be logged" };

test("mail import is inert and missing configuration fails before creating a transport", async () => {
  const loaded = loadMailer(false);
  assert.equal(loaded.initializations(), 0);
  await assert.rejects(loaded.mailer.sendEmail(mail), /not configured/);
  assert.equal(loaded.initializations(), 0);
  assert.equal(loaded.logs.length, 0);
});

test("mailer fails closed on delivery errors and rejected recipients even in development", async () => {
  for (const [fail, accepted] of [[true, true], [false, false]]) {
    const loaded = loadMailer(true, fail, accepted);
    await assert.rejects(loaded.mailer.sendEmail(mail), /Email delivery failed/);
    assert.equal(loaded.sends(), 1);
    assert.equal(loaded.logs.length, 0);
  }
});

test("mailer returns success only for an accepted synthetic recipient without logging content", async () => {
  const loaded = loadMailer(true);
  assert.equal(loaded.initializations(), 0);
  assert.equal((await loaded.mailer.sendEmail(mail)).success, true);
  assert.equal(loaded.initializations(), 1);
  assert.equal(loaded.logs.length, 0);
});
