# Verified email changes

Profile saves and email changes are separate operations. The profile endpoint
never writes `user.email`; changed email values sent there are rejected with 409
before any profile query. Omitted or unchanged email values remain compatible.

Desktop and mobile editors save profile data once without email. If the desired
address differs, they then POST `{ "newEmail": "..." }` to
`/api/user.information/change-email`. The displayed current address is retained
until the auth service completes verification. A mail-request failure after the
profile save is reported as partial success, not as an email update.

## Confirmation states

- `confirmation-required` (202): confirm in the **current verified mailbox**,
  then follow the verification link in the **new mailbox**. The address is not
  changed by merely submitting the form or clicking the first link.
- `current-email-verification-required` (202): the current address has not been
  verified. Verify it first, then request the desired change again. The server
  does not retain or silently apply the requested new address at this stage.

The authenticated actor must be unbanned, with a current verified address and a
session created within 15 minutes to request the change. An older session must
sign out/sign in again. These checks also protect direct Better Auth
`/change-email` requests, not just the custom wrapper. Token confirmation uses
the installed library's signed, expiring, user/current-email-bound flow; it
rejects a different logged-in actor. Callback navigation is fixed to
`/auth/login` by the wrapper, with automatic sign-in disabled.

The wrapper dispatches through Better Auth's local HTTP handler so configured
rate limits and hooks are preserved; it does not make an external network call.
Auth errors and 429 responses are passed through. Existing-email requests use
the library's non-enumerating acknowledgement: a 202 is a pending request, not
proof that delivery or account ownership succeeded.
Configured HTTP limits are five initiation/resend requests per hour and fifteen
token-verification requests per hour per IP, subject to the storage caveat below.

## Mail setup and verification

Mail requires server-only `GMAIL_USER` and `GMAIL_APP_PASSWORD`, plus correct
site/auth URLs and the existing auth secret. Missing configuration or transport
failure throws in development and production. Verification/reset URLs, tokens,
recipients and provider credential errors are not logged. Do not place these
credentials in `NEXT_PUBLIC_*` variables.

Local tests use isolated mail/session/database stubs and an in-memory auth
adapter, not real SMTP or user accounts. Before rollout, separately approve a
staging test with controlled old/new mailboxes and the reviewed database
migrations. Verify recent-login enforcement, both mailbox steps, expired and
wrong-actor tokens, completed-change replay rejection, transport failure and
rate limits. Check cookie/session refresh and sign-in with the new address.

The old confirmation token can request another new-mailbox verification while
it remains valid and the change is incomplete; it is not claimed single-use.
HTTP verification rate limiting bounds that path locally. Distributed/global
rate-limit guarantees depend on the deployment's configured storage; a process
memory limiter alone is not a cross-instance quota.

## Local checks

Run `npm run test:security`, `npm run lint`, `npm run typecheck` and
`npm run build` with Node 24. Run typecheck and build **sequentially** because
both regenerate `.next/types`; parallel execution can produce missing-file
diagnostics unrelated to source correctness.

`node tests/profile-email-browser.mjs` checks the real profile components in an
isolated browser fixture with mocked APIs, auth and Next integrations. Reuse an
installed Playwright package/browser; if they are outside this checkout, provide
`PLAYWRIGHT_MODULE_PATH` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` explicitly. It checks
request counts, current/pending email state and failure/retry behavior, not CSS,
real authentication, SMTP delivery or database migration behavior.

## Optional local database + mail smoke check

For maintenance without staging accounts, `tests/local-auth-smoke.mjs` uses a
disposable PostgreSQL/WASM database and an SMTP capture bound to `127.0.0.1` on
an automatically selected port. It loads no `.env` files, contacts no existing
database, and sends no external mail. No app runtime dependencies or Gmail
configuration are changed. The real mail helper's destination is injected only
inside the test, while the actual auth configuration, Drizzle adapter, SQL and
Nodemailer SMTP delivery are exercised.

Install the two optional tools outside the checkout once, then run from the repo
with Node 24 (existing installation shown):

```powershell
$env:BAYBAYINSCRIBE_SMOKE_TOOLS = 'C:\Users\Admin\.local\share\baybayinscribe-smoke'
# One-time tooling setup, not an app dependency installation:
npm install --prefix "$env:BAYBAYINSCRIBE_SMOKE_TOOLS" --ignore-scripts --save-exact @electric-sql/pglite@0.5.16 smtp-server@3.21.4
$env:NODE_PATH = Join-Path $env:BAYBAYINSCRIBE_SMOKE_TOOLS 'node_modules'
node tests/local-auth-smoke.mjs
```

The smoke check executes the reviewed migrations against synthetic legacy auth
tables, checks missing-timezone rejection and a synthetic DST boundary, then
verifies both email confirmations, persisted/new-address sign-in, old-address
denial, completed-token replay denial, SMTP rejection, timed/permanent bans,
expiration, JWT signing/verification and impersonation start/stop. Mail stays in
memory; the server and database close in `finally`. The synthetic timezone is
**not** a decision about historical production data. Distinct synthetic clients
keep independent sign-in cases separate; dedicated tests cover rate limits.

This is an integration smoke check, not a full deployed Next.js/browser test or
proof of Gmail deliverability, production schema parity, database contention,
native mobile behavior or legacy signing-key compatibility. Production still
requires its database/migration history and historical ban policy to be reviewed.
