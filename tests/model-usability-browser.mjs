// Real local pages/model; synthetic guest session and one failed model request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.GUEST_SMOKE_URL || 'http://127.0.0.1:19809';
assert.equal(new URL(baseURL).hostname, '127.0.0.1', 'loopback only');
const browser = await chromium.launch({ headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
async function contrast(locator) {
  return locator.evaluate(element => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const rgb = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
    let parent = element, background;
    while (parent) { const color = rgb(getComputedStyle(parent).backgroundColor); if (color[3] === 255) { background = color; break; } parent = parent.parentElement; }
    if (!background) throw new Error('No opaque surface for targeted contrast check');
    const luminance = values => values.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(rgb(getComputedStyle(element).color)), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}
const results = [];
try {
  for (const viewport of [{ width: 375, height: 900 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ ...devices['Pixel 7'], viewport, permissions: ['camera'], reducedMotion: 'reduce' });
    let failModel = true, modelRequests = 0;
    const errors = [], writes = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/auth/get-session') return route.fulfill({ contentType: 'application/json', body: 'null', headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' } });
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) { writes.push(url.pathname); return route.abort(); }
      if (url.pathname === '/models/model.json') { modelRequests++; if (failModel) return route.fulfill({ status: 503, body: 'synthetic model failure' }); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/ai/sketch`, { waitUntil: 'networkidle' });
    const description = page.getByText('The AI model may not be 100% accurate. Expect occasional misreads and always verify the output.', { exact: true });
    const descriptionContrast = await contrast(description);
    assert.ok(descriptionContrast >= 4.5);
    await page.getByRole('button', { name: 'I Understand', exact: true }).click();
    await page.getByRole('button', { name: 'Retry recognition', exact: true }).waitFor();
    assert.equal(await page.locator('.fixed.inset-0.z-50').count(), 0, 'failed initialization cannot trap the page behind an overlay');
    const analyze = page.getByRole('button', { name: 'Analyze Drawing', exact: true });
    assert.equal(await analyze.isDisabled(), true);
    // Draw through the real mouse handlers while recognition is unavailable.
    const canvas = page.locator('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const box = await canvas.boundingBox();
    const y = Math.max(10, Math.min(viewport.height - 20, box.y + box.height / 2));
    const x = box.x + box.width / 2;
    await page.mouse.move(x - 20, y); await page.mouse.down();
    await page.waitForTimeout(50); await page.mouse.move(x + 20, y + 10, { steps: 5 }); await page.mouse.up();
    assert.ok(await canvas.evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0)), 'drawing must work before the model is ready');
    failModel = false;
    await page.getByRole('button', { name: 'Retry recognition', exact: true }).click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Analyze Drawing')?.disabled, undefined, { timeout: 120000 });
    const analyzeContrast = await contrast(analyze);
    assert.ok(analyzeContrast >= 4.5);
    if (process.env.UI_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.UI_ARTIFACT_DIR}/model-sketch-${viewport.width}.png`, fullPage: true });
    const beforeNavigation = modelRequests;
    await page.evaluate(() => localStorage.removeItem('agreedAccuracyNotice'));
    const started = Date.now();
    await page.getByRole('link', { name: 'Try scanning', exact: true }).click();
    const heading = page.getByRole('heading', { name: 'Model Accuracy Notice' });
    await heading.waitFor();
    const headingContrast = await contrast(heading);
    assert.ok(headingContrast >= 3);
    if (process.env.UI_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.UI_ARTIFACT_DIR}/model-notice-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'I Understand', exact: true }).click();
    assert.equal(modelRequests, beforeNavigation, 'client-side scanner navigation must reuse the ready model');
    assert.equal(await page.getByRole('button', { name: 'Retry recognition' }).count(), 0);
    await page.getByRole('switch').first().click();
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
    await page.locator('video').evaluate(video => { window.testTrack = video.srcObject.getVideoTracks()[0]; });
    await page.getByRole('switch').first().click();
    await page.waitForFunction(() => window.testTrack.readyState === 'ended');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    results.push({ viewport, failureRecovery: 'PASS', drawingBeforeReadiness: true, modelReused: true, fakeCameraStopped: true, navigationAndCameraMs: Date.now() - started, contrast: { descriptionContrast, analyzeContrast, headingContrast }, pageErrors: errors.length, accountWrites: writes.length });
    await context.close();
  }
  console.log(JSON.stringify({ result: 'PASS', results, physicalDeviceTested: false }, null, 2));
} finally { await browser.close(); }
