# Guest showcase mode

This reuses the existing app, without guest accounts, new database tables,
anonymous server writes, or an authentication bypass flag.

Public showcase: https://baybayinscribe.vercel.app

The shorter address is a verified production domain on the same Vercel project,
not a second project. Production site/auth URL settings use this canonical host
to avoid cross-origin session requests. The original
https://baybayinscribe-client-showcase.vercel.app address redirects to it.
Preview deployment protection remains enabled; this domain change does not
restore the original account services.

The isolated Vercel project uses Next.js, Node 24, `npm ci --ignore-scripts` and
`npm run build`. Its three public API/site/auth URL settings are scoped to this
showcase; its newly generated auth secret is a sensitive production variable,
not a key copied from another app. Local `.env` files are excluded from uploads.
The original database, mail and paid AI services remain unconfigured: this is a
sample-backed guest showcase, not a restoration of production account services.

## Available without signing in

- Home, public lesson/quiz lists and details, and public lesson modules.
- Lesson reading/completion for this visit. Guest modules are not locked by
  account progress. Completion exists only in the current lesson-layout memory;
  reloading/leaving that layout clears it. Nothing is uploaded or later synced.
- Public quiz practice and the existing in-visit result screen. Guest answers
  never call the answer-submission/history APIs or acquire a fake user ID.
- Text-only quizzes do not initialize the recognition model. Quizzes containing
  `SKT`/`sketch` questions still load it. This avoids model warmup stalling simple
  sample questions.
- Filipino/Baybayin transliteration, sketching and camera scanning, using the
  existing bundled local recognition model. Camera permission is still required.

Recognition initialization is shared while in flight and a ready model is reused
across client-side tool navigation. A full reload still needs the original model
download/warmup; there is no new model or offline-cache architecture. Sketch and
scanner show a nonblocking loading notice so navigation and drawing remain
available. Analysis/camera inference wait for readiness. Initialization errors
show a retry action instead of a permanent full-screen spinner.

The login page offers **Continue as guest**; guest pages show a notice with
practice links and a sign-in link. The sidebar does not fetch or open a guest
profile. Signed-in users retain their existing account-backed saves and normal
registration checks. Browser tool preferences, scanner history and accuracy-notice
acknowledgement retain their existing local-storage behavior; guest lesson/quiz
scores are not persisted or synced to an account.

## Necessary boundaries

Profiles, personal history, administrative editing/generation and all server
mutations still require the existing server-verified identity and role. Hidden
lessons/private quizzes are not made public. Public quiz answer keys remain part
of the existing client-side gameplay design, not a new anti-cheating guarantee.

Live Gemini chat needs sign-in and a configured provider; its server action also
rejects anonymous/banned callers. Quiz generation requires administrator access
even when invoked directly as a server action. This does not provide a global
AI usage quota. No paid provider call is made by the guest checks.

Original published lessons/quizzes still need the existing database and file
storage. When unavailable or empty, the lists show a clearly labelled bundled
sample lesson and quiz. They reuse the existing public example metadata/questions,
with a small static vowel/practice module, separate `sample-` IDs and valid MCQ
answer indexes. This is not recovered original curriculum or a replacement DB.
Sample pages do not query account progress/history or submit scores, even for a
signed-in user. Unknown sample IDs do not fall through to real/private content.
The local tools remain available and the home page explains sample provenance.
With the real local database unavailable, `node tests/showcase-browser.mjs`
checks the actual fallback catalog, static lesson/module, two-question sample
quiz and absence of account writes at desktop/mobile sizes without content or
session API fixtures. It expects the unavailable/empty-backend scenario.
English translation retains the existing third-party Lingva dependency; it is
not an offline or guaranteed-available translation service.

## Access design

- `lib/auth/guest-routes.ts` explicitly lists public showcase pages. API checks
  remain independent of middleware. Signed-in page access still follows normal
  registration/admin handling.
- Only selected content GET handlers opt into `allowGuest: true`. Anonymous
  access returns a null session, not a fabricated user. POST/PUT/PATCH/DELETE,
  owner/admin options, banned sessions and auth lookup errors fail closed.
- Lesson GET ignores caller-supplied progress identity; a guest has no progress
  lookup. Existing authenticated POST detail reads remain owner/admin checked.
- All public reads retain visibility and module-parent checks. No wildcard CORS
  or client-trusted role/identity was added.
- The bundled model uses absolute `/models/model.json` and public model assets.
  The web API default is same-origin `/api`; an explicit `NEXT_PUBLIC_API_URL`
  remains supported and must point to the intended backend.

## Local verification

With Node 24, run `npm run test:security`, `npm run lint`, `npm run typecheck`,
then `npm run build` sequentially (typecheck/build share generated Next types).

`tests/guest-browser.mjs` targets an already-running **loopback-only** production
Next server at `http://127.0.0.1:19809`. For this local build, site/auth/API public
URLs must target that same origin. It intercepts content/session APIs with
synthetic fixtures, checks desktop/mobile guest and signed-in interactions, and
uses bundled model assets plus a fake camera. It never validates production data,
real user sign-in, physical-camera accuracy, provider delivery or deployment.
Use an existing local Playwright/browser via `PLAYWRIGHT_MODULE_PATH` and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Playwright is not installed in the repo.

`node tests/sketch-touch-browser.mjs` checks the real local sketch page in Android
Chrome emulation: touch strokes leave ink without scrolling or passive-listener
warnings. Only the drawing canvas disables browser touch gestures. This is not a
physical-device, real-authentication or recognition-accuracy check (the session
response is a synthetic guest); the same loopback URL and browser
environment variables apply.

`node tests/model-usability-browser.mjs` deliberately fails the first local model
request, checks drawing remains available, retries with the real bundled model,
then navigates to the scanner without another model download. It also checks
the three repaired text contrasts and simulated-camera shutdown in portrait and
landscape with reduced motion. Session data is synthetic; it does not validate
real sign-in or physical-camera accuracy. `UI_ARTIFACT_DIR` optionally selects an
existing screenshot directory.

```powershell
node tests/guest-browser.mjs
```

Start the local server using the normal command after a build configured for
this local origin:

```powershell
npm run start -- --hostname 127.0.0.1 --port 19809
```

The explicit loopback bind does not expose the server to the LAN. The optional
`GUEST_SMOKE_URL` environment variable selects another loopback port; build-time
site/auth URLs must match it. No environment file needs to be edited for this check.

`node tests/guest-components-browser.mjs` needs no server: it reuses the isolated
browser-fixture pattern with real GuestNotice, LessonProvider and QuizTakeContent
and mocked Next/auth/data boundaries. Four desktop/mobile guest/signed-in cases
passed: no guest quiz submissions, one signed-in submission bound to the actor,
guest-only notice/completion state, lesson-ID changes and zero page errors. This
does not validate CSS, live page routing, the bundled model or a physical camera.

Verified locally on 2026-11-15: 93 regression/security tests, four isolated
component-browser cases, lint, typecheck and the strict production build passed.
The final live-page suite also passed on port 19809: four desktop/mobile
guest/signed-in fixture cases, zero page errors, no guest account writes/private
reads, real local-model warmup, fake-camera frames, eight real anonymous API
denials (401) and two protected-page redirects (307). Session/content responses
in the page flows are synthetic; this is not production database, actual account
sign-in or physical-camera accuracy verification. The first camera test was
corrected to enable the existing real-time switch: image upload is the default.

Existing database/auth schema migration and provider release gates still apply;
guest mode does not authorize migration, publication or production deployment.
