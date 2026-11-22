# Dependency security maintenance

## Reproducible package graph

Use Node.js 24, npm, and the committed `package-lock.json` for the security repair.
The root `.npmrc` currently requires `legacy-peer-deps=true`; frozen validation
must preserve that setting. `bun.lockb` is historical and retained untouched, not
a second authoritative lockfile for this repair. Do not mix frozen Bun and npm
installs or update provider secrets to make a dependency audit pass.

Install with `npm ci --ignore-scripts` first. This avoids executing dependency
lifecycle scripts. The compatibility tests explicitly verify the native Sharp
binary selected by Next.js and exercise the existing TypeScript runner so a
successful install is not mistaken for runtime compatibility.

## Scope of the repair

- Next.js and eslint-config-next stay aligned on the patched Next.js 15 line.
- Nodemailer, Drizzle ORM, Zod, and the shadcn tool dependency require supported
  API upgrades rather than retaining their vulnerable older majors.
- Zod validation handlers use `error.issues`, and React Hook Form uses a
  Zod-4-compatible resolver, preserving user-visible validation messages.
- Package-specific overrides address vulnerable transitive dependencies. Keep
  their scope narrow and re-evaluate them when parent packages release fixes.
- `deepmerge` 4.1.2 is selected deliberately because the current advisory covers
  4.2.0 through 4.3.1; a blanket upgrade to the highest published 4.x is not a fix.

`npm audit` package counts are not directly comparable to GitHub's individual
advisory counts. Recheck both after publication; local-only changes do not clear
alerts on the default branch. Do not suppress advisories solely to obtain a
zero count, and do not use `npm audit fix --force` to introduce unreviewed majors.

## Local checks and limitations

```bash
npm run test:security
npm run lint
npm run typecheck
npm run build
npm audit
```

The focused security compatibility tests cover password/registration schemas,
React Hook Form's valid/invalid Zod 4 resolution, a source-wide removed-API guard,
local Nodemailer JSON transport, a parameterized Drizzle query without a server,
and Next.js's patched Sharp image processor. They are not a full app test suite.
The legacy Drizzle loader is also checked against its scoped esbuild override
using synchronous and asynchronous transforms of synthetic TypeScript only.
Legacy rimraf callers are checked to retain glob's callback API while modern
rimraf uses a patched promise-based glob dependency without a global override.

Strict TypeScript and ESLint checks are independent gates. Production builds no
longer skip either check. `npm run lint` additionally rejects every warning, and
`npm run typecheck` regenerates Next.js route validators before running TypeScript,
so a clean checkout does not silently omit route contracts. Source is not excluded
or errors suppressed to make these gates pass.

The strict-check repair updates dynamic route contexts to promise-valued params,
normalizes lesson/module API data at store boundaries, and uses supported auth,
calendar, and inference APIs. User-information reads require a session and either
the matching user ID or the admin role; database failures are not mock successes.
Local regression tests use mocked handlers and transport adapters for those
access rules, reset requests, and lesson stores; no real accounts are exercised.

## PostgreSQL transport

Drizzle and the custom profile/auth routes share one PostgreSQL pool. Certificate
and server-hostname verification is enabled by default in every environment.
For a provider using a private CA, set `DATABASE_CA_CERT` to its trusted PEM CA
certificate (literal newlines or escaped `\n` are accepted). The system CA trust
store is used when this optional variable is absent. Do not disable verification
to make an unavailable or self-signed database connect.

`DATABASE_URL` may retain `sslmode=require`, `sslmode=verify-full`, `ssl=true`, or
`ssl=1`; these redundant flags are removed before node-postgres parses the URL,
so they cannot replace the verified SSL options or configured CA. Weaker modes,
certificate-file URL parameters, and libpq compatibility overrides are rejected.
Use `DATABASE_SSL_MODE=disable` only for a non-production, non-Vercel development
database whose URL host is exactly localhost/127.0.0.1/::1, without a host override.
TLS remains verified by default even on localhost.

When `DATABASE_URL` is absent the pool remains inert during imports/builds, which
keeps the sample-backed guest showcase usable. Promise and callback connections,
queries, and Drizzle transactions fail before networking instead of falling back
to `PGHOST`, `PGUSER`, or an implicit local database. Configuration is captured at
startup; restart after changing database settings. This repair does not connect
to a real database, establish a provider's CA, restore accounts, or apply schema
migrations. The existing staging/provider release gates still apply.

## Route authorization policy

Middleware is not an API security boundary. All custom data routes now use
`lib/auth/api-access.ts`; Better Auth's catch-all retains its own auth handler.
The shared guard verifies the session server-side, denies banned users, and uses
the verified role and ID rather than caller-supplied identity. Session lookup
failures deny access with 503; missing sessions return 401; forbidden operations
return 403.

| Route family | Allowed access |
| --- | --- |
| Lesson/module create, update, delete | Administrator only; module must belong to the URL lesson |
| Lesson/module reads | Guests and signed-in learners see visible lessons; administrators may see hidden lessons |
| User progress/history/creator lists | Matching user or administrator |
| Completion and answer submission | Authenticated actor only; supplied IDs cannot impersonate another user |
| Quiz generation, save and delete | Administrator only; author bound to session; question edits scoped to quiz |
| Quiz get/list | Guests may read public quizzes; private quizzes require signed-in creator/admin access, lists filter public metadata |
| Own profile and terms | Authenticated actor only; profile-by-ID reads allow owner/admin; email changes use separate confirmation flow |
| Email existence lookup | Administrator only (no current frontend consumer) |

Mutation requests with an Origin must match the request origin or the configured
site/auth origin. Opaque `null` origins and untrusted origins are rejected. Native
requests without Origin still require a valid session; browser `cross-site`
requests without Origin are denied. Capacitor/cross-origin clients need an
explicitly reviewed trusted-origin and cookie configuration before rollout; no
wildcard trust, permissive CORS, or auth bypass is added for them.

[Guest showcase mode](guest-mode.md) opts selected content GETs into anonymous
reads without creating an identity or allowing account writes. Guest results
remain in memory. Paid AI server actions explicitly require a verified actor
(and administrator role for generation), independently of page middleware.

Quiz answer correctness is recomputed from persisted question data; identity,
attempt and timestamp are server-controlled. This prevents caller-supplied score
flags, not cheating using the public answer keys the existing gameplay requires.
Concurrent attempt allocation is not serialized. Profile image deletion sends
only the actor's own Blob path to the deletion provider; external/default images
are unlinked without remote deletion. Upload filenames are server-generated.

The test suite executes real transpiled handlers and the real guard with isolated
session/database/provider stubs, including denial-before-side-effect checks.
It also compares the installed auth plugin fields with declared Drizzle columns.

## Prepared auth migration and remaining release gates

The declared schema now includes nullable `session.impersonatedBy` and
`jwks.expiresAt`, `jwks.alg`, `jwks.crv`, and a Date-backed `timestamptz` for
`user.banExpires`. The four-column addition and separate ban-expiry conversion
SQL are **prepared only**:
[review migration and staging runbook](../db/migrations/review/README.md).
It is intentionally outside active journals because existing migration histories
need reconciliation. No existing database inspection, generation, or application
was performed. Applying the reviewed migration to the intended database before code
rollout still requires separate authorization and staging verification.

Do not treat local tests/builds as complete security or runtime certification:

- The local ban-expiry declaration now matches the auth plugin's Date contract;
  existing databases still need an explicitly approved legacy timezone/day
  policy, staged conversion and runtime ban/unban checks before deployment.
- [Verified-email changes](email-change.md) no longer write email through profile
  updates. Local tests do not establish real mailbox delivery; mail credentials
  and controlled staging mailboxes are required for that release gate.
- Existing public lesson Blob URLs remain public if known, even for hidden
  lessons. API visibility checks do not change storage access policy.
- Public quiz keys remain available to authenticated gameplay; concurrent answer
  submissions can allocate the same attempt number.
- The local PostgreSQL service was unavailable in the previous strict-build
  check; authenticated database-backed behavior and migration compatibility are
  not verified against a running staging database.

An optional [local auth smoke check](email-change.md#optional-local-database--mail-smoke-check)
now exercises the actual auth adapter, reviewed SQL migrations and loopback SMTP
on a disposable PostgreSQL/WASM database. It needs no provider accounts and does
not change production transport/configuration. It supplements, rather than
replaces, the deployment-specific checks above.

The app uses database, authentication, mail, blob-storage, and AI integrations.
No database migration, email delivery, native mobile distribution, or real
provider transaction is part of dependency validation. Environment values stay
private; report missing/present names only. Do not run `npm run m`, cleanup
scripts, or a deployment to obtain a local security checkpoint.
