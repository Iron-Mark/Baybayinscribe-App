-- REVIEW ONLY: not registered with a migration journal and not applied.
-- Requires an approved staging target/backup and explicit operator settings:
--   baybayinscribe.legacy_ban_timezone: approved IANA name from pg_timezone_names
--   baybayinscribe.legacy_ban_day_boundary: end-exclusive
-- No timezone default: the legacy deployment's timezone is not known here.
-- Candidate policy preserves the ban through its stored date, expiring at the
-- following local midnight. Original time-of-day is irretrievably absent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE "public"."user" IN ACCESS EXCLUSIVE MODE;

DO $migration$
DECLARE
  legacy_timezone text := current_setting('baybayinscribe.legacy_ban_timezone', true);
  day_boundary text := current_setting('baybayinscribe.legacy_ban_day_boundary', true);
BEGIN
  IF legacy_timezone IS NULL OR legacy_timezone = '' OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = legacy_timezone
  ) THEN
    RAISE EXCEPTION 'An explicitly approved legacy ban timezone is required';
  END IF;
  IF day_boundary IS DISTINCT FROM 'end-exclusive' THEN
    RAISE EXCEPTION 'Approve the end-exclusive legacy date policy before converting bans';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user'
      AND column_name = 'ban_expires' AND data_type = 'date' AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected nullable public.user.ban_expires date without a default; reconcile schema drift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "public"."user"
    WHERE "ban_expires" IS NOT NULL AND NOT isfinite("ban_expires")
  ) THEN
    RAISE EXCEPTION 'Non-finite ban dates require manual review before conversion';
  END IF;

  EXECUTE format(
    'ALTER TABLE "public"."user" ALTER COLUMN "ban_expires" TYPE timestamp with time zone USING (("ban_expires" + 1)::timestamp without time zone AT TIME ZONE %L)',
    legacy_timezone
  );
END;
$migration$;

COMMIT;
