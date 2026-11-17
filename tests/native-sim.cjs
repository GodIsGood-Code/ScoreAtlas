// The web app as the App Store app runs it: from native/www (what `npm run build` in native/ copies), with a stand-in
// for Capacitor and for the app's message handler. Checks that every file is there, nothing is fetched from elsewhere,
// the app tells the native side it's ready, files handed over by the app open, and web-only help is hidden.
//   (cd native && npm run build) then NODE_PATH="$(npm root -g)" node tests/native-sim.cjs
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('./serve.cjs');

const WWW = path.resolve(__dirname, '../native/www');
const ORIGIN = 'http://localhost:8765';

(async () => {
  const server = await serve(WWW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const errors = [], outside = [], missing = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__native = [];
    window.Capacitor = { isNativePlatform: () => true, convertFileSrc: (u) => u };
    window.webkit = { messageHandlers: { scoreAtlas: { postMessage: (m) => window.__native.push(m) } } };
  });
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => /\d+ \/ \d+/.test(document.querySelector('#pageNum').value), null, { timeout: 15000 });
  const msgs = await page.evaluate(() => window.__native);
  check('the app opens from the copied files (sample piece)', (await page.textContent('#pageNum')) === '1 / 4');
  check('it tells the app it is ready, and asks to keep the screen on', msgs.some((m) => m.ready) && msgs.some((m) => m.keepAwake === true), JSON.stringify(msgs));
  check('the typefaces are built in', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Atkinson Hyperlegible"') && [...document.fonts].some((f) => f.family.includes('Fraunces') && f.status === 'loaded'); }));
  // a file sent to ScoreAtlas (the app passes where it copied it)
  const ok = await page.evaluate((u) => window.scoreAtlasOpen(u, 'aba_dc.pdf'), `${ORIGIN}/samples/warm-ups.pdf`);
  await page.waitForTimeout(1500);
  check('a file handed over by the app opens', ok === true);
  check('the help hides website-only instructions', await page.evaluate(() => getComputedStyle(document.querySelector('#helpPanel details.web-only')).display === 'none' && getComputedStyle(document.querySelector('#helpPanel li.app-only')).display !== 'none'));
  // the heavier parts load too
  await page.evaluate(async () => { await import('./pitch.js'); await import('./pages.js'); await import('./vendor/pdf-lib/pdf-lib.esm.min.js'); });
  check('no file is missing', missing.length === 0, missing.join(' | '));
  check('nothing is fetched from the internet', outside.length === 0, outside.join(' | '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  server.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
