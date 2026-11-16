# Auth optional-column migration review

Status: **prepared only, not applied**. Do not deploy the updated Drizzle schema
against the old database before completing an approved migration.

Local maintenance smoke coverage: `tests/local-auth-smoke.mjs` executes these
scripts on disposable synthetic PostgreSQL/WASM auth tables and tests the real
Drizzle/auth integration with loopback SMTP. See [setup and limits](../../../docs/email-change.md#optional-local-database--mail-smoke-check).
This does not apply either script to an existing database or select a production
timezone; the status above refers to existing/deployment databases.

`20261115_auth_optional_columns.sql` adds four nullable columns required by the
installed Better Auth 1.7.19 `admin()` and `jwt()` plugin metadata:

| Drizzle field | PostgreSQL column | Type | Existing rows |
| --- | --- | --- | --- |
| session.impersonatedBy | public.session.impersonated_by | text | NULL |
| jwks.expiresAt | public.jwks.expires_at | timestamp without time zone | NULL |
| jwks.alg | public.jwks.alg | text | NULL |
| jwks.crv | public.jwks.crv | text | NULL |

No backfill, key rotation, constraint tightening, or data deletion is included.
The installed JWT adapter explicitly supports legacy keys whose algorithm is
NULL, using the configured default algorithm; existing keys must not be guessed
or rewritten as part of this change. NULL expiration retains existing behavior.

## Why this is outside the active migration directories

The default config writes to `db/generated`, but its journal stops at 0010 while
0011 and 0012 SQL files also exist. The development migration history is separate;
the production config points at another schema path. Do not append a guessed
sequence number, regenerate the full database, or invoke `drizzle-kit push`.
An operator must reconcile which history the intended database actually uses.
Never print configured database URLs; the existing development config logs one.

## Required operator review and staging verification

1. Confirm the intended database/account/environment and take a recoverable
   backup. Inspect schema metadata, not user data or private key values:

   ```sql
   SELECT table_schema, table_name, column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('session', 'jwks')
   ORDER BY table_name, ordinal_position;
   ```

2. Confirm both tables exist with the expected existing columns and none of the
   four additions exist. If any already exists, compare its type/nullability and
   stop to reconcile drift. The SQL deliberately does not use `IF NOT EXISTS`,
   which could conceal a wrong existing type. Check relation size and traffic;
   even nullable additions briefly require exclusive table locks.
3. Review the SQL and execute it only on an approved isolated staging database
   first, with stop-on-error enabled. It uses one transaction and bounded lock and
   statement timeouts. On failure, roll back the transaction before retrying.
4. Inspect the four columns again and run application-level staging checks for
   session creation/read/revocation, admin impersonation start/stop, JWT signing
   and verification (including an existing legacy key). The local tests validate
   declared metadata only; they do not establish these live behaviors.
5. Reconcile and register the reviewed migration in the actual deployment
   history before separately authorizing a production rollout. Apply the schema
   change before deploying code that selects the new columns. Recheck logs for
   schema errors. No production apply command is supplied or executed here.

## Rollback of optional-column additions

Leave these nullable additions in place when rolling back application code;
that preserves new impersonation/key metadata. Dropping them after new writes
would destroy data and requires separate approval. An interrupted uncommitted
transaction can be rolled back without changing the database.

## Separate ban-expiry conversion — prepared, not applied

`20261115_ban_expiry_timestamp.sql` is a second, separately reviewed migration.
The local declaration now uses a nullable `timestamp with time zone` mapped to a
JavaScript Date, matching the installed admin plugin's date contract. Existing
databases may still have the old SQL `date` column: do not roll this code out
until the intended database is inspected and the conversion is separately
approved and staged. Local metadata/adapter tests are not live migration proof.

The old column lost time-of-day. The original expiry instant cannot be recovered
from a date, and neither this machine's timezone nor the PostgreSQL session
timezone establishes the historical deployment policy. Before staging, an
operator must approve both of these **session settings** on the intended
connection (no values are supplied or defaulted by this preparation):

- `baybayinscribe.legacy_ban_timezone`: an IANA timezone name validated against
  `pg_timezone_names`, chosen from deployment/operational evidence.
- `baybayinscribe.legacy_ban_day_boundary`: `end-exclusive`, explicitly approving
  the candidate policy described below. If another policy is required, stop and
  revise/review the SQL rather than substituting an unreviewed boundary.

The candidate policy keeps a ban in force **through its stored date**, converting
it to the next local midnight in the approved legacy timezone. This avoids
unbanning an account at the beginning of the stored day, but can extend a ban by
roughly a day relative to an unknown original intent (DST can change day length).
Already-expired dates remain expired in ordinary cases; dates equal to the
current legacy day need specific operator review. NULL stays NULL. Future bans
retain their full timestamp instant instead of being truncated to dates.

Before application, inspect only necessary schema metadata and aggregate expiry
counts/ranges; review active bans whose boundaries matter without exposing user
data in logs. Confirm the column is nullable SQL `date` without a default, rule out non-finite dates,
take a restorable backup, and validate representative old/new day boundaries and
DST cases in isolated staging. The script fails closed on missing/invalid timezone,
unapproved boundary, source-type/default drift, or non-finite dates. A default
must be reviewed separately so its implicit cast cannot bypass the approved
timezone policy. The script takes an exclusive
table lock with bounded timeouts; the ALTER can rewrite the table, so evaluate
table size, traffic, and maintenance-window requirements before approving it.

After staging conversion, inspect column type/nullability and verify finite ban
creation with sub-day duration, banned sign-in denial, expiration/unbanning,
permanent bans (NULL expiry), and admin changes using the actual installed auth
library. Reconcile/register this migration with the correct deployment history
before production authorization. SQL has only been exercised on disposable
synthetic local smoke databases, not an existing or deployment database.

Do not roll back this timestamp column to `date` automatically: that would destroy
new time-of-day information. An uncommitted failure can be rolled back; a committed
conversion requires a reviewed recovery/roll-forward plan and preserved backup.
The earlier four-column addition remains separately scoped and unchanged.
Verification timestamp columns also remain nullable in the existing declaration;
old data, constraints and backfill policy are not audited against a live database.
