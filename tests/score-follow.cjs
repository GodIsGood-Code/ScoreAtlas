// End-to-end: page turning from sheet music in a real browser, with no teaching. Takes about 1.7 minutes.
//   python3 tools/synth_performances.py tests/output/perf faster   (the performance the fake microphone plays)
//   NODE_PATH="$(npm root -g)" node tests/score-follow.cjs
// Opens tests/fixtures/aba_dc.pdf (the A A B A test piece written as ||: A (Fine) :|| B (D.C. al Fine), 2 pages),
// adds tests/fixtures/aba_dc.mxl (what Audiveris read from that PDF), and follows the A A B A performance:
// it must turn to page 2 when B starts and back to page 1 for the D.C., and highlight the measures.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:8765';
const PERF = path.join(__dirname, 'output/perf');

(async () => {
  const server = await serve(ROOT);
  const T = JSON.parse(fs.readFileSync(path.join(PERF, 'faster.json'), 'utf8'));
  const at = (b) => { const i = T.beats.findIndex((x) => x >= b); return T.times[i - 1] + (b - T.beats[i - 1]) / (T.beats[i] - T.beats[i - 1]) * (T.times[i] - T.times[i - 1]); };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-score-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    viewport: { width: 820, height: 1180 },
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(PERF, 'faster.wav')}%noloop`],
  });
  await ctx.grantPermissions(['microphone'], { origin: ORIGIN });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 4');
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures/aba_dc.pdf'));
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 2', null, { timeout: 10000 });
  const t0 = Date.now();
  await page.setInputFiles('#scoreInput', path.join(__dirname, 'fixtures/aba_dc.mxl'));
  await page.waitForFunction(() => /Sheet music: 16 measures on 2 pages/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 30000 }).catch(() => {});
  const info = await page.textContent('#lessonInfo');
  check('sheet music added', /Sheet music: 16 measures on 2 pages\.$/.test(info.trim()), `${info.trim()}; took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check('Follow is ready without teaching', !(await page.isDisabled('#followBtn')));

  await page.click('#followBtn');
  // watch the highlight while the A section plays
  let marks = 0;
  const mid = at(12);
  await page.waitForFunction((t) => window.pageTurner.audioTime >= t, mid, { timeout: 60000, polling: 50 });
  for (let i = 0; i < 10; i++) {
    if (await page.$eval('.measure-mark', (e) => !e.hidden).catch(() => false)) marks++;
    await page.waitForTimeout(100);
  }
  check('the measure being played is highlighted', marks >= 8, `${marks}/10 checks showed it`);
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'output/score-following.png') });
  await page.waitForFunction((t) => window.pageTurner.audioTime >= t, at(124), { timeout: 120000, polling: 100 });
  const turns = await page.evaluate(() => window.pageTurner.turns);
  const near = (page, beat) => turns.find((t) => t.page === page && t.time >= at(beat) - 2 && t.time <= at(beat) + 0.3);
  const to2 = near(2, 64), back1 = near(1, 96);
  const fmt = (t, b) => (t ? `${(t.time - at(b)).toFixed(2)} s from the moment the new page's music starts` : 'never');
  check('turned to page 2 for section B', !!to2, fmt(to2, 64));
  check('turned back to page 1 for the D.C.', !!back1, fmt(back1, 96));
  check('no other page changes', turns.length === 2, turns.map((t) => `${t.time.toFixed(1)}s p${t.page} ${t.how}`).join(', '));

  // Sheet music options: type the first bar of page 2 and apply; the choice is kept after a reload
  await page.click('#followBtn'); // stop
  check('sheet music options shown', await page.isVisible('#scoreOpts'));
  check('no part list for a one-part piece', !(await page.isVisible('#partsBox')));
  await page.fill('#barsInput', '9');
  await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
  await page.click('#applyBtn');
  await page.waitForFunction(() => /Sheet music ready/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }).catch(() => {});
  const info2 = (await page.textContent('#lessonInfo')).trim();
  check('rebuilt from bar numbers', /Sheet music: 16 measures on 2 pages\.$/.test(info2), info2);
  await page.reload();
  await page.waitForFunction(() => /Sheet music/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 15000 }).catch(() => {});
  check('bar numbers kept after a reload', (await page.inputValue('#barsInput')) === '9', await page.inputValue('#barsInput'));
  check('no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
  server.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
