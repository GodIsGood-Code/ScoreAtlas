// End-to-end: the everyday essentials (Test 11): library, setlists, Pencil markings, two pages / half-page turns,
// the performance lock, and working offline. About half a minute.
//   NODE_PATH="$(npm root -g)" node tests/phasec.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:8765';

(async () => {
  const server = await serve(ROOT);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-phasec-'));
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 820, height: 1180 } });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  const num = () => page.evaluate(() => document.querySelector('#pageNum').value);
  const waitNum = (v) => page.waitForFunction((x) => document.querySelector('#pageNum').value === x, v, { timeout: 8000 }).then(() => true, () => false);
  const pt = (expr) => page.evaluate(expr);

  await page.goto(`${ORIGIN}/`);
  await waitNum('1 / 4');
  await page.click('#cardClose');

  // ---------- Library ----------
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures/aba_dc.pdf'));
  await waitNum('1 / 2');
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures/scan-test.pdf'));
  await waitNum('1 / 3');
  await page.waitForTimeout(800); // the library entry (with its picture) is saved in the background
  await page.click('#libraryBtn');
  await page.waitForSelector('#library:not([hidden]) .lib-piece', { timeout: 5000 }).catch(() => {});
  const names = await page.$$eval('.lib-piece .lib-name', (els) => els.map((e) => e.textContent));
  check('both PDFs are in the library', names.includes('aba_dc') && names.includes('scan-test'), names.join(', '));
  check('library pieces have a picture of page 1', (await page.$$('.lib-thumb img')).length >= 2);
  await page.click('.lib-piece[aria-label="Open aba_dc"] .lib-name');
  check('a piece opens from the library', await waitNum('1 / 2'));

  // ---------- Setlists ----------
  await page.click('#libraryBtn');
  await page.click('.lib-tab[data-tab="setlists"]');
  await page.click('text=New setlist');
  await page.fill('.lib-setname', 'Sunday');
  await page.click('button[aria-label="Add aba_dc"]');
  await page.click('button[aria-label="Add scan-test"]');
  await page.click('.lib-row >> text=Done');
  await page.click('.lib-list >> text=Play');
  check('a setlist starts with its first piece', await waitNum('1 / 2'));
  await page.waitForFunction(() => document.querySelector('#setlistText').textContent !== '', null, { timeout: 3000 }).catch(() => {});
  check('the setlist shows in the top bar', (await page.textContent('#setlistText')) === 'Sunday · 1/2', await page.textContent('#setlistText'));
  await page.keyboard.press('ArrowRight'); await waitNum('2 / 2');
  await page.keyboard.press('ArrowRight');
  check('the pedal on the last page opens the next piece', await waitNum('1 / 3'), await num());
  await page.waitForFunction(() => document.querySelector('#setlistText').textContent === 'Sunday · 2/2', null, { timeout: 3000 }).catch(() => {});
  check('... and the setlist moves on', (await page.textContent('#setlistText')) === 'Sunday · 2/2');
  await page.keyboard.press('ArrowLeft');
  check('back on the first page goes to the previous piece, at its end', await waitNum('2 / 2'), await num());
  await page.click('#setlistEnd');
  check('the setlist can be ended', await page.isHidden('#setlistChip'));
  // carry on with the three-page scan
  await page.click('#libraryBtn');
  await page.click('.lib-tab[data-tab="pieces"]');
  await page.click('.lib-piece[aria-label="Open scan-test"] .lib-name');
  await waitNum('1 / 3');
  await page.waitForTimeout(800); // the counter changes as soon as the page is asked for; let it be drawn

  // ---------- Pencil markings ----------
  const unit = await page.$eval('.page', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const strokes = async () => pt(() => Object.values(window.pageTurner.marks().pages).reduce((n, l) => n + l.length, 0));
  const pen = (x, y) => page.evaluate(({ x, y }) => {
    const target = document.querySelector('.page canvas.marks').parentElement;
    const ev = (type, dx, kind = 'pen', id = 7) => target.dispatchEvent(new PointerEvent(type, { pointerType: kind, pointerId: id, clientX: x + dx, clientY: y + dx / 3, pressure: 0.5, bubbles: true, cancelable: true }));
    ev('pointerdown', 0);
    for (let k = 1; k <= 12; k++) ev('pointermove', k * 8);
    ev('pointerdown', 200, 'touch', 9); ev('pointerup', 200, 'touch', 9); // the palm
    ev('pointerup', 100);
  }, { x, y });
  // without Mark on, the Pencil marks nothing (no accidental marks)
  await pen(unit.x + unit.w * 0.3, unit.y + unit.h * 0.3);
  await page.waitForTimeout(200);
  check('with Mark off, the Pencil doesn\'t mark', (await strokes()) === 0, `${await strokes()} strokes`);
  // Mark on: the Pencil draws, and a hand resting on the screen meanwhile doesn't turn the page
  await page.click('#markBtn');
  const before = await num();
  await pen(unit.x + unit.w * 0.3, unit.y + unit.h * 0.3);
  await page.waitForTimeout(200);
  check('with Mark on, the Pencil draws on the music', (await strokes()) === 1, `${await strokes()} strokes`);
  check('a resting hand doesn\'t turn the page', (await num()) === before);
  await page.waitForTimeout(700); // touches just after the Pencil count as the hand resting
  // a finger (here the mouse) draws too, and the highlighter and Undo work
  await page.click('[data-tool="highlight"]');
  await page.mouse.move(unit.x + unit.w * 0.3, unit.y + unit.h * 0.5); await page.mouse.down();
  await page.mouse.move(unit.x + unit.w * 0.6, unit.y + unit.h * 0.5, { steps: 6 }); await page.mouse.up();
  check('with Mark on, a finger draws (highlighter)', (await strokes()) === 2);
  check('drawing doesn\'t turn the page', (await num()) === before);
  await page.click('#markUndo');
  check('Undo takes the last mark away', (await strokes()) === 1);
  // a thick pen
  await page.$eval('#sizeSlider', (e) => { e.value = '1.8'; e.dispatchEvent(new Event('input')); });
  await page.click('[data-tool="pen"]');
  await page.click('#inkRow [data-color="#c62828"]');
  await page.mouse.move(unit.x + unit.w * 0.3, unit.y + unit.h * 0.4); await page.mouse.down();
  await page.mouse.move(unit.x + unit.w * 0.5, unit.y + unit.h * 0.45, { steps: 5 }); await page.mouse.up();
  const thick = await pt(() => { const all = Object.values(window.pageTurner.marks().pages).flat(); return all[all.length - 1]; });
  check('the pen size can be changed (slider) and its color (red)', thick && thick.t === 'pen' && Math.abs(thick.w - 0.0022 * 1.8) < 1e-6 && thick.c === '#c62828', thick && `w ${thick.w} ${thick.c}`);
  await page.click('#markUndo');
  // any color from the color wheel
  await page.$eval('#inkPicker', (e) => { e.value = '#2e7d32'; e.dispatchEvent(new Event('input')); });
  await page.mouse.move(unit.x + unit.w * 0.3, unit.y + unit.h * 0.4); await page.mouse.down();
  await page.mouse.move(unit.x + unit.w * 0.5, unit.y + unit.h * 0.45, { steps: 5 }); await page.mouse.up();
  const green = await pt(() => { const all = Object.values(window.pageTurner.marks().pages).flat(); return all[all.length - 1]; });
  check('a color from the color wheel', green && green.c === '#2e7d32', green && green.c);
  await page.click('#markUndo');
  // a stamp and a text note
  await page.click('[data-tool="stamp"]');
  await page.click('#stampRow [data-stamp="mf"]');
  await page.mouse.click(unit.x + unit.w * 0.4, unit.y + unit.h * 0.3);
  check('a stamp (mf) can be placed', await pt(() => Object.values(window.pageTurner.marks().pages).flat().some((s) => s.t === 'stamp' && s.k === 'mf')));
  await page.click('[data-tool="text"]');
  await page.mouse.click(unit.x + unit.w * 0.2, unit.y + unit.h * 0.7);
  await page.fill('#noteText', 'Slow here');
  await page.press('#noteText', 'Enter');
  check('a text note can be written', await pt(() => Object.values(window.pageTurner.marks().pages).flat().some((s) => s.t === 'note' && s.s === 'Slow here')));
  await page.click('#markUndo'); await page.click('#markUndo');
  await page.$eval('#sizeSlider', (e) => { e.value = '1'; e.dispatchEvent(new Event('input')); });
  await page.click('[data-tool="finger"]');
  await page.click('#digitRow >> text=3');
  await page.mouse.click(unit.x + unit.w * 0.5, unit.y + unit.h * 0.2);
  check('a fingering number can be placed', await pt(() => Object.values(window.pageTurner.marks().pages).flat().some((s) => s.t === 'text' && s.s === '3')));
  await page.click('#markDone');
  await page.waitForTimeout(700);
  await page.reload();
  await waitNum('1 / 3');
  await page.waitForTimeout(500);
  check('markings are kept with the piece', (await strokes()) === 2, `${await strokes()} after reload`);
  await page.screenshot({ path: path.join(__dirname, 'output/marks.png') });

  // ---------- Half-page turns ----------
  await page.click('#viewBtn');
  await page.check('#halfToggle');
  await page.click('#viewBtn');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const half = await pt(() => window.pageTurner.view);
  check('half-page turn: the next page\'s top half over this page\'s bottom half', half.half && half.shown.join() === '2,1', JSON.stringify(half.shown));
  await page.screenshot({ path: path.join(__dirname, 'output/half-page.png') });
  await page.keyboard.press('ArrowRight');
  check('... then the next page', await waitNum('2 / 3'));
  await page.click('#viewBtn'); await page.uncheck('#halfToggle'); await page.click('#viewBtn');

  // ---------- Two pages side by side (sideways) ----------
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.click('#viewBtn');
  await page.check('#twoUpToggle');
  await page.click('#viewBtn');
  await page.waitForTimeout(600);
  const two = await pt(() => window.pageTurner.view);
  check('two pages side by side when sideways', two.twoUp && two.shown.join() === '1,2', JSON.stringify(two.shown));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check('the pedal turns both pages', (await pt(() => window.pageTurner.view.shown.join())) === '3' && (await num()) === '3 / 3', await num());
  await page.screenshot({ path: path.join(__dirname, 'output/two-pages.png') });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(600);
  check('upright, one page again', (await pt(() => window.pageTurner.view.shown.length)) === 1);

  // ---------- Performance lock ----------
  await page.keyboard.press('ArrowLeft'); await waitNum('2 / 3');
  await page.click('#viewBtn');
  await page.click('#lockBtn');
  const box = await page.$eval('#stand', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.8, box.y + box.h * 0.6);
  await page.waitForTimeout(300);
  check('locked: a tap doesn\'t turn the page', (await num()) === '2 / 3');
  check('locked: the buttons are hidden', !(await page.isVisible('#followBtn')));
  await page.keyboard.press('ArrowRight');
  check('locked: the pedal still turns pages', await waitNum('3 / 3'));
  const ub = await page.$eval('#unlockBtn', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(ub.x, ub.y); await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
  check('a short press doesn\'t unlock', await pt(() => window.pageTurner.locked));
  await page.mouse.down(); await page.waitForTimeout(1100); await page.mouse.up();
  check('holding the lock button unlocks', !(await pt(() => window.pageTurner.locked)));

  // ---------- Offline ----------
  await page.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return !!r.active && (await caches.keys()).length > 0; }, null, { timeout: 15000 }).catch(() => {});
  check('the app keeps itself for offline use', await page.isVisible('#offlineNote') || (await pt(async () => (await caches.keys()).length > 0)));
  await ctx.setOffline(true);
  await page.reload();
  const opened = await waitNum('1 / 3') || await waitNum('3 / 3');
  check('offline: the app still opens, with the last piece', opened, await num());
  await page.click('#libraryBtn');
  await page.waitForSelector('#library:not([hidden]) .lib-piece', { timeout: 5000 }).catch(() => {});
  await page.click('.lib-piece[aria-label="Open aba_dc"] .lib-name').catch(() => {});
  check('offline: pieces open from the library', await waitNum('1 / 2'));
  await ctx.setOffline(false);

  // ---------- Settings, Help, the welcome tour ----------
  await page.click('#viewBtn');
  await page.click('#openSettings');
  check('Settings opens from the View menu', await page.isVisible('#settingsPanel'));
  await page.click('#themeChoice button[data-theme="dark"]');
  check('appearance can be set to dark', (await pt(() => document.documentElement.dataset.theme)) === 'dark');
  await page.click('#themeChoice button[data-theme="auto"]');
  await page.$eval('#turnShift', (e) => { e.value = '0.5'; e.dispatchEvent(new Event('input')); });
  check('page turns can be set earlier', (await pt(() => window.pageTurner.settings.turnShift)) === 0.5 && (await page.textContent('#turnShiftText')) === '0.5 s earlier');
  await page.uncheck('#setTap');
  await page.click('#settingsPanel .panel-close');
  const pg = await num();
  const st = await page.$eval('#stand', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(st.x + st.w * 0.8, st.y + st.h * 0.6);
  await page.waitForTimeout(300);
  check('with tap-to-turn off, a tap doesn\'t turn the page', (await num()) === pg);
  await page.click('#viewBtn'); await page.click('#openSettings'); await page.check('#setTap'); await page.click('#settingsPanel .panel-close');
  await page.click('#helpBtn');
  await page.click('#cardHelp');
  check('Help opens from the Piece panel', await page.isVisible('#helpPanel') && !(await page.isVisible('#card')));
  await page.keyboard.press('Escape');
  check('Esc closes Help', await page.isHidden('#helpPanel'));
  await pt(() => window.pageTurner.showTour());
  check('the welcome tour shows', await page.isVisible('#tour'));
  for (let i = 0; i < 5; i++) await page.click('#tourNext');
  check('the tour ends with Get started', (await page.textContent('#tourNext')) === 'Get started');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'output/tour.png') });
  await page.click('#tourNext');
  check('... and closes', await page.isHidden('#tour'));

  check('no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
  server.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
