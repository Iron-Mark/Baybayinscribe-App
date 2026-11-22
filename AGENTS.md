# AGENTS.md

## Scope
- BaybayInscribe web & mobile client (`UMak-Gilas-Tech/baybayinscribe-client`, checked-out branch `heads/showcase`).
- Follow root `C:\Codes Local\AGENTS.md` first, then this file.

## Environment / Stack
- Next.js 15 + React 19 + Drizzle ORM + BetterAuth + Capacitor 7 + TensorFlow.js / ONNX Runtime, npm (`package-lock.json`).

## Key Commands
- `npm run dev` — start local Next.js dev server
- `npm run build` — build Next.js production bundle
- `npm start` — start production server
- `npm run lint` — run linter
- `npm test` — run test suite

## Secrets / Env
- Refer to `.env.example` for required environment variable names. Never print or commit `.env*` secrets or database credentials.
