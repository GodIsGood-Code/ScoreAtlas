// End-to-end Teach and Follow test in a real browser with a fake microphone. Takes about 2.5 minutes.
//   1) python3 tools/synth_performances.py tests/output/short --short    (needs fluidsynth)
//   2) NODE_PATH="$(npm root -g)" node tests/teach-follow.cjs
// Teach: the microphone plays one performance and the test presses the pedal where each page ends.
// Follow: a different, faster performance plays and nobody touches the pedal. The pages must turn
// on their own, no more than 1.5 s early and 0.3 s late.
// Practice: flip to page 3, play from the middle of it into page 4, pause, then go back to page 2 and
// play into page 3. The app must turn to page 4, jump back to page 2, then turn to page 3.
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
  await page.click('#teachDone');
  const info = await page.textContent('#lessonInfo');
  check('teaching learned 3 page turns', /3 page turns/.test(info), info);
  check('Follow is ready after teaching', (await page.getAttribute('#followBtn', 'data-ready')) === 'true');
  await ctx.close();

  // Follow, in a fresh browser session: the lesson must have been saved on the device
  const followT = truth('short_follow');
  ({ ctx, page } = await open(profile, path.join(DATA, 'short_follow.wav')));
  const kept = await page.waitForFunction(() => document.querySelector('#followBtn').dataset.ready === 'true', null, { timeout: 8000 }).then(() => true, () => false);
  check('the lesson is still there after reopening', kept);
  await page.click('#followBtn');
  // the test machine's fake microphone sometimes fails to start in a second browser session: try once more
  await page.waitForTimeout(800);
  if ((await page.evaluate(() => window.pageTurner.mode)) !== 'follow') {
    console.log('note: Follow did not start the first time:', await page.evaluate(() => document.querySelector('#earNote').textContent || '(no microphone message)'));
    await page.keyboard.press('Escape');
    await page.click('#followBtn');
  }
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

  // Practice
  const P = JSON.parse(fs.readFileSync(path.join(DATA, 'short_practice.json'), 'utf8'));
  const track = P.track;
  const reaches = (beat, after) => track.find(([t, b]) => t >= after && b >= beat)[0];
  const restart = track.find(([t, b], i) => i > 0 && b >= 0 && track[i - 1][1] < 0 && t > 5)[0];
  ({ ctx, page } = await open(profile, path.join(DATA, 'short_practice.wav')));
  await page.waitForFunction(() => document.querySelector('#followBtn').dataset.ready === 'true', null, { timeout: 8000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#pageNum').value === '3 / 4');
  await page.click('#followBtn');
  await waitAudio(page, track[track.length - 1][0] - 0.5);
  const log = await page.evaluate(() => window.pageTurner.turns);
  const timing = (got, should) => (got ? `${got.time - should >= 0 ? '+' : ''}${(got.time - should).toFixed(2)} s from the right moment` : 'never');
  const to4 = log.find((t) => t.page === 4 && t.how === 'auto');
  const should4 = reaches(47, 0);
  check('practice: started mid-page and turned to page 4', to4 && to4.time - should4 >= -1.5 && to4.time - should4 <= 0.3, timing(to4, should4));
  const back2 = log.find((t) => t.page === 2 && t.how === 'jump' && t.time >= restart);
  check('practice: went back to page 2 after the restart', back2 && back2.time - restart <= 4, back2 ? `${(back2.time - restart).toFixed(1)} s after restarting` : 'never');
  const to3 = log.find((t) => t.page === 3 && t.how === 'auto' && t.time > restart);
  const should3 = reaches(31, restart);
  check('practice: then turned to page 3 again', to3 && to3.time - should3 >= -1.5 && to3.time - should3 <= 0.3, timing(to3, should3));
  check('practice: no other page changes', log.length === 3, log.map((t) => `${t.time.toFixed(1)}s p${t.page} ${t.how}`).join(', '));
  await ctx.close();
  server.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
