// Optional local integration check. No .env loading, production DB, or real mail.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const toolRoot = process.env.BAYBAYINSCRIBE_SMOKE_TOOLS;
if (!toolRoot) throw new Error('Set BAYBAYINSCRIBE_SMOKE_TOOLS to the isolated smoke-tools directory (see docs/email-change.md).');
const toolRequire = createRequire(resolve(toolRoot, 'package.json'));
const { PGlite } = toolRequire('@electric-sql/pglite');
const { SMTPServer } = toolRequire('smtp-server');
const { transformSync } = require('esbuild');
const nodemailer = require('nodemailer');
const { drizzle } = require('drizzle-orm/pglite');
const { drizzleAdapter } = require('better-auth/adapters/drizzle');
const { betterAuth } = require('better-auth');
const plugins = require('better-auth/plugins');
const authAPI = require('better-auth/api');

function load(file, imports, env = {}) {
  const holder = { exports: {} };
  runInNewContext(transformSync(readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: holder, process: { env }, Date, Number,
    require: (name) => {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected smoke dependency: ${name}`);
    },
  });
  return holder.exports;
}

const database = new PGlite(); // ephemeral PostgreSQL/WASM; no socket or existing data
const messages = [];
let rejectMail = false;
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], logger: false,
  onData(stream, session, callback) {
    let content = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { content += chunk; });
    stream.on('end', () => {
      if (rejectMail) return callback(new Error('Synthetic SMTP rejection'));
      messages.push({ to: session.envelope.rcptTo.map((item) => item.address), content });
      callback();
    });
  },
});
await new Promise((done, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', done); });
const port = smtp.server.address().port;
const baseURL = 'http://127.0.0.1:19819'; // requests dispatch in process, not over HTTP
const checks = [];
try {
  await database.exec(readFileSync('db/generated/0000_nappy_toad_men.sql', 'utf8'));
  // Only auth statements from the historical migration, not unrelated quiz changes.
  const authDDL = readFileSync('db/generated/0008_brainy_maelstrom.sql', 'utf8')
    .split('--> statement-breakpoint').filter((sql) => !sql.includes('ALTER TABLE "quiz_answer_question"')).join('\n');
  await database.exec(authDDL);
  await database.exec(`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at,ban_expires)
    VALUES ('legacy','Synthetic','legacy@example.invalid',true,now(),now(),'2026-03-08'),
    ('permanent','Synthetic','permanent@example.invalid',true,now(),now(),NULL);`);
  const banSQL = readFileSync('db/migrations/review/20261115_ban_expiry_timestamp.sql', 'utf8');
  await assert.rejects(database.exec(banSQL), /explicitly approved legacy ban timezone/);
  await database.exec('ROLLBACK');
  // Test data policy only. This does NOT choose a historical production timezone.
  await database.exec(`SET baybayinscribe.legacy_ban_timezone = 'America/New_York';
    SET baybayinscribe.legacy_ban_day_boundary = 'end-exclusive';`);
  await database.exec(banSQL);
  const legacy = await database.query('SELECT id,ban_expires FROM "user" ORDER BY id');
  assert.equal(new Date(legacy.rows[0].ban_expires).toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(legacy.rows[1].ban_expires, null);
  await database.exec(readFileSync('db/migrations/review/20261115_auth_optional_columns.sql', 'utf8'));
  checks.push('reviewed migrations execute; missing timezone rejected; DST date conversion and NULL preserved');

  const { schema } = load('db/schema/auth-schema.ts', { 'drizzle-orm/pg-core': require('drizzle-orm/pg-core') });
  const db = drizzle(database, { schema });
  const mailer = load('app/lib/email.ts', {
    'server-only': {},
    nodemailer: { __esModule: true, default: { createTransport(config) {
      assert.equal(config.service, 'gmail');
      // Inject only transport destination; exercise the actual mail helper and SMTP.
      return nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true,
        connectionTimeout: 3000, socketTimeout: 3000, disableFileAccess: true, disableUrlAccess: true });
    } } },
  }, { NODE_ENV: 'test', GMAIL_USER: 'sender@example.invalid', GMAIL_APP_PASSWORD: 'synthetic-only' });
  const { auth: options } = load('app/lib/auth.ts', {
    'better-auth': { betterAuth: (value) => value },
    '../../db/drizzle': { __esModule: true, default: db },
    'better-auth/adapters/drizzle': { drizzleAdapter }, '../../db/schema/auth-schema': { schema },
    './email': mailer, 'better-auth/plugins': plugins, 'better-auth/api': authAPI,
  }, { NEXT_PUBLIC_SITE_URL: baseURL, NEXT_PUBLIC_BETTER_AUTH_URL: baseURL });
  const auth = betterAuth({ ...options, baseURL, socialProviders: {},
    secret: 'isolated-synthetic-smoke-secret-not-for-production',
    telemetry: { enabled: false }, logger: { disabled: true },
    rateLimit: { ...options.rateLimit, storage: 'memory' },
  });
  let requestNumber = 0;
  async function call(path, body, cookie) {
    return auth.handler(new Request(`${baseURL}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      // Separate synthetic clients avoid coupling independent scenarios to the
      // default sign-in quota; dedicated email-change tests cover quota behavior.
      headers: { 'content-type': 'application/json', origin: baseURL,
        'x-forwarded-for': `198.51.100.${++requestNumber}`, ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  }
  const cookieOf = (response) => {
    // Match a browser jar: a later Set-Cookie replaces an earlier deletion.
    const jar = new Map();
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      jar.set(pair.slice(0, pair.indexOf('=')), pair);
    }
    return [...jar.values()].filter((pair) => !pair.endsWith('=')).join('; ');
  };
  const password = 'Synthetic#Local4728';
  async function register(email) {
    const response = await call('/sign-up/email', { email, password, name: 'Synthetic Smoke User' });
    assert.equal(response.status, 200, 'registration');
    return { cookie: cookieOf(response), user: (await response.json()).user };
  }
  const current = await register('current@example.invalid');
  const operator = await register('operator@example.invalid');
  await database.query('UPDATE "user" SET email_verified=true WHERE id=$1', [current.user.id]);
  await database.query('UPDATE "user" SET role=$1 WHERE id=$2', ['admin', operator.user.id]);
  const emailInDB = async () => (await database.query('SELECT email FROM "user" WHERE id=$1', [current.user.id])).rows[0].email;
  function link(message) {
    // Nodemailer uses quoted-printable for long text lines. Never print tokens.
    const decoded = message.content.replace(/=\r?\n/g, '').replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const match = decoded.match(/http:\/\/127\.0\.0\.1:19819\/[^\s]+/);
    assert.ok(match, 'captured SMTP message contains local confirmation link');
    return match[0];
  }
  const requested = await call('/change-email', { newEmail: 'next@example.invalid', callbackURL: '/auth/login' }, current.cookie);
  assert.equal(requested.status, 200);
  assert.equal(await emailInDB(), 'current@example.invalid');
  assert.deepEqual(messages[0].to, ['current@example.invalid']);
  const first = await auth.handler(new Request(link(messages[0])));
  assert.equal(first.status, 302);
  assert.equal(await emailInDB(), 'current@example.invalid');
  assert.deepEqual(messages[1].to, ['next@example.invalid']);
  const finalURL = link(messages[1]);
  assert.equal((await auth.handler(new Request(finalURL))).status, 302);
  assert.equal(await emailInDB(), 'next@example.invalid');
  assert.equal((await call('/sign-in/email', { email: 'next@example.invalid', password })).status, 200);
  assert.equal((await call('/sign-in/email', { email: 'current@example.invalid', password })).status, 401);
  const replay = await auth.handler(new Request(finalURL));
  assert.match(replay.headers.get('location') ?? '', /error=INVALID_TOKEN/);
  assert.equal(await emailInDB(), 'next@example.invalid');
  checks.push('actual Drizzle auth adapter + loopback SMTP: both mailbox confirmations, persisted email, new sign-in, old sign-in denied, completed-token replay denied');

  rejectMail = true;
  // The library logs expected handler failures even with its logger disabled.
  // Capture only this deliberate failure; keep normal smoke output token-free.
  const originalError = console.error;
  let failed;
  try {
    console.error = () => {};
    failed = await call('/change-email', { newEmail: 'failure@example.invalid' }, current.cookie);
  } finally { console.error = originalError; }
  assert.equal(failed.status, 500);
  assert.equal(await emailInDB(), 'next@example.invalid');
  rejectMail = false;
  checks.push('SMTP rejection fails closed without changing stored email');

  const banned = await call('/admin/ban-user', { userId: current.user.id, banExpiresIn: 90 }, operator.cookie);
  assert.equal(banned.status, 200);
  const stored = await database.query('SELECT banned,ban_expires FROM "user" WHERE id=$1', [current.user.id]);
  const remaining = new Date(stored.rows[0].ban_expires).getTime() - Date.now();
  assert.ok(remaining > 60000 && remaining <= 90000, 'sub-day expiry survives SQL roundtrip');
  assert.equal((await call('/sign-in/email', { email: 'next@example.invalid', password })).status, 403);
  await database.query('UPDATE "user" SET ban_expires=now()-interval \'1 second\' WHERE id=$1', [current.user.id]);
  assert.equal((await call('/sign-in/email', { email: 'next@example.invalid', password })).status, 200);
  assert.equal((await database.query('SELECT banned FROM "user" WHERE id=$1', [current.user.id])).rows[0].banned, false);
  assert.equal((await call('/admin/ban-user', { userId: current.user.id }, operator.cookie)).status, 200);
  assert.equal((await database.query('SELECT ban_expires FROM "user" WHERE id=$1', [current.user.id])).rows[0].ban_expires, null);
  assert.equal((await call('/sign-in/email', { email: 'next@example.invalid', password })).status, 403);
  assert.equal((await call('/admin/unban-user', { userId: current.user.id }, operator.cookie)).status, 200);
  assert.equal((await call('/sign-in/email', { email: 'next@example.invalid', password })).status, 200);
  checks.push('actual admin plugin: finite ban, denied sign-in, expiry/unban, permanent ban and manual unban');
  const token = await call('/token', undefined, operator.cookie);
  assert.equal(token.status, 200);
  const { jwtVerify, createLocalJWKSet } = require('jose');
  const keys = await call('/jwks');
  assert.equal(keys.status, 200);
  const verified = await jwtVerify((await token.json()).token, createLocalJWKSet(await keys.json()), {
    issuer: baseURL, audience: baseURL,
  });
  assert.equal(verified.payload.sub, operator.user.id);
  const impersonation = await call('/admin/impersonate-user', { userId: current.user.id }, operator.cookie);
  assert.equal(impersonation.status, 200);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM session WHERE impersonated_by=$1', [operator.user.id])).rows[0].count, 1);
  assert.equal((await call('/admin/stop-impersonating', {}, cookieOf(impersonation))).status, 200);
  checks.push('migrated optional columns: JWT signing/verification and admin impersonation start/stop');
  console.log(JSON.stringify({ result: 'PASS', database: 'ephemeral PostgreSQL/WASM', mail: 'loopback capture only', checks }, null, 2));
} finally {
  await new Promise((done) => smtp.close(done));
  await database.close();
}
