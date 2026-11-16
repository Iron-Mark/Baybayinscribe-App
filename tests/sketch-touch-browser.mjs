// Real local sketch page/model with a synthetic guest session boundary.
// No physical-device accuracy or real authentication claim.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.GUEST_SMOKE_URL || 'http://127.0.0.1:19809';
assert.equal(new URL(baseURL).hostname, '127.0.0.1', 'local server only');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
try {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const errors = [];
  const warnings = [];
  const writes = [];
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    // Local env may point auth at the public deployment; never contact it.
    if (url.pathname === '/api/auth/get-session' && request.method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: 'null', headers: {
        'access-control-allow-origin': new URL(baseURL).origin,
        'access-control-allow-credentials': 'true',
      } });
    }
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) {
      writes.push(url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/passive event listener|preventDefault/i.test(message.text())) warnings.push(message.text());
  });
  const response = await page.goto(`${baseURL}/ai/sketch`, { waitUntil: 'networkidle', timeout: 120000 });
  assert.equal(response.status(), 200, 'sketch page must load successfully');
  const notice = page.getByRole('button', { name: 'I Understand', exact: true });
  await page.getByRole('heading', { name: 'Model Accuracy Notice' }).waitFor();
  if (await notice.count()) await notice.click();
  await page.getByRole('button', { name: 'Analyze Drawing', exact: true }).waitFor();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Analyze Drawing')?.disabled, undefined, { timeout: 120000 });
  const canvas = page.locator('canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250); // Let initial canvas resize/image restoration settle.
  assert.equal(await canvas.evaluate(element => getComputedStyle(element).touchAction), 'none');
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 60 && box.height > 60);
  const viewport = page.viewportSize();
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(viewport.width, box.x + box.width);
  const bottom = Math.min(viewport.height, box.y + box.height);
  assert.ok(right - left > 60 && bottom - top > 60, 'stroke must stay inside the visible canvas');
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  const scrollBefore = await page.evaluate(() => [scrollX, scrollY]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 25, y: y - 25 }] });
  await page.waitForTimeout(50); // A real stroke spans frames; let React commit drawing state.
  for (const offset of [-10, 5, 25]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + offset, y: y + offset }] });
    await page.waitForTimeout(50);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const inkPixels = await canvas.evaluate(element => {
    const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
    let ink = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) ink++;
    return ink;
  });
  assert.ok(inkPixels > 0, 'real touch gesture must leave ink');
  assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scrollBefore, 'drawing must not scroll the page');
  await page.waitForTimeout(250);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], 'no passive-touch warnings');
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ result: 'PASS', device: 'Pixel 7 / Chromium emulation', inkPixels,
    touchAction: 'none', pageScrolled: false, passiveTouchWarnings: warnings.length,
    pageErrors: errors.length, accountWrites: writes.length, physicalDeviceTested: false }, null, 2));
} finally {
  await browser.close();
}
