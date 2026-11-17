// Test 16 in a real browser (about a minute): adding a PDF with its sheet music in one go, the Practice menu (hands,
// hear the music, trouble spots from a practice history, the metronome), the journal's notes over time, editing pages
// (markings move along, sheet music is matched again) and sharing a setlist with its music.
//   NODE_PATH="$(npm root -g)" node tests/test16.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:8765';

(async () => {
  const server = await serve(ROOT);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-t16-')), { viewport: { width: 820, height: 1180 }, acceptDownloads: true });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  const pt = (fn, arg) => page.evaluate(fn, arg);
  const menu = async () => { if (await page.isHidden('#practiceMenu')) await page.click('#practiceBtn'); };
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 4');

  // ---------- Practice tools wait for sheet music ----------
  await page.click('#practiceBtn');
  check('without sheet music, loops and hearing the music are off', await page.isDisabled('#loopBtn') && await page.isDisabled('#hearBtn') && await page.isVisible('#practiceNote'));
  await page.keyboard.press('Escape');

  // ---------- A PDF and its sheet music in one go ----------
  await page.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/aba_dc.pdf'), path.join(__dirname, 'fixtures/aba_dc.mxl')]);
  const paired = await page.waitForFunction(() => /Sheet music: 16 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 30000 }).then(() => true, () => false);
  check('a PDF and its sheet music added together are paired', paired && (await page.textContent('#pageNum')) === '1 / 2');
  await page.click('#libraryBtn');
  await page.waitForSelector('.lib-piece', { timeout: 5000 }).catch(() => {});
  check('the piece is in the library', (await page.$$('.lib-piece[aria-label="Open aba_dc"]')).length === 1, `${(await page.$$('.lib-piece')).length} pieces`);
  await page.keyboard.press('Escape');

  // ---------- Hands ----------
  await menu();
  await page.click('#handsChoice [data-hand=left]');
  await page.waitForFunction(() => window.pageTurner.hands === 'left' && /Left hand only/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 }).catch(() => {});
  check('left hand only', (await pt(() => window.pageTurner.hands)) === 'left');
  await menu();
  check('the Practice button shows something is on', await page.isVisible('#practiceDot'));

  // ---------- Hear the music ----------
  await page.click('#hearBtn');
  await page.waitForFunction(() => window.pageTurner.hearing, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const h = await pt(() => window.pageTurner.hearing);
  check('hear the music plays with the bar highlighted', !!h && await page.isVisible('#hearBar') && await page.$eval('.measure-mark', (e) => !e.hidden), `${await page.textContent('#hearWhat')}, ${await page.textContent('#hearTime')}`);
  await page.screenshot({ path: path.join(__dirname, 'output/hear.png') });
  await page.$eval('#hearSpeed', (e) => { e.value = '1.5'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => window.pageTurner.hearing && window.pageTurner.hearing.speed === 1.5, null, { timeout: 15000 }).catch(() => {});
  check('a new speed carries on from the bar playing', (await pt(() => window.pageTurner.hearing && window.pageTurner.hearing.speed)) === 1.5);
  await page.click('#hearClose');
  check('Done stops the music', !(await pt(() => window.pageTurner.hearing)) && (await pt(() => window.pageTurner.mode)) === 'idle');
  await menu();
  await page.click('#handsChoice [data-hand=both]');

  // ---------- Trouble spots, from a practice history ----------
  const key = await pt(() => window.pageTurner.key);
  await pt(async (key) => {
    const store = await import('./store.js');
    const day = 86400000, now = Date.now();
    await store.saveLesson(`${key}|practice`, { sessions: [
      { date: now - day, seconds: 300, plays: [[5, 3]], hesitations: [[5, 2], [6, 1]], tempo: [[3, 90], [4, 92], [5, 60], [6, 91], [7, 90]], notes: { checked: 120, missed: 10, wrong: 2, byMeasure: [[5, 4, 8], [12, 2, 8]] } },
      { date: now, seconds: 240, plays: [[5, 4]], hesitations: [[5, 1]], tempo: [[3, 95], [4, 96], [5, 70], [6, 94]], notes: { checked: 120, missed: 4, wrong: 1, byMeasure: [[5, 2, 8], [12, 0, 8]] } },
    ] });
  }, key);
  await menu();
  await page.click('#troubleBtn');
  await page.waitForSelector('.trouble-go', { timeout: 5000 }).catch(() => {});
  const spots = await page.$$eval('.trouble-go b', (x) => x.map((b) => b.textContent));
  check('trouble spots list the worst bars first', spots.length >= 2 && /Bars 5–7/.test(spots[0]), spots.join(' | '));
  await page.screenshot({ path: path.join(__dirname, 'output/trouble.png') });
  await page.click('.trouble-go');
  const lp = await pt(() => window.pageTurner.loop);
  check('practicing a spot loops it with the metronome and the tempo ladder', lp && lp.from === 4 && lp.to === 6 && await page.isVisible('#metroBar') && await page.isChecked('#ladderOn'), `loop ${JSON.stringify(lp)}, tempo ${await page.inputValue('#metroTempo')}`);
  await page.click('#metroClose');
  await menu();
  await page.click('#loopBtn'); // loop off

  // ---------- Notes over time in the journal ----------
  await menu();
  await page.click('#journalBtn');
  await page.waitForFunction(() => /Notes over time/.test(document.querySelector('#journalBody').textContent), null, { timeout: 5000 }).catch(() => {});
  const jt = await page.textContent('#journalBody');
  check('the journal shows notes over time', /10\.0 in 100 notes in your first check, 4\.2 in your latest/.test(jt) && /Fixed: bar 13/.test(jt), (jt.match(/Missed or wrong[^.]*\./) || [''])[0]);
  await page.keyboard.press('Escape');

  // ---------- Edit pages: swap the two pages; markings move along; sheet music matched again ----------
  await page.click('#markBtn');
  await page.click('[data-tool="stamp"]');
  await page.click('#stampRow [data-stamp="ff"]');
  const unit = await page.$eval('#sheet .page canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(unit.x + unit.w * 0.5, unit.y + unit.h * 0.5);
  await page.click('#markDone');
  await page.waitForTimeout(600);
  if (await page.isHidden('#card')) await page.click('#helpBtn');
  await page.click('#editPagesBtn');
  await page.waitForFunction(() => document.querySelectorAll('.pe-page img').length === 2, null, { timeout: 10000 }).catch(() => {});
  check('edit pages shows every page', (await page.$$('.pe-page')).length === 2);
  await page.click('.pe-page:nth-child(2) [aria-label="Move earlier"]');
  await page.click('.pe-save');
  const rebuilt = await page.waitForFunction(() => /Saved: 2 pages/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }).then(() => true, () => false);
  const moved = await pt(() => window.pageTurner.marks().pages);
  check('after saving, the stamp moved with its page (now page 2)', rebuilt && moved[2] && moved[2].some((s) => s.k === 'ff') && !(moved[1] || []).length, JSON.stringify(Object.keys(moved)));
  check('the sheet music was matched to the new pages', /Sheet music: 16 measures/.test(await page.textContent('#lessonInfo')));
  await page.click('#libraryBtn');
  await page.waitForSelector('.lib-piece', { timeout: 5000 }).catch(() => {});
  check('the edited piece replaced the old one in the library', (await page.$$('.lib-piece')).length === 1, `${(await page.$$('.lib-piece')).length} pieces`);

  // ---------- Share a setlist ----------
  await page.click('.lib-tab[data-tab=setlists]');
  await page.click('text=New setlist');
  await page.fill('.lib-setname', 'Choir Sunday');
  await page.click('button[aria-label="Add aba_dc"]');
  await page.click('.lib-row >> text=Done');
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('.lib-list li >> text=Share');
  const file = await dl;
  let size = 0;
  if (file) { const p = await file.path(); size = p ? fs.statSync(p).size : 0; }
  check('a setlist is shared as one file with its music', !!file && /\.scoreatlas$/.test(file.suggestedFilename()) && size > 10000, file ? `${file.suggestedFilename()}, ${size} bytes` : 'no file');

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await ctx.close();
  server.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
