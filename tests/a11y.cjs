// Accessibility check with axe-core (WCAG 2.1 A and AA rules) on the main screens, in light and dark appearance.
//   npm pack axe-core@4.10.3 somewhere, unpack it, then
//   AXE=path/to/axe.min.js NODE_PATH="$(npm root -g)" node tests/a11y.cjs
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const AXE = fs.readFileSync(process.env.AXE, 'utf8');

(async () => {
  const server = await serve(ROOT);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-a11y-')), { viewport: { width: 820, height: 1180 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://localhost:8765/');
  await page.waitForFunction(() => /\d+ \/ \d+/.test(document.querySelector('#pageNum').value));
  await page.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/aba_dc.pdf'), path.join(__dirname, 'fixtures/aba_dc.mxl')]);
  await page.waitForFunction(() => /Sheet music: 16 measures/.test(document.querySelector('#lessonInfo').textContent), null, { timeout: 30000 });
  const screens = {
    'Piece panel': async () => { if (await page.isHidden('#card')) await page.click('#helpBtn'); },
    'Practice menu': async () => { await page.keyboard.press('Escape'); await page.click('#practiceBtn'); },
    'View menu': async () => { await page.keyboard.press('Escape'); await page.click('#viewBtn'); },
    'Settings': async () => { await page.click('#openSettings'); await page.click('.licenses summary'); },
    'Help': async () => { await page.keyboard.press('Escape'); await page.click('#viewBtn'); await page.click('#openHelp'); await page.click('#micCheck summary'); },
    'History': async () => { await page.keyboard.press('Escape'); await page.click('#practiceBtn'); await page.click('#historyBtn'); },
    'Library': async () => { await page.keyboard.press('Escape'); await page.click('#libraryBtn'); await page.waitForSelector('.lib-piece'); },
    'Mark toolbar (stamps)': async () => { await page.keyboard.press('Escape'); await page.click('#markBtn'); await page.click('[data-tool="stamp"]'); },
    'Metronome': async () => { await page.click('#markDone'); await page.click('#practiceBtn'); await page.click('#openMetro'); },
    'Edit pages': async () => { await page.click('#metroClose'); await page.click('#helpBtn').catch(() => {}); if (await page.isHidden('#card')) await page.click('#helpBtn'); await page.click('#editPagesBtn'); await page.waitForTimeout(800); },
  };
  let total = 0;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    for (const [name, open] of Object.entries(screens)) {
      await open();
      await page.waitForTimeout(250);
      const res = await page.evaluate(async (src) => {
        if (!window.axe) eval(src);
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + (n.any[0] ? ` (${n.any[0].message.slice(0, 120)})` : '')) , count: v.nodes.length }));
      }, AXE);
      total += res.length;
      console.log(`${theme} · ${name}: ${res.length ? '' : 'no problems'}`);
      for (const v of res) console.log(`   ${v.impact} ${v.id} ×${v.count}: ${v.help}\n      ${v.nodes.join('\n      ')}`);
    }
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    if (await page.isVisible('#pagesPanel')) await page.click('.pe-close');
  }
  console.log(total ? `${total} problem groups` : 'all screens pass');
  await ctx.close(); server.close();
  process.exit(total ? 1 : 0);
})();
