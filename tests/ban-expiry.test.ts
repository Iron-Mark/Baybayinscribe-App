import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAuthTables } from "@better-auth/core/db";
import { admin } from "better-auth/plugins";
import { user } from "../db/schema/auth-schema";

test("ban expiry declares a nullable Date-backed instant compatible with admin metadata", () => {
  const expected = getAuthTables({ plugins: [admin()] }).user.fields.banExpires;
  assert.equal(expected.type, "date");
  assert.equal(user.banExpires.dataType, expected.type);
  assert.equal(user.banExpires.getSQLType(), "timestamp with time zone");
  assert.equal(user.banExpires.notNull, false);
  assert.equal(user.banExpires.hasDefault, false);
});

test("ban expiry encodes and decodes sub-day instants without date-only truncation", () => {
  const expires = new Date("2026-11-15T04:05:06.123Z");
  assert.equal(user.banExpires.mapToDriverValue(expires), "2026-11-15T04:05:06.123Z");
  const restored = user.banExpires.mapFromDriverValue("2026-11-15 12:05:06.123+08");
  assert.ok(restored instanceof Date);
  assert.equal(restored.getTime(), expires.getTime());
});

test("review-only ban conversion requires explicit timezone and boundary approval", () => {
  const sql = readFileSync("db/migrations/review/20261115_ban_expiry_timestamp.sql", "utf8")
    .replace(/--[^\n]*/g, "");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /SET LOCAL lock_timeout/);
  assert.match(sql, /SET LOCAL statement_timeout/);
  assert.match(sql, /LOCK TABLE "public"\."user" IN ACCESS EXCLUSIVE MODE/);
  assert.match(sql, /current_setting\('baybayinscribe\.legacy_ban_timezone', true\)/);
  assert.match(sql, /FROM pg_timezone_names WHERE name = legacy_timezone/);
  assert.match(sql, /day_boundary IS DISTINCT FROM 'end-exclusive'/);
  assert.match(sql, /data_type = 'date' AND is_nullable = 'YES'/);
  assert.match(sql, /AND column_default IS NULL/);
  assert.match(sql, /NOT isfinite\("ban_expires"\)/);
  assert.match(sql, /"ban_expires" \+ 1/);
  assert.match(sql, /TYPE timestamp with time zone/);
  assert.match(sql, /AT TIME ZONE %L/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE|TRUNCATE|INSERT)\b/i);
  assert.doesNotMatch(sql, /(?:COALESCE|SET (?:LOCAL )?TIME ZONE)/i);
  assert.equal((sql.match(/ALTER COLUMN/g) ?? []).length, 1);
});
