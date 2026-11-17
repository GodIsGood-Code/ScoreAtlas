// Pinch to zoom and kept takes in a real browser (about a minute).
//   python3 tools/synth_performances.py tests/output/perf faster   (the performance the fake microphone plays)
//   NODE_PATH="$(npm root -g)" node tests/test17.cjs
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
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-t17-')), {
    viewport: { width: 820, height: 1180 }, acceptDownloads: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(PERF, 'faster.wav')}%noloop`],
  });
  await ctx.grantPermissions(['microphone'], { origin: ORIGIN });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept('Audition run'));
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  const pt = (fn, arg) => page.evaluate(fn, arg);
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 4');
  await page.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/aba_dc.pdf'), path.join(__dirname, 'fixtures/aba_dc.mxl')]);
  await page.waitForFunction(() => /Sheet music: 16 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 30000 });
  if (await page.isVisible('#card')) await page.click('#cardClose');

  // ---------- Pinch to zoom ----------
  const box = await page.$eval('#stand', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const widthBefore = await page.$eval('#sheet .page canvas', (c) => c.width);
  // two fingers moving apart, around a point in the upper middle of the page
  const cx = box.x + box.w / 2, cy = box.y + box.h * 0.35;
  await pt(({ cx, cy }) => {
    const stand = document.querySelector('#stand'), target = document.querySelector('#sheet .page canvas');
    const ev = (type, id, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
    ev('pointerdown', 1, cx - 40, cy); ev('pointerdown', 2, cx + 40, cy);
    for (let k = 1; k <= 10; k++) { ev('pointermove', 1, cx - 40 - 8 * k, cy); ev('pointermove', 2, cx + 40 + 8 * k, cy); }
    ev('pointerup', 1, cx - 120, cy); ev('pointerup', 2, cx + 120, cy);
  }, { cx, cy });
  const z = await pt(() => window.pageTurner.zoom);
  check('pinching apart zooms in (fingers three times as far apart: 3x)', z.z > 2.8 && z.z < 3.2, `${z.z.toFixed(2)}x`);
  check('the zoom shows, with a way back to the whole page', await page.isVisible('#zoomChip'), await page.textContent('#zoomText'));
  check('the pinch did not turn the page', (await page.textContent('#pageNum')) === '1 / 2');
  await page.waitForTimeout(900);
  const widthAfter = await page.$eval('#sheet .page canvas', (c) => c.width);
  check('the page is drawn again sharper for the zoom', widthAfter > widthBefore * 1.5, `${widthBefore} → ${widthAfter} pixels wide`);
  // one finger moves the zoomed page around, and doesn't turn it
  const before = (await pt(() => window.pageTurner.zoom)).x;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx - 150, cy, { steps: 6 }); await page.mouse.up();
  const after = await pt(() => window.pageTurner.zoom);
  check('one finger moves the zoomed page (no turn)', after.x < before - 50 && (await page.textContent('#pageNum')) === '1 / 2', `x ${before.toFixed(0)} → ${after.x.toFixed(0)}`);
  await page.screenshot({ path: path.join(__dirname, 'output/zoom.png') });
  // a turn (pedal) while zoomed keeps the zoom and shows the new page from its top
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '2 / 2');
  const z2 = await pt(() => window.pageTurner.zoom);
  check('turning while zoomed keeps the zoom, from the top of the page', z2.z > 2.8 && z2.y > 0, `y ${z2.y.toFixed(0)}`);
  await page.click('#zoomReset');
  check('Whole page goes back', (await pt(() => window.pageTurner.zoom)).z === 1 && await page.isHidden('#zoomChip'));
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 2');

  // ---------- Keep this take ----------
  await page.click('#followBtn');
  await page.waitForFunction(() => window.pageTurner.audioTime >= 28, null, { timeout: 60000, polling: 200 });
  await page.click('#followBtn'); // stop: the report opens
  await page.waitForSelector('#keepTakeBtn', { timeout: 15000 }).catch(() => {});
  check('the report offers keeping the take', await page.isVisible('#keepTakeBtn'));
  await page.click('#keepTakeBtn');
  await page.waitForFunction(() => /Take kept/.test(document.querySelector('#keepTakeBtn').textContent), null, { timeout: 10000 }).catch(() => {});
  check('the take is kept', /Take kept/.test(await page.textContent('#keepTakeBtn')));
  await page.click('#reportClose');
  await page.click('#practiceBtn');
  await page.click('#historyBtn');
  await page.click('#historyTabs [data-tab=takes]');
  await page.waitForSelector('.takes-list li', { timeout: 5000 }).catch(() => {});
  check('Kept takes lists it', (await page.$$('.takes-list li')).length === 1, (await page.textContent('#takesBody')).slice(0, 80));
  await page.click('.takes-list >> text=Rename');
  await page.waitForFunction(() => /Audition run/.test(document.querySelector('#takesBody').textContent), null, { timeout: 5000 }).catch(() => {});
  check('a take can be renamed', /Audition run/.test(await page.textContent('#takesBody')));
  // it survives a reload
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 2', null, { timeout: 15000 });
  await page.click('#practiceBtn');
  await page.click('#historyBtn');
  await page.click('#historyTabs [data-tab=takes]');
  await page.waitForSelector('.takes-list li', { timeout: 5000 }).catch(() => {});
  await page.click('.takes-list >> text=Play');
  await page.waitForTimeout(6000);
  const rp = await pt(() => ({ r: window.pageTurner.replaying, mode: window.pageTurner.mode, mark: !document.querySelector('.measure-mark').hidden, title: document.querySelector('#rpTitle').textContent }));
  check('a kept take plays after a reload, with the bar highlighted', rp.r && rp.mode === 'replay' && rp.mark && rp.title === 'Audition run', JSON.stringify(rp));
  check('a kept take can\'t be kept twice', await page.isHidden('#rpKeep'));
  await page.screenshot({ path: path.join(__dirname, 'output/take.png') });
  await page.click('#rpClose');
  await page.click('#practiceBtn');
  await page.click('#historyBtn');
  await page.click('#historyTabs [data-tab=takes]');
  await page.waitForSelector('.takes-list li', { timeout: 5000 }).catch(() => {});
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('.takes-list >> text=Share');
  const file = await dl;
  check('a take is shared as a WAV file', !!file && /\.wav$/.test(file.suggestedFilename()), file ? file.suggestedFilename() : 'no file');
  await page.click('.takes-list >> text=Delete');
  await page.click('.takes-list >> text=Tap again');
  await page.waitForFunction(() => /No takes kept/.test(document.querySelector('#takesBody').textContent), null, { timeout: 5000 }).catch(() => {});
  check('a take can be deleted', /No takes kept/.test(await page.textContent('#takesBody')));

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await ctx.close();
  server.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
