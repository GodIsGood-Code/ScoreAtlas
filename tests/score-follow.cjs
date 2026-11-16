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

  // Stopping opens the practice report
  await page.click('#followBtn'); // stop
  await page.waitForSelector('#report:not([hidden])', { timeout: 15000 }).catch(() => {});
  const reportText = (await page.textContent('#reportBody').catch(() => '')) || '';
  check('practice report opens after stopping', await page.isVisible('#report'), reportText.slice(0, 80));
  check('report shows a tempo graph', (await page.$('#reportBody .tempo-line')) !== null);
  check('bars on the page are tinted by practice', (await page.$$('.heat-mark')).length > 0, `${(await page.$$('.heat-mark')).length} bars`);
  await page.screenshot({ path: path.join(__dirname, 'output/practice-report.png') });
  // the report can be dragged out of the way by its title
  const before = await page.$eval('#report', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const head = await page.$eval('#report .report-head h2', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
  await page.mouse.move(head.x, head.y); await page.mouse.down();
  await page.mouse.move(head.x - 300, head.y + 300, { steps: 8 }); await page.mouse.up();
  const after = await page.$eval('#report', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  check('the report moves when dragged by its title', before.x - after.x > 250 && after.y - before.y > 250, `from ${Math.round(before.x)},${Math.round(before.y)} to ${Math.round(after.x)},${Math.round(after.y)}`);
  // Listen back: the recording plays with the highlight and pages following
  check('the report offers listening back', await page.isVisible('#replayBtn'));
  check('bars in the report have a listen button', (await page.$$('#reportBody .listen-btn:not([hidden])')).length > 0);
  await page.click('#replayBtn');
  await page.waitForTimeout(2500);
  const rp = await page.evaluate(() => ({ bar: !document.querySelector('#replayBar').hidden, time: document.querySelector('#rpTime').textContent,
    seek: Number(document.querySelector('#rpSeek').value), mark: !document.querySelector('.measure-mark').hidden, mode: window.pageTurner.mode }));
  check('listening back plays the session', rp.bar && rp.seek > 1 && rp.mode === 'replay', `${rp.time}`);
  check('the highlight follows the replay', rp.mark);
  await page.screenshot({ path: path.join(__dirname, 'output/replay.png') });
  await page.$eval('#rpSeek', (e) => { e.value = '50'; e.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(400);
  check('jumping to 50 s in the replay shows page 2 (section B)', (await page.inputValue('#rpSeek').then(Number)) >= 50 && (await page.evaluate(() => window.pageTurner.page)) === 2, `page ${await page.evaluate(() => window.pageTurner.page)}`);
  await page.click('#rpClose');
  check('Done ends the replay', (await page.evaluate(() => window.pageTurner.mode)) === 'idle' && (await page.isHidden('#replayBar')));
  await page.click('#reportClose');
  // Loop: tap Loop, then the first and the third bar on the page
  await page.click('#loopBtn');
  const cbox = await page.$eval('#sheet canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const boxes = await page.evaluate(() => window.pageTurner.layoutOnPage());
  if (boxes.length >= 3) {
    const tap = async (b) => page.mouse.click(cbox.x + ((b.x0 + b.x1) / 2) * cbox.w, cbox.y + ((b.y0 + b.y1) / 2) * cbox.h);
    await tap(boxes[0]); await page.waitForTimeout(100); await tap(boxes[2]); await page.waitForTimeout(200);
  }
  check('a loop over three bars is outlined', (await page.$$('.loop-mark')).length === 3, `${(await page.$$('.loop-mark')).length} outlined`);
  check('the Loop button now turns it off', (await page.textContent('#loopBtn')) === 'Loop off');
  await page.click('#loopBtn');
  if (await page.isHidden('#card')) await page.click('#helpBtn');
  // Sheet music options: type the first bar of page 2 and apply; the choice is kept after a reload
  check('sheet music options shown', await page.isVisible('#scoreOpts'));
  check('no part list for a one-part piece', !(await page.isVisible('#partsBox')));
  await page.$eval('#scoreOpts', (d) => { d.open = true; }); // a fold-out section
  await page.fill('#barsInput', '9');
  await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
  await page.click('#applyBtn');
  await page.waitForFunction(() => /Sheet music ready/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }).catch(() => {});
  const info2 = (await page.textContent('#lessonInfo')).trim();
  check('rebuilt from bar numbers', /Sheet music: 16 measures on 2 pages\.$/.test(info2), info2);
  await page.waitForTimeout(1500); // let the save finish
  await page.reload();
  await page.waitForFunction(() => /Sheet music/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 15000 }).catch(() => {});
  check('bar numbers kept after a reload', (await page.inputValue('#barsInput')) === '9', await page.inputValue('#barsInput'));
  check('no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
  server.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
