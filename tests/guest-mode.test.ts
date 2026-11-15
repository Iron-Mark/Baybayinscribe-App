import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { isGuestPage } from '../lib/auth/guest-routes';

test('guest page allowlist includes showcase flows but excludes accounts, admin and paid chat', () => {
  for (const path of ['/', '/transliterator', '/ai/sketch', '/ai/vision', '/lesson/all', '/lesson/example', '/lesson/example/module/view', '/quiz', '/quiz/all', '/quiz/example/view', '/quiz/take/example']) {
    assert.equal(isGuestPage(path), true, path);
  }
  for (const path of ['/admin', '/admin/users', '/auth/register/terms', '/ai/chat', '/api/quiz/save', '/lesson/example/edit', '/quiz/example/edit', '/transliterator-secret']) {
    assert.equal(isGuestPage(path), false, path);
  }
});

test('real middleware permits anonymous showcase/model assets but retains private and registration redirects', async () => {
  async function run(path: string, cookie = false, status = 'complete') {
    const holder = { exports: {} as { middleware: (request: unknown) => Promise<Response> } };
    let checks = 0;
    runInNewContext(transformSync(readFileSync('middleware.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
      module: holder, URL, console: { log() {}, error() {} },
      fetch: async () => { checks++; return Response.json({ status, step: 'userinfo' }); },
      require: (name: string) => {
        if (name === 'better-auth/cookies') return { getSessionCookie: () => cookie ? 'synthetic' : null };
        if (name === 'next/server') return { NextResponse: { next: () => new Response(null, { status: 204 }), redirect: Response.redirect } };
        if (name === '@/lib/auth/guest-routes') return { isGuestPage };
        throw new Error(`Unexpected middleware import ${name}`);
      },
    });
    const url = new URL(path, 'https://app.invalid');
    return { response: await holder.exports.middleware({ url: url.href, nextUrl: url, headers: new Headers() }), checks };
  }
  for (const path of ['/', '/transliterator', '/ai/sketch', '/ai/vision', '/lesson/all', '/quiz/take/example', '/models/model.json', '/models/group1-shard1of3.bin']) {
    const result = await run(path);
    assert.equal(result.response.status, 204, path);
    assert.equal(result.checks, 0);
  }
  for (const path of ['/admin/users', '/ai/chat']) {
    assert.match((await run(path)).response.headers.get('location') ?? '', /\/auth\/login$/);
  }
  assert.match((await run('/lesson/all', true, 'incomplete')).response.headers.get('location') ?? '', /\/auth\/register\/userinfo\?/);
  const signedIn = await run('/lesson/all', true);
  assert.equal(signedIn.response.status, 204);
  assert.equal(signedIn.checks, 1);
});

type Actor = { user: { id: string; role: string; banned?: boolean } } | null;
function loadAI(actor: Actor) {
  let providerCalls = 0;
  const holder = { exports: {} as {
    generateQuiz: (count: number, topic: string, difficulty: string) => Promise<unknown>;
    promptGemini: (prompt: string) => Promise<string>;
  } };
  runInNewContext(transformSync(readFileSync('lib/genai.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: holder, process: { env: { GOOGLE_GENAI_API_KEY: 'synthetic-only' } }, console: { log() {}, error() {} },
    require: (name: string) => {
      if (name === 'next/headers') return { headers: async () => new Headers() };
      if (name === '@/app/lib/auth') return { auth: { api: { getSession: async () => actor } } };
      if (name === '@google/generative-ai') return { GoogleGenerativeAI: class {
        getGenerativeModel() { providerCalls++; return { generateContent: async () => ({ response: { text: () => '{"quiz":{}}' } }) }; }
      } };
      throw new Error(`Unexpected AI dependency ${name}`);
    },
  });
  return { api: holder.exports, providerCalls: () => providerCalls };
}

test('direct AI server actions deny guest/banned calls before touching a paid provider', async () => {
  for (const actor of [null, { user: { id: 'banned', role: 'admin', banned: true } }]) {
    const loaded = loadAI(actor);
    await assert.rejects(loaded.api.promptGemini('synthetic'), /Sign in/);
    await assert.rejects(loaded.api.generateQuiz(1, 'synthetic', 'Easy'), /Administrator/);
    assert.equal(loaded.providerCalls(), 0);
  }
  const learner = loadAI({ user: { id: 'learner', role: 'user' } });
  await assert.rejects(learner.api.generateQuiz(1, 'synthetic', 'Easy'), /Administrator/);
  assert.equal(learner.providerCalls(), 0);
  await learner.api.promptGemini('synthetic');
  assert.equal(learner.providerCalls(), 1);
  const administrator = loadAI({ user: { id: 'admin', role: 'admin' } });
  await administrator.api.generateQuiz(1, 'synthetic', 'Easy');
  assert.equal(administrator.providerCalls(), 1);
});
