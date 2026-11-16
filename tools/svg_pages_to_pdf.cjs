// Prints a folder of SVG pages (page1.svg, page2.svg, ...) to a Letter-size PDF, one page each.
// Usage: node tools/svg_pages_to_pdf.cjs SVG_DIR OUT.pdf   (needs Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [dir, out] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /^page\d+\.svg$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: Letter; margin: 0 }
body { margin: 0 }
.pg { width: 8.5in; height: 11in; page-break-after: always; display: flex; align-items: flex-start; justify-content: center; overflow: hidden }
.pg svg { width: 100%; height: auto }
</style></head><body>${files.map((f) => `<div class="pg">${fs.readFileSync(path.join(dir, f), 'utf8')}</div>`).join('')}</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.pdf({ path: out, format: 'Letter', printBackground: true });
  await b.close();
})();
