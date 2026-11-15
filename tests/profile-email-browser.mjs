// Isolated browser checks of real profile components. No app server, DB or mail.
// Run with Node 24; provide PLAYWRIGHT_MODULE_PATH if Playwright is not local.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH || "playwright";
const { chromium } = require(playwrightPath);
const root = process.cwd();
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Desktop from './components/profile.settings/accounts/desktop.profile';
      import Mobile from './components/profile.settings/accounts/mobile.profile';
      import Modal from './components/profile.settings/accounts/modal.profile';
      const userData={firstName:'Synthetic',lastName:'Person',username:'synthetic',email:'current@example.invalid',contactNumber:'09123456789',dateOfBirth:'2000-01-01',profilePictureUrl:null};
      const mode=new URLSearchParams(location.search).get('mode');
      const Component=mode==='modal'?Modal:innerWidth<1024?Mobile:Desktop;
      createRoot(document.getElementById('root')).render(React.createElement(Component,{userData,onClose:()=>{},isOpen:true}));
    `,
    resolveDir: root,
    sourcefile: "profile-email-browser-entry.tsx",
    loader: "tsx",
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "isolate-provider-and-next-integrations",
    setup(plugin) {
      plugin.onResolve({ filter: /^(next\/image|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "qa-stub" }));
      plugin.onResolve({ filter: /auth-client$/ }, () => ({ path: "auth-client", namespace: "qa-stub" }));
      plugin.onLoad({ filter: /.*/, namespace: "qa-stub" }, (args) => ({
        loader: "js", resolveDir: root,
        contents: args.path === "next/image"
          ? `import React from 'react';export default function Image({unoptimized,fill,priority,onError,src,...props}){return React.createElement('img',{...props,src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E'});}`
          : args.path === "next/navigation"
            ? `const router={push(){},refresh(){},replace(){},back(){}};export const useRouter=()=>router;`
            : `export const authClient={changePassword:async()=>{throw new Error('Unexpected password transaction')},signOut:async()=>{throw new Error('Unexpected sign-out transaction')}};`,
      }));
    },
  }],
});

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const mode of ["standalone", "modal"]) {
      for (const scenario of ["pending", "current-verification", "unchanged", "email-failure", "email-retry"]) {
        const context = await browser.newContext({ viewport });
        const requests = [];
        const errors = [];
        const unexpected = [];
        await context.route("**/*", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.hostname !== "profile-fixture.invalid") { unexpected.push(request.url()); return route.abort(); }
          if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
          if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
          if (url.pathname === "/api/user.information/update") {
            requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
            return route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
          }
          if (url.pathname === "/api/user.information/change-email") {
            requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
            // Keep the promise pending briefly to exercise the submit busy guard.
            await new Promise((done) => setTimeout(done, 50));
            const limited = scenario === "email-failure" || (scenario === "email-retry" && requests.filter((item) => item.path.endsWith("/change-email")).length === 1);
            return route.fulfill({
              status: limited ? 429 : 202,
              contentType: "application/json",
              body: limited ? '{"error":"Synthetic email request limit reached"}'
                : JSON.stringify({ status: scenario === "current-verification" ? "current-email-verification-required" : "confirmation-required", emailChangeRequested: scenario !== "current-verification" }),
            });
          }
          unexpected.push(request.url());
          return route.abort();
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://profile-fixture.invalid/fixture?mode=${mode}`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Edit Profile", exact: true }).click();
        const email = page.locator('input[name="email"]');
        await email.waitFor({ state: "visible" });
        if (scenario !== "unchanged") await email.fill("pending@example.invalid");
        const save = page.getByRole("button", { name: /Save Changes|Save Profile|^Save$/i });
        // Two synchronous submit events model double click without waiting for rerender.
        await page.locator("form").evaluate((form) => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        if (scenario === "email-failure" || scenario === "email-retry") {
          await page.getByRole("alert").filter({ hasText: /Profile saved/ }).waitFor();
          assert.equal(await email.isVisible(), true, "Partial failure must keep editor open");
          assert.match(await page.getByRole("alert").innerText(), /current email is unchanged/i);
          await page.waitForTimeout(50);
          assert.equal(await email.inputValue(), "pending@example.invalid", "Partial-save parent updates must preserve the retry draft");
          if (scenario === "email-retry") await save.click();
        }
        if (scenario !== "email-failure") {
          const notice = page.getByRole("status").filter({ hasText: /Profile saved/ });
          await notice.waitFor();
          const text = await notice.innerText();
          if (scenario === "pending" || scenario === "email-retry") assert.match(text, /current mailbox.*new address/i);
          if (scenario === "current-verification") assert.match(text, /Verify your current email/i);
          assert.equal(await email.count(), 0, "Successful save closes editor");
          assert.ok((await page.locator("body").innerText()).includes("current@example.invalid"), "Current email stays displayed");
          assert.ok(!(await page.locator("body").innerText()).includes("pending@example.invalid"), "Pending email is not displayed as active");
        }
        const profileWrites = requests.filter((request) => request.path.endsWith("/update"));
        const emailRequests = requests.filter((request) => request.path.endsWith("/change-email"));
        assert.equal(profileWrites.length, scenario === "email-retry" ? 2 : 1, "Exactly one profile write per explicit submit");
        assert.equal(profileWrites[0].method, "PUT");
        assert.equal("email" in profileWrites[0].body, false, "Profile endpoint never receives email");
        assert.equal(emailRequests.length, scenario === "unchanged" ? 0 : scenario === "email-retry" ? 2 : 1, "At most one email confirmation request per explicit submit");
        for (const request of emailRequests) assert.deepEqual(request.body, { newEmail: "pending@example.invalid" });
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        results.push({ viewport, mode, scenario, profileWrites: profileWrites.length, emailRequests: emailRequests.length, pageErrors: errors.length });
        await context.close();
      }
    }
  }
  console.log(JSON.stringify({ cases: results.length, results, scope: "Actual components, mocked APIs/Next/auth integrations; no CSS/layout or real auth/mail assertion" }));
} finally {
  await browser.close();
}
