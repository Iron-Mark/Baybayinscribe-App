// Live local Next.js pages with synthetic content/session API responses.
// No existing DB, real user writes, mail or paid provider calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.GUEST_SMOKE_URL || 'http://127.0.0.1:19809';
assert.equal(new URL(baseURL).hostname, '127.0.0.1', 'local server only');
const date = '2026-01-01T00:00:00.000Z';
const lesson = { id: 'demo-lesson', title: 'Synthetic guest lesson', description: 'Local smoke content', created_by: 'author', is_visible: true, createdAt: date, updatedAt: date };
const lessonModule = { id: 'module-row', module_id: 'module-file', module_name: 'Synthetic guest module', module_description: 'Local smoke module', learning_resource_id: lesson.id, createdAt: date, updatedAt: date };
const file = { id: 'module-file', name: 'smoke.md', url: `${baseURL}/smoke-content.md`, uploaded_by: 'author', learning_resource_id: lesson.id, createdAt: date, updatedAt: date };
const metadata = { quiz_id: 'demo-quiz', quiz_name: 'Synthetic guest quiz', description: 'Local smoke quiz', is_public: true, difficulty: 'Easy', category: 'Baybayin', time_limit: 60, created_at: date, updated_at: date };
const quiz = { quiz: { id: metadata.quiz_id, created_by: 'author' }, metadata, questions: [{
  id: 'question-one', quiz_id: metadata.quiz_id, question_number: 1, type: 'MCQ', language: 'Tagalog', question: 'Choose the first vowel',
  display_text: null, options: ['A', 'I'], correct_answer: '0', character: null, description: 'Synthetic MCQ', pairs: null,
}] };
const browser = await chromium.launch({ headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const signedIn of [false, true]) {
      console.log(`Checking ${viewport.width}x${viewport.height}, ${signedIn ? 'signed-in fixture' : 'guest'}`);
      const context = await browser.newContext({ viewport, permissions: ['camera'] });
      const errors = [];
      const writes = [];
      const privateReads = [];
      const unexpected = [];
      const user = { id: 'synthetic-actor', name: 'Synthetic Person', email: 'synthetic@example.invalid', emailVerified: true, role: 'user', banned: false, createdAt: date, updatedAt: date };
      const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.origin); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) {
          if (url.pathname === '/smoke-content.md') return route.fulfill({ contentType: 'text/plain', body: '# Synthetic module content\n\nRead this without logging in.' });
          return route.continue();
        }
        if (url.pathname === '/api/auth/get-session') return json(route, signedIn ? { user, session: { id: 'synthetic-session', userId: user.id, token: 'synthetic-only', createdAt: date, updatedAt: date, expiresAt: '2099-01-01T00:00:00.000Z' } } : null);
        if (url.pathname === '/api/lessons/all') return json(route, [lesson]);
        if (url.pathname === `/api/lessons/${lesson.id}`) return json(route, { learning_resource: { ...lesson, created_by: { id: 'author', name: 'Synthetic Author' } }, learning_resource_module: [{ ...lessonModule, file, is_finished: false }] });
        if (url.pathname === `/api/lessons/${lesson.id}/module/${lessonModule.module_id}`) return json(route, [{ ...lessonModule, file: [file] }]);
        if (url.pathname === '/api/quiz/all') return json(route, [quiz]);
        if (url.pathname === `/api/quiz/get/${metadata.quiz_id}`) return json(route, quiz);
        if (request.method() !== 'GET') {
          writes.push({ path: url.pathname, body: request.postDataJSON() });
          return json(route, { success: true });
        }
        privateReads.push(url.pathname);
        if (signedIn && url.pathname === '/api/user.information') return json(route, { userId: user.id, username: 'synthetic', firstName: 'Synthetic', lastName: 'Person', email: user.email, dateOfBirth: '2000-01-01', contactNumber: '09123456789', agreedToTerms: true });
        if (signedIn && url.pathname.startsWith('/api/quiz/answers/')) return json(route, []);
        return json(route, { error: 'Unexpected API request' }, 500);
      });
      const page = await context.newPage();
      let modelReady = false;
      page.on('console', (message) => { if (message.text().includes('Model ready for inference!')) modelReady = true; });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(baseURL, { waitUntil: 'networkidle' });
      if (!signedIn) await page.getByRole('complementary', { name: 'Guest mode' }).waitFor();
      else assert.equal(await page.getByRole('complementary', { name: 'Guest mode' }).count(), 0);
      // Home survey is unrelated to guest mode; dismiss it if it appears.
      await page.goto(`${baseURL}/lesson/${lesson.id}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'View Module', exact: true }).click();
      await page.getByRole('heading', { name: 'Synthetic module content' }).waitFor();
      await page.getByRole('button', { name: signedIn ? 'Complete Module' : 'Complete Module (guest)', exact: true }).click();
      await page.getByRole('heading', { name: 'Congratulations!' }).waitFor();
      if (!signedIn) assert.equal(writes.length, 0);
      await page.goto(`${baseURL}/quiz/${metadata.quiz_id}/view`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
      await page.getByRole('button', { name: 'A', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
      await page.getByText('Score', { exact: true }).waitFor();
      if (!signedIn) {
        assert.equal(writes.length, 0, 'guest practice must not submit account records');
        assert.equal(privateReads.length, 0, 'guest must not request account/profile/history endpoints');
        await page.goto(`${baseURL}/transliterator`, { waitUntil: 'networkidle' });
        await page.getByPlaceholder('Type Latin...').fill('bata');
        assert.ok(await page.locator('textarea').nth(1).inputValue());
        await page.goto(`${baseURL}/ai/sketch`, { waitUntil: 'networkidle' });
        const notice = page.getByRole('button', { name: 'I Understand', exact: true });
        if (await notice.count()) await notice.click();
        await page.locator('canvas').first().waitFor();
        await page.getByText('Loading AI Model...', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
        assert.equal(modelReady, true, 'bundled model loads and warms up in the guest browser');
        await page.goto(`${baseURL}/ai/vision`, { waitUntil: 'networkidle' });
        await page.getByText('Loading AI Model...', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
        // The existing scanner defaults to image-upload mode; camera acquisition
        // must be explicitly enabled by the user, not silently started on entry.
        await page.getByRole('switch').first().click();
        await page.waitForFunction(() => [...document.querySelectorAll('video')].some((video) => video.videoWidth > 0), undefined, { timeout: 30000 });
      } else {
        assert.equal(writes.filter((item) => item.path.endsWith('/finish')).length, 1);
        assert.equal(writes.filter((item) => item.path.includes('/quiz/answers/save')).length, 1);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual([...new Set(unexpected.filter((origin) => !origin.includes('vercel')))], []);
      results.push({ viewport, signedIn, pageErrors: errors.length, accountWrites: writes.length, privateReads: privateReads.length });
      await context.close();
    }
  }
  const protectedHTTP = [];
  for (const [path, method] of [
    ['/api/user.information', 'GET'], ['/api/user.information/update', 'PUT'],
    ['/api/user.information/change-email', 'POST'], ['/api/quiz/save', 'POST'],
    ['/api/quiz/answers/save', 'POST'], ['/api/lessons/create', 'POST'],
    ['/api/lessons/progress/guest/last', 'GET'], ['/api/auth/verify.admin.session', 'GET'],
  ]) {
    const response = await fetch(`${baseURL}${path}`, { method,
      headers: { origin: baseURL, 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    assert.equal(response.status, 401, `${method} ${path}`);
    protectedHTTP.push({ path, method, status: response.status });
  }
  for (const path of ['/admin/users', '/ai/chat']) {
    const response = await fetch(`${baseURL}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location'), baseURL).pathname, '/auth/login');
    protectedHTTP.push({ path, method: 'GET', status: response.status });
  }
  console.log(JSON.stringify({ result: 'PASS', results, protectedHTTP, scope: 'Live Next.js pages and real local model assets; synthetic session/content APIs plus real anonymous HTTP denial checks. No provider or production DB validation.' }, null, 2));
} finally { await browser.close(); }
