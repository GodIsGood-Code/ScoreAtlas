// App Store screenshots (iPad 13-inch: 2064 × 2752 portrait, 2752 × 2064 landscape) into release/screenshots/.
// Only the app's own music: the Warm-ups sample (with its sheet music) and the A A B A test piece.
//   python3 tools/make_test_scores.py tests/output/scores   (makes warmups_play.wav, played to a fake microphone)
//   NODE_PATH="$(npm root -g)" node tools/make_screenshots.cjs [only-this-name]
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { serve } = require('../tests/serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'release/screenshots');
const WAV = path.join(ROOT, 'tests/output/scores/warmups_play.wav');
const only = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

async function open({ landscape = false, mic = false, theme = 'light' } = {}) {
  const args = mic ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}%noloop`] : [];
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-shot-')), {
    viewport: landscape ? { width: 1376, height: 1032 } : { width: 1032, height: 1376 }, deviceScaleFactor: 2, hasTouch: false, args,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.addInitScript((theme) => {
    try {
      localStorage.setItem('pt-test-sample', '1');
      localStorage.setItem('pt-settings', JSON.stringify({ theme }));
    } catch {}
  }, theme);
  await page.goto('http://localhost:8765/');
  await page.waitForFunction(() => /Sheet music: 64 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 60000 });
  await page.keyboard.press('Escape');
  await quiet(page);
  return { ctx, page };
}
// no passing messages in the pictures
const quiet = async (page) => { await page.waitForTimeout(600); await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.style.visibility = 'hidden'; }); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const unit = (page, i = 0) => page.$$eval('#sheet .page canvas', (cs, i) => { const r = cs[i].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, i);

const shots = {
  // 1. Following: the bar being played is highlighted and the page turns by itself; then the practice history
  async following() {
    const { ctx, page } = await open({ mic: true });
    await page.click('#followBtn');
    await page.waitForFunction(() => window.pageTurner.mode === 'follow');
    await page.waitForTimeout(21000);
    await quiet(page);
    await shot(page, '1-following');
    await page.waitForTimeout(62000); // over a page turn and well into page 2
    await page.click('#followBtn'); // Stop: the practice history opens
    await page.waitForSelector('#report:not([hidden])', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await quiet(page);
    await shot(page, '2-practice-history');
    await ctx.close();
  },
  // 3. Markings with the Pencil: dynamics, fingering, a circled bar and a text note
  async markings() {
    const { ctx, page } = await open();
    await page.click('#markBtn');
    let u = await unit(page);
    const at = (fx, fy) => [u.x + u.w * fx, u.y + u.h * fy];
    const tap = async (fx, fy) => { const [x, y] = at(fx, fy); await page.mouse.click(x, y); await page.waitForTimeout(120); };
    // stamps
    await page.click('[data-tool="stamp"]');
    for (const [k, fx, fy] of [['p', 0.145, 0.243], ['cresc.', 0.43, 0.243], ['f', 0.745, 0.243], ['fermata', 0.89, 0.338], ['ped', 0.15, 0.452], ['release', 0.27, 0.452]]) {
      const b = await page.$(`#stampRow [data-stamp="${k}"]`);
      if (!b) { console.log('no stamp', k); continue; }
      await b.click();
      await tap(fx, fy);
    }
    // fingering in blue
    await page.click('[data-tool="finger"]');
    await page.click('#inkRow [data-color="#1f5fc4"]');
    const digits = await page.$$('#digitRow button');
    for (const [d, fx, fy] of [[0, 0.155, 0.19], [1, 0.205, 0.19], [2, 0.255, 0.19], [0, 0.3, 0.19], [4, 0.36, 0.19]]) { await digits[d].click(); await tap(fx, fy); }
    // a red circle around a bar with the pen
    await page.click('[data-tool="pen"]');
    await page.click('#inkRow [data-color="#c62828"]');
    const [cx, cy] = at(0.505, 0.54), rx = u.w * 0.075, ry = u.h * 0.06;
    await page.mouse.move(cx + rx, cy);
    await page.mouse.down();
    for (let a = 0; a <= Math.PI * 2.08; a += 0.08) await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a) * (1 + 0.04 * Math.sin(3 * a)));
    await page.mouse.up();
    // a highlighted bar
    await page.click('[data-tool="highlight"]');
    const [hx, hy] = at(0.095, 0.667);
    await page.mouse.move(hx, hy); await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(hx + (u.w * 0.21 * i) / 20, hy);
    await page.mouse.up();
    // a text note
    await page.click('[data-tool="text"]');
    await tap(0.3, 0.468);
    await page.fill('#noteText', 'Listen for the left hand');
    await page.click('#noteOk');
    await page.click('[data-tool="stamp"]');
    await page.$eval('#stampRow', (r) => { r.scrollLeft = 0; });
    await page.waitForTimeout(400);
    await quiet(page);
    await shot(page, '3-markings');
    await ctx.close();
  },
  // 4. Two pages side by side when the iPad is sideways
  async twopages() {
    const { ctx, page } = await open({ landscape: true });
    await page.click('#viewBtn');
    await page.check('#twoUpToggle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await quiet(page);
    await shot(page, '4-two-pages-landscape');
    await ctx.close();
  },
  // 5. Practice tools: trouble spots from a practice history, with the metronome and tempo ladder
  async practice() {
    const { ctx, page } = await open();
    const key = await page.evaluate(() => window.pageTurner.key);
    await page.evaluate(async (key) => {
      const store = await import('./store.js');
      const day = 86400000, now = Date.now();
      const s = (d, secs, hes, tempo, missed, by) => ({ date: now - d * day, seconds: secs, plays: [[9, 3], [10, 3]], hesitations: hes, tempo, notes: { checked: 300, missed, wrong: 2, byMeasure: by } });
      await store.saveLesson(`${key}|practice`, { sessions: [
        s(3, 900, [[9, 3], [10, 2], [22, 1]], [[8, 100], [9, 72], [10, 70], [11, 98], [21, 99], [22, 80], [23, 100]], 18, [[9, 4, 8], [10, 3, 8], [22, 2, 8]]),
        s(1, 1200, [[9, 2], [10, 2], [22, 1], [37, 1]], [[8, 100], [9, 78], [10, 76], [11, 99], [21, 98], [22, 84], [36, 99], [37, 85]], 12, [[9, 3, 8], [10, 2, 8], [22, 1, 8], [37, 2, 8]]),
        s(0, 840, [[9, 1], [10, 1], [37, 1]], [[8, 100], [9, 84], [10, 82], [11, 100], [36, 100], [37, 88]], 8, [[9, 2, 8], [10, 1, 8], [37, 1, 8]]),
      ] });
    }, key);
    await page.click('#practiceBtn');
    await page.waitForTimeout(400);
    await quiet(page);
    await shot(page, '5-practice-menu');
    await page.click('#troubleBtn');
    await page.waitForSelector('.trouble-go');
    await page.waitForTimeout(500);
    await quiet(page);
    await shot(page, '6-trouble-spots');
    await page.click('.trouble-go');
    await page.waitForTimeout(1200);
    await quiet(page);
    await shot(page, '7-loop-metronome');
    await ctx.close();
  },
  // 8. Dark appearance, following
  async dark() {
    const { ctx, page } = await open({ theme: 'dark', landscape: false });
    await page.click('#viewBtn');
    await page.check('#darkPagesToggle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await quiet(page);
    await shot(page, '8-dark');
    await ctx.close();
  },
};

(async () => {
  const server = await serve(ROOT);
  for (const [name, fn] of Object.entries(shots)) {
    if (only && name !== only) continue;
    try { await fn(); console.log('made', name); } catch (e) { console.log('FAILED', name, e.message.split('\n')[0]); }
  }
  server.close();
})();
