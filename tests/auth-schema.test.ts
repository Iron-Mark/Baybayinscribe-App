import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAuthTables } from "@better-auth/core/db";
import { admin, jwt } from "better-auth/plugins";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { schema, session, jwks } from "../db/schema/auth-schema";

// Mirror the two configured plugins without importing app/lib/auth or opening DBs.
const expectedTables = getAuthTables({ plugins: [jwt(), admin()] });
const declaredTables: Record<string, PgTable> = schema;

test("declared auth schema contains every installed core/admin/JWT field", () => {
  const authSource = readFileSync("app/lib/auth.ts", "utf8");
  assert.match(authSource, /plugins:\s*\[\s*jwt\(\),\s*admin\(\),?\s*\]/);
  for (const [tableName, table] of Object.entries(expectedTables)) {
    const declared = declaredTables[tableName];
    assert.ok(declared, `Missing auth table ${tableName}`);
    const columns = getTableColumns(declared);
    for (const fieldName of Object.keys(table.fields)) {
      assert.ok(columns[fieldName], `Missing auth field ${tableName}.${fieldName}`);
    }
  }
});

test("new optional auth fields retain nullable plugin-compatible SQL types", () => {
  for (const [column, sqlName, sqlType] of [
    [session.impersonatedBy, "impersonated_by", "text"],
    [jwks.expiresAt, "expires_at", "timestamp"],
    [jwks.alg, "alg", "text"],
    [jwks.crv, "crv", "text"],
  ] as const) {
    assert.equal(column.name, sqlName);
    assert.equal(column.getSQLType(), sqlType);
    assert.equal(column.notNull, false);
    assert.equal(column.hasDefault, false);
  }
});

test("declared auth field types match installed core/admin/JWT metadata", () => {
  const mismatches: string[] = [];
  for (const [tableName, table] of Object.entries(expectedTables)) {
    const columns = getTableColumns(declaredTables[tableName]);
    for (const [fieldName, field] of Object.entries(table.fields)) {
      const column = columns[fieldName];
      assert.ok(column, `${tableName}.${fieldName} must exist before type comparison`);
      if (column.dataType !== field.type) {
        mismatches.push(`${tableName}.${fieldName}: ${column.dataType} != ${field.type}`);
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test("review migration is transactional and adds only the four nullable columns", () => {
  const sql = readFileSync("db/migrations/review/20261115_auth_optional_columns.sql", "utf8")
    .replace(/--[^\n]*/g, "");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.equal((sql.match(/ADD COLUMN/g) ?? []).length, 4);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE|TRUNCATE|INSERT|NOT NULL|DEFAULT)\b/i);
  for (const name of ["impersonated_by", "expires_at", "alg", "crv"]) {
    assert.ok(sql.includes(`ADD COLUMN "${name}"`));
  }
});
