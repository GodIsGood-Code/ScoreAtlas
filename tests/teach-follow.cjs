// End-to-end Teach and Follow test in a real browser with a fake microphone. Takes about 1.5 minutes.
//   1) python3 tools/synth_performances.py tests/output/short --short    (needs fluidsynth)
//   2) NODE_PATH="$(npm root -g)" node tests/teach-follow.cjs
// Teach: the microphone plays one performance and the test presses the pedal where each page ends.
// Follow: a different, faster performance plays and nobody touches the pedal. The pages must turn
// on their own, no more than 1.5 s early and 0.3 s late.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(__dirname, 'output/short');
const ORIGIN = 'http://localhost:8765';

const truth = (name) => {
  const d = JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
  const at = (b) => {
    let i = d.beats.findIndex((x) => x >= b);
    if (i <= 0) return d.times[Math.max(0, i)];
    const t = (b - d.beats[i - 1]) / (d.beats[i] - d.beats[i - 1]);
    return d.times[i - 1] + t * (d.times[i] - d.times[i - 1]);
  };
  return { turns: d.turnBeats.map(at), end: at(d.totalBeats) };
};

async function open(profile, wav) {
  const ctx = await chromium.launchPersistentContext(profile, {
    viewport: { width: 820, height: 1180 },
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  await ctx.grantPermissions(['microphone'], { origin: ORIGIN });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '1 / 4', null, { timeout: 10000 });
  return { ctx, page };
}

const waitAudio = (page, t) => page.waitForFunction((t) => window.pageTurner.audioTime >= t, t, { timeout: 120000, polling: 10 });

(async () => {
  const server = await serve(ROOT);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-profile-'));
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);

  // Teach
  const teachT = truth('short_teach');
  let { ctx, page } = await open(profile, path.join(DATA, 'short_teach.wav'));
  await page.click('#teachBtn');
  for (const t of teachT.turns) {
    await waitAudio(page, t);
    await page.keyboard.press('ArrowRight');
  }
  await waitAudio(page, teachT.end + 0.8);
  await page.click('#teachBtn'); // Done
  const info = await page.textContent('#lessonInfo');
  check('teaching learned 3 page turns', /3 page turns/.test(info), info);
  check('Follow is ready after teaching', !(await page.isDisabled('#followBtn')));
  await ctx.close();

  // Follow, in a fresh browser session: the lesson must have been saved on the device
  const followT = truth('short_follow');
  ({ ctx, page } = await open(profile, path.join(DATA, 'short_follow.wav')));
  const kept = await page.waitForFunction(() => !document.querySelector('#followBtn').disabled, null, { timeout: 8000 }).then(() => true, () => false);
  check('the lesson is still there after reopening', kept);
  await page.click('#followBtn');
  await waitAudio(page, followT.turns[0] + 0.4);
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'output/following.png') });
  await waitAudio(page, followT.end + 1);
  const turns = await page.evaluate(() => window.pageTurner.turns);
  const progress = await page.$eval('#progressFill', (e) => parseFloat(e.style.width));
  for (const [i, should] of followT.turns.entries()) {
    const got = turns.find((t) => t.page === i + 2 && t.how === 'auto');
    const err = got ? got.time - should : null;
    check(`turned to page ${i + 2} by itself`, err !== null && err >= -1.5 && err <= 0.3, err === null ? 'never turned' : `${err >= 0 ? '+' : ''}${err.toFixed(2)} s from the right moment`);
  }
  check('no extra turns', turns.length === followT.turns.length, `${turns.length} turns`);
  check('progress reached the end', progress > 95, `${progress}%`);
  check('ends on the last page', (await page.evaluate(() => window.pageTurner.page)) === 4);
  await ctx.close();
  server.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
