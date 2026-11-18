// End-to-end: Test 14's features: go to a page / bar / bookmark, trimmed margins and dark pages, the metronome, the
// practice journal, a PDF with markings, and backup and restore. About half a minute.
//   NODE_PATH="$(npm root -g)" node tests/extras.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:8765';

(async () => {
  const server = await serve(ROOT);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-extras-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-extras-out-'));
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 820, height: 1180 }, acceptDownloads: true });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  const num = () => page.evaluate(() => document.querySelector('#pageNum').value);
  const waitNum = (v) => page.waitForFunction((x) => document.querySelector('#pageNum').value === x, v, { timeout: 8000 }).then(() => true, () => false);
  const pt = (f) => page.evaluate(f);

  await page.goto(`${ORIGIN}/`);
  await waitNum('1 / 4');
  await page.click('#cardClose');
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures/aba_dc.pdf'));
  await waitNum('1 / 2');
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures/scan-test.pdf'));
  await waitNum('1 / 3');
  await page.waitForTimeout(800);

  // ---------- Go to a page, bookmarks ----------
  await page.click('#pageNum');
  check('tapping the page number opens Go to', await page.isVisible('#gotoMenu'));
  await page.fill('#gotoPage', '3');
  await page.press('#gotoPage', 'Enter');
  check('go to page 3', await waitNum('3 / 3'));
  page.once('dialog', (d) => d.accept('Coda'));
  await page.click('#pageNum');
  await page.click('#addBookmark');
  await page.waitForTimeout(300);
  check('a bookmark is added', (await page.textContent('#bookmarkList')).includes('Coda · p. 3'), await page.textContent('#bookmarkList'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await waitNum('1 / 3');
  await page.click('#pageNum');
  await page.click('.bm-go');
  check('a bookmark takes you to its page', await waitNum('3 / 3'));

  // ---------- Trim margins, dark pages ----------
  await page.click('#viewBtn');
  await page.check('#cropToggle');
  await page.waitForTimeout(800);
  const crop = await pt(() => { const c = document.querySelector('.page canvas'); return c && c.crop; });
  check('trim margins leaves out the empty edges', crop && (crop.x0 > 0.02 || crop.y0 > 0.02), JSON.stringify(crop));
  await page.check('#darkPagesToggle');
  check('dark pages', await pt(() => document.querySelector('#sheet').classList.contains('dark-pages')));
  await page.screenshot({ path: path.join(__dirname, 'output/trim-dark.png') });
  await page.uncheck('#darkPagesToggle');
  await page.uncheck('#cropToggle');

  // ---------- Metronome ----------
  await page.click('#practiceBtn');
  await page.click('#openMetro');
  check('the metronome opens (Practice menu)', await page.isVisible('#metroBar'));
  await page.fill('#metroTempo', '84'); await page.press('#metroTempo', 'Enter');
  await page.click('#metroFaster'); await page.click('#metroSlower');
  check('the tempo can be typed', (await page.inputValue('#metroTempo')) === '84' && (await page.inputValue('#metroSlider')) === '84');
  await page.selectOption('#metroBeats', '3'); await page.selectOption('#metroUnitSel', '4');
  check('any time signature: 3/4 shows three beats', (await page.$$('#beatRow i')).length === 3);
  await pt(() => { window.__beats = 0; new MutationObserver(() => { if (document.querySelector('#beatRow i.on')) window.__beats++; }).observe(document.querySelector('#beatRow'), { attributes: true, subtree: true }); });
  await page.click('#metroStart');
  await page.waitForTimeout(2000);
  const beats = await pt(() => window.__beats);
  check('the beat flashes at the tempo (about 2.8 beats in 2 s)', beats >= 2 && beats <= 4, `${beats} beats`);
  await page.click('#metroStart');
  await page.selectOption('#metroBeats', '4');
  await page.click('#metroClose');

  // ---------- Go to a bar (needs sheet music) ----------
  await page.click('#libraryBtn');
  await page.click('.lib-piece[data-piece="aba_dc"] .lib-name');
  await waitNum('1 / 2');
  await page.setInputFiles('#scoreInput', path.join(__dirname, 'fixtures/aba_dc.mxl'));
  await page.waitForFunction(() => /Sheet music: 16 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.click('#pageNum');
  await page.fill('#gotoBar', '12');
  await page.press('#gotoBar', 'Enter');
  check('go to bar 12 shows page 2', await waitNum('2 / 2'));

  // ---------- Practice journal ----------
  await page.click('#practiceBtn');
  await page.click('#historyBtn');
  await page.click('#historyTabs [data-tab=journal]');
  await page.waitForFunction(() => /Nothing yet/.test(document.querySelector('#journalBody').textContent), null, { timeout: 5000 }).catch(() => {});
  check('the practice journal opens (History → Journal)', await page.isVisible('#journalBody') && /Nothing yet/.test(await page.textContent('#journalBody')));
  await page.keyboard.press('Escape');

  // ---------- A PDF with markings ----------
  await page.click('#markBtn');
  const u = await page.$eval('.page', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(u.x + u.w * 0.2, u.y + u.h * 0.6); await page.mouse.down();
  await page.mouse.move(u.x + u.w * 0.7, u.y + u.h * 0.7, { steps: 8 }); await page.mouse.up();
  await page.click('#markDone');
  await page.click('#helpBtn');
  const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#shareMarked')]);
  const pdfPath = path.join(out, 'marked.pdf');
  await pdfDl.saveAs(pdfPath);
  const head = fs.readFileSync(pdfPath).subarray(0, 5).toString();
  let pages = '';
  try { pages = execSync(`pdfinfo "${pdfPath}"`).toString().match(/Pages:\s+(\d+)/)[1]; } catch {}
  check('the PDF with markings is a 2-page PDF', head === '%PDF-' && (pages === '2' || pages === ''), `${pdfDl.suggestedFilename()}, ${pages || '?'} pages`);
  try {
    execSync(`pdftoppm -r 30 -f 2 -l 2 -png "${pdfPath}" "${path.join(out, 'p')}"`);
    const png = fs.readdirSync(out).find((f) => f.startsWith('p') && f.endsWith('.png'));
    if (png) fs.copyFileSync(path.join(out, png), path.join(__dirname, 'output/marked-page.png'));
  } catch {}

  // ---------- Backup and restore ----------
  await page.keyboard.press('Escape');
  await page.click('#viewBtn');
  await page.click('#openSettings');
  const [bk] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#backupSave')]);
  const bkPath = path.join(out, bk.suggestedFilename());
  await bk.saveAs(bkPath);
  check('a backup file is made', /ScoreAtlas backup .*\.scoreatlas$/.test(bk.suggestedFilename()) && fs.statSync(bkPath).size > 10000, `${bk.suggestedFilename()}, ${fs.statSync(bkPath).size} bytes`);
  // remove a piece, then restore
  await page.keyboard.press('Escape');
  await page.click('#libraryBtn');
  const rm = '.lib-piece[data-piece="scan-test"] >> text=Remove';
  await page.click(rm); await page.click('.lib-piece[data-piece="scan-test"] >> text=Tap again to remove');
  await page.waitForTimeout(500);
  check('a piece removed', (await page.$$('.lib-piece')).length === 1);
  await page.keyboard.press('Escape');
  await page.click('#viewBtn');
  await page.click('#openSettings');
  await page.setInputFiles('#restoreInput', bkPath);
  await page.waitForEvent('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.click('#libraryBtn');
  await page.waitForSelector('#library:not([hidden]) .lib-piece', { timeout: 5000 }).catch(() => {});
  const names = await page.$$eval('.lib-piece .lib-name', (els) => els.map((e) => e.textContent));
  check('restoring the backup brings the piece back', names.includes('scan-test') && names.includes('aba_dc'), names.join(', '));
  await page.click('.lib-piece[data-piece="aba_dc"] .lib-name');
  await waitNum('1 / 2');
  await page.waitForTimeout(600);
  check('... with its sheet music and markings', /Sheet music: 16 measures/.test(await page.textContent('#lessonInfo')) && (await pt(() => Object.values(window.pageTurner.marks().pages).flat().length)) >= 1);

  check('no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
  server.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
