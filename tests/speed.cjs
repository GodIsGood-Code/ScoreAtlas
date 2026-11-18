// How fast the app feels on a slower iPad: the same steps with Chromium's CPU slowed down (4x and 6x by default) as a
// stand-in, since there's no old iPad here. Times the first launch (the sample with its sheet music), a page turn,
// adding sheet music, Follow (long main-thread tasks, whether the listening keeps up) and Hear the music.
//   NODE_PATH="$(npm root -g)" node tests/speed.cjs [rates, e.g. 1,4,6]
// Needs tests/output/scores/warmups_play.wav (python3 tools/make_test_scores.py tests/output/scores).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const WAV = path.join(__dirname, 'output/scores/warmups_play.wav');
const rates = (process.argv[2] || '1,4,6').split(',').map(Number);

async function run(rate) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-speed-')), {
    viewport: { width: 1032, height: 1376 },
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}%noloop`],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.addInitScript(() => {
    try { localStorage.setItem('pt-test-sample', '1'); } catch {}
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  });
  const out = {};
  let t0 = Date.now();
  await page.goto('http://localhost:8765/');
  await page.waitForFunction(() => /\d+ \/ \d+/.test(document.querySelector('#pageNum').value) && document.querySelector('#sheet .page canvas'), null, { timeout: 120000 });
  out.firstPage = Date.now() - t0;
  await page.waitForFunction(() => /Sheet music: 64 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 300000 });
  out.sampleReady = Date.now() - t0;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // a page turn: until the new page's picture is drawn
  const turn = async () => page.evaluate(() => new Promise((resolve) => {
    const t = performance.now(), before = document.querySelector('#pageNum').value;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const wait = () => (document.querySelector('#pageNum').value !== before ? requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t))) : requestAnimationFrame(wait));
    wait();
  }));
  out.turn = Math.round(await turn());
  await page.waitForTimeout(800);
  out.turn2 = Math.round(await turn());
  await page.keyboard.press('Home').catch(() => {});
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  await page.waitForFunction(() => document.querySelector('#pageNum').value.startsWith('1 /'));
  await page.waitForTimeout(800);

  // Follow for 45 s of the recording (the first turn comes at about 38 s): does the listening keep up, and how long is the main thread busy?
  await page.evaluate(() => { window.__long = []; });
  t0 = Date.now();
  await page.click('#followBtn');
  await page.waitForFunction(() => window.pageTurner.mode === 'follow', null, { timeout: 60000 });
  out.followStart = Date.now() - t0;
  const a0 = await page.evaluate(() => window.pageTurner.audioTime), w0 = Date.now();
  await page.waitForTimeout(45000);
  const a1 = await page.evaluate(() => window.pageTurner.audioTime), w1 = Date.now();
  out.listenKeepsUp = +((a1 - a0) / ((w1 - w0) / 1000)).toFixed(2); // 1.00 = every frame handled in time
  const long = await page.evaluate(() => window.__long);
  out.followLongTasks = long.length;
  out.followLongest = Math.round(Math.max(0, ...long.map((l) => l.d)));
  out.followBusyShare = +(long.reduce((s, l) => s + l.d, 0) / (w1 - w0)).toFixed(3);
  out.turnsWhileFollowing = (await page.evaluate(() => window.pageTurner.turns.length));
  await page.click('#followBtn'); // stop
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');

  // Hear the music: until it starts playing
  t0 = Date.now();
  if (await page.isHidden('#practiceMenu')) await page.click('#practiceBtn');
  await page.click('#hearBtn');
  await page.waitForFunction(() => window.pageTurner.hearing, null, { timeout: 120000 });
  out.hearStart = Date.now() - t0;
  await page.click('#hearClose');

  // adding a PDF with its sheet music (the A A B A piece)
  t0 = Date.now();
  await page.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/aba_dc.pdf'), path.join(__dirname, 'fixtures/aba_dc.mxl')]);
  await page.waitForFunction(() => /Sheet music: 16 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 300000 });
  out.addWithSheetMusic = Date.now() - t0;
  out.errors = errors.length;
  await ctx.close();
  return out;
}

(async () => {
  const server = await serve(ROOT);
  for (const r of rates) console.log(`CPU ${r}x slower:`, JSON.stringify(await run(r)));
  server.close();
})();
