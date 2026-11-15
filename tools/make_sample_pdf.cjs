// Lays out the Verovio SVG pages as a Letter-size PDF (the sample score),
// plus JPEG snapshots of each page for a "scanned" test PDF.
// Usage: node tools/make_sample_pdf.js OUT_DIR (after make_sample.py). Writes OUT_DIR/../sample.pdf
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const info = [
  ['Scales in sharp keys', 'Two octaves, hands together'],
  ['Scales in flat keys', 'Two octaves, hands together'],
  ['Broken chords', 'Root position, two octaves'],
  ['Cadences', 'I – IV – V – I in eight keys'],
];
const pages = info.map(([t, s], i) => {
  const svg = fs.readFileSync(path.join(dir, `page${i + 1}.svg`), 'utf8');
  return `<section class="pg">
    <header>${i === 0 ? '<div class="work">Warm-ups</div>' : ''}<h1>${i + 1}. ${t}</h1><div class="sub">${s}</div></header>
    <div class="music">${svg}</div>
    <footer>Sample score · ${i + 1}</footer></section>`;
}).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: Letter; margin: 0 }
body { margin: 0; font-family: "DejaVu Serif", "Liberation Serif", serif; color: #111 }
.pg { width: 8.5in; height: 11in; box-sizing: border-box; padding: 0.6in 0.55in 0.5in; position: relative; page-break-after: always; display: flex; flex-direction: column }
header { text-align: center; margin-bottom: 0.25in }
.work { font-size: 26pt; letter-spacing: 0.02em; margin-bottom: 0.18in }
h1 { font-size: 15pt; font-weight: normal; margin: 0 }
.sub { font-size: 10.5pt; font-style: italic; margin-top: 4pt; color: #333 }
.music svg { width: 100%; height: auto; display: block }
footer { position: absolute; bottom: 0.4in; left: 0; right: 0; text-align: center; font-size: 9pt; color: #555 }
</style></head><body>${pages}</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.pdf({ path: path.join(dir, '..', 'sample.pdf'), format: 'Letter', printBackground: true });
  await p.setViewportSize({ width: 816, height: 1056 });
  const els = await p.$$('section.pg');
  for (let i = 0; i < els.length; i++) {
    const buf = await els[i].screenshot({ type: 'jpeg', quality: 70 });
    fs.writeFileSync(path.join(dir, `scan${i + 1}.jpg`), buf);
  }
  await b.close();
})();
