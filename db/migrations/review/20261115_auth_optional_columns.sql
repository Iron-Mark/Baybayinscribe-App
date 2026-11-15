-- REVIEW ONLY: not registered with any Drizzle migration journal; not applied.
-- Confirm the target database, public schema, backup, and column metadata first.
-- Fail closed if any column already exists: reconcile drift rather than skipping it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "public"."session"
  ADD COLUMN "impersonated_by" text;

ALTER TABLE "public"."jwks"
  ADD COLUMN "expires_at" timestamp,
  ADD COLUMN "alg" text,
  ADD COLUMN "crv" text;

COMMIT;
