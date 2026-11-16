// Real app + bundled samples. No content/session fixtures or DB/service startup.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.GUEST_SMOKE_URL || 'http://127.0.0.1:19809';
assert.equal(new URL(baseURL).hostname, '127.0.0.1');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`Checking real sample showcase ${viewport.width}x${viewport.height}`);
    const context = await browser.newContext({ viewport });
    // Suppress only the unrelated legacy survey dialog, not any app data/API.
    await context.addInitScript(() => localStorage.setItem('dontShowSurveyAgain', 'true'));
    const writes = [];
    const modelRequests = [];
    const errors = [];
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin !== baseURL) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/models/')) modelRequests.push(request.url());
      if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url());
    });
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.getByText('Live content is unavailable or empty.', { exact: false }).waitFor();
    // Navigate through the real links rather than injecting catalog responses.
    const sampleLesson = page.locator('a[href="/lesson/sample-baybayin-introduction"]');
    await sampleLesson.first().click();
    await page.getByRole('button', { name: 'View Module', exact: true }).click();
    await page.getByRole('heading', { name: 'Sample: Baybayin vowels and practice' }).waitFor();
    await page.getByRole('button', { name: 'Complete Module (guest)', exact: true }).click();
    await page.getByRole('heading', { name: 'Congratulations!' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('link', { name: 'Try the sample quiz', exact: true }).click();
    await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
    await page.getByRole('button', { name: 'ᜀ', exact: true }).click();
    const transitionStarted = Date.now();
    await page.getByRole('button', { name: 'E/I', exact: true }).click();
    const transitionMs = Date.now() - transitionStarted;
    assert.ok(transitionMs < 10000, 'text-only question transition should not wait for a recognition model');
    await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
    await page.getByText('Bundled sample', { exact: false }).waitFor();
    assert.deepEqual(writes, [], 'sample reading/practice must never write account records');
    assert.deepEqual(errors, []);
    assert.deepEqual(modelRequests, [], 'text-only sample must not download model assets');
    results.push({ viewport, accountWrites: writes.length, pageErrors: errors.length, modelRequests: modelRequests.length, transitionMs, sampleLesson: 'read + completed locally', sampleQuiz: 'two answers + result' });
    await context.close();
  }
  console.log(JSON.stringify({ result: 'PASS', results, scope: 'Real local app with unavailable content DB; real bundled sample pages, no content/session API mocks. No production/provider test.' }, null, 2));
} finally { await browser.close(); }
