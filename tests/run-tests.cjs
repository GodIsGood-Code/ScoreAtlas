// End-to-end checks for Page Turner in headless Chromium.
// Run from the repo root:  NODE_PATH="$(npm root -g)" node tests/run-tests.cjs
// Needs Playwright with Chromium installed. Starts its own small local web server for the repo folder.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { serve } = require('./serve.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const ORIGIN = 'http://localhost:8765';

// A C major chord (C4 E4 G4) with piano-like overtones and decay, struck once a second.
function writeChordWav(file) {
  const sr = 48000, seconds = 4, n = sr * seconds;
  const data = Buffer.alloc(44 + n * 2);
  const freqs = [261.63, 329.63, 392.0];
  for (let i = 0; i < n; i++) {
    const t = (i % sr) / sr;
    let v = 0;
    for (const f of freqs) for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * (i / sr)) * (0.5 / h) * Math.exp(-t * (1.5 + h));
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 6000))), 44 + i * 2);
  }
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(file, data);
}

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(ROOT);
  const wav = path.join(os.tmpdir(), 'pt-c-major.wav');
  writeChordWav(wav);
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  await ctx.grantPermissions(['microphone'], { origin: ORIGIN });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());

  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/ERR_FAILED|willReadFrequently/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

  const num = () => page.$eval('#pageNum', (e) => e.value);
  const waitNum = (v) => page.waitForFunction((v) => document.querySelector('#pageNum').value === v, v, { timeout: 8000 }).then(() => true, () => false);
  const ink = () => page.$eval('#sheet canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 128) dark++;
    return dark / (d.length / 16);
  });

  await page.goto(`${ORIGIN}/`);
  check('sample opens on page 1', await waitNum('1 / 4'), await num());
  await page.waitForSelector('#sheet canvas');
  check('page 1 drawn with ink', (await ink()) > 0.005);
  check('file name shows sample', (await page.textContent('#fileName')) === 'Sample: Warm-ups');
  check('Follow waits until the piece is taught', (await page.getAttribute('#followBtn', 'data-ready')) === 'false');
  check('Teach is ready', !(await page.isDisabled('#teachBtn')));
  check('says the piece is not taught yet', /hasn't been taught/.test(await page.textContent('#lessonInfo')));

  // Pedal keys
  await page.keyboard.press('ArrowRight');
  check('Right arrow -> page 2', await waitNum('2 / 4'));
  await page.keyboard.press('PageDown');
  check('Page Down -> page 3', await waitNum('3 / 4'));
  await page.keyboard.press('ArrowUp');
  check('Up arrow -> page 2', await waitNum('2 / 4'));
  await page.keyboard.press('Space');
  check('Space -> page 3', await waitNum('3 / 4'));
  await page.keyboard.press('b');
  await page.waitForTimeout(150);
  check('unknown key does not turn', (await num()) === '3 / 4');
  check('keys received list', (await page.textContent('#keysSeen')) === 'Right arrow, Page Down, Up arrow, Space, B', await page.textContent('#keysSeen'));
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowLeft'); await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(200);
  check('held pedal turns once', (await num()) === '2 / 4', await num());

  // Taps and swipes
  await page.click('#cardClose'); // the test steps card covers part of the page
  const box = await page.$eval('#stand', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.15, box.y + box.h * 0.5);
  check('tap left -> page 1', await waitNum('1 / 4'));
  await page.mouse.click(box.x + box.w * 0.8, box.y + box.h * 0.3);
  check('tap right -> page 2', await waitNum('2 / 4'));
  await page.mouse.move(box.x + box.w * 0.45, box.y + box.h * 0.4);
  await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.1, box.y + box.h * 0.42, { steps: 6 }); await page.mouse.up();
  check('swipe left -> page 3', await waitNum('3 / 4'));
  await page.keyboard.press('ArrowRight'); await waitNum('4 / 4');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
  check('past the end shows "Last page"', (await page.isVisible('#toast')) && (await page.textContent('#toast')) === 'Last page');
  // Microphone check (Help → Check the microphone and the pedal) with the fake microphone playing C major
  await page.click('#viewBtn');
  await page.click('#openHelp');
  await page.click('#micCheck summary');
  await page.click('#micBtn');
  await page.waitForFunction(() => window.pageTurner && window.pageTurner.audioTime > 0.5, null, { timeout: 5000 }).catch(() => {});
  check('Check microphone starts listening', (await page.getAttribute('#micBtn', 'aria-pressed')) === 'true' && (await page.evaluate(() => window.pageTurner.audioTime)) > 0.5, await page.textContent('#earNote').catch(() => ''));
  let heard = '';
  for (let i = 0; i < 40 && !/^C · E · G$/.test(heard); i++) {
    await page.waitForTimeout(100);
    heard = await page.textContent('#earHeard');
  }
  check('hears C · E · G from a C major chord', heard === 'C · E · G', heard);
  check('pedal still works while listening', (await page.keyboard.press('ArrowLeft'), await waitNum('3 / 4')));
  await page.screenshot({ path: path.join(OUT, 'listening.png') });
  await page.click('#micBtn');
  check('Stop turns the microphone off', (await page.getAttribute('#micBtn', 'aria-pressed')) === 'false' && (await page.textContent('#earHeard')) === 'the microphone is off');

  // Teach a short section from page 2, then forget it
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await waitNum('1 / 4');
  await page.keyboard.press('ArrowRight');
  await waitNum('2 / 4');
  await page.keyboard.press('Escape'); // close Help
  if (await page.isHidden('#card')) await page.click('#helpBtn');
  await page.click('#teachBtn');
  check('teaching starts from the page on screen', /Teaching from page 2/.test(await page.textContent('#modeText')), await page.textContent('#modeText'));
  await page.waitForFunction(() => window.pageTurner.audioTime > 0, null, { timeout: 5000 }).catch(() => {});
  const tStart = await page.evaluate(() => window.pageTurner.audioTime);
  await page.waitForFunction((t) => window.pageTurner.audioTime > t + 3, tStart, { timeout: 8000 }).catch(() => {});
  await page.click('#teachDone');
  if (await page.isHidden('#card')) await page.click('#helpBtn');
  check('teaching a section is stored', /Taught: 1 section/.test(await page.textContent('#lessonInfo')), await page.textContent('#lessonInfo'));
  check('Follow is ready after teaching a section', (await page.getAttribute('#followBtn', 'data-ready')) === 'true');
  await page.click('#forgetBtn');
  check('Forget asks for a second tap', (await page.textContent('#forgetBtn')) === 'Tap again to forget');
  await page.click('#forgetBtn');
  check('Forget clears what was learned', /hasn't been taught/.test(await page.textContent('#lessonInfo')) && (await page.getAttribute('#followBtn', 'data-ready')) === 'false');

  // Scanned (image-only) PDF and a broken file
  await page.setInputFiles('#fileInput', path.join(__dirname, 'fixtures/scan-test.pdf'));
  check('scan opens on page 1 of 3', await waitNum('1 / 3'), await num());
  await page.waitForFunction(() => document.querySelector('#status').hidden);
  check('scan page drawn with ink', (await ink()) > 0.005);
  const bad = path.join(os.tmpdir(), 'not-a-pdf.pdf');
  fs.writeFileSync(bad, 'hello, I am not a PDF');
  await page.setInputFiles('#fileInput', bad);
  await page.waitForFunction(() => document.querySelector('#status').dataset.kind === 'error', null, { timeout: 8000 }).catch(() => {});
  check('bad file shows a clear error', /Couldn't open not-a-pdf\.pdf/.test(await page.textContent('#statusText')));
  check('previous PDF still open', (await num()) === '1 / 3');
  await page.reload();
  check('reopens the last PDF after a reload', (await waitNum('1 / 3')) && (await page.textContent('#fileName')) === 'scan-test', await page.textContent('#fileName'));
  await page.waitForSelector('#sheet canvas', { timeout: 8000 }).catch(() => {});

  // Rotation and phone width
  const before = await page.$eval('#sheet canvas', (c) => c.style.height);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForFunction((b) => document.querySelector('#sheet canvas')?.style.height !== b, before, { timeout: 5000 }).catch(() => {});
  check('redraws on rotation', before !== (await page.$eval('#sheet canvas', (c) => c.style.height)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no sideways scrolling at phone width', ov <= 0, `${ov}px`);

  console.log(results.join('\n'));
  console.log('\nconsole:', logs.length ? '\n' + [...new Set(logs)].join('\n') : 'clean');
  await browser.close();
  server.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
