// Checks measure finding on page images (made from the test PDFs) against what the sheet-music files say.
//   python3 -c (see tests/output/scores/pages: grayscale page images at 130 dpi, made with PyMuPDF)
//   node tests/layout-eval.js
import fs from "node:fs";
import { readScore } from "../engine/score.js";
import { findMeasures, findMeasuresByCount, systemCounts } from "../engine/layout.js";

const D = "tests/output/scores";
let ok = true;
for (const [name, mxl] of [["aba_repeat", "omr/aba_repeat.mxl"], ["aba_dc", "omr/aba_dc.mxl"], ["warm-ups", "omr/warm-ups.mxl"]]) {
  const score = readScore(fs.readFileSync(`${D}/${mxl}`));
  const counts = systemCounts(score);
  for (const page of Object.keys(counts).map(Number)) {
    const f = `${D}/pages/${name}-${page}`;
    if (!fs.existsSync(f + ".raw")) continue;
    const [w, h] = fs.readFileSync(f + ".size", "utf8").split(" ").map(Number);
    const boxes = findMeasures(fs.readFileSync(f + ".raw"), w, h, counts[page]);
    const exact = boxes ? boxes.filter((b) => b.exact).length : 0;
    const total = counts[page].reduce((a, b) => a + b, 0);
    console.log(`${name} page ${page}: systems ${counts[page].length} (${counts[page].join("+")} measures) -> ${boxes ? `${boxes.length} boxes, ${exact} placed on barlines` : "not found"}`);
    if (!boxes || boxes.length !== total) ok = false;
  }
}
// Bar-number mode: only the number of measures on each page is known (from the pianist's bar numbers); the
// systems and barlines are found on the image. Expected: measures per system, read off the pages by eye.
const truth = {
  "aba_repeat-1": [4, 4], "aba_repeat-2": [4, 4], "aba_repeat-3": [4, 4], "aba_dc-1": [4, 4], "aba_dc-2": [4, 4],
  "warm-ups-1": [4, 5, 5, 2], "warm-ups-2": [4, 5, 5, 2], "warm-ups-3": [5, 5, 5, 1], "warm-ups-4": [7, 7, 2],
};
for (const [name, want] of Object.entries(truth)) {
  const f = `${D}/pages/${name}`;
  if (!fs.existsSync(f + ".raw")) continue;
  const [w, h] = fs.readFileSync(f + ".size", "utf8").split(" ").map(Number);
  const total = want.reduce((a, b) => a + b, 0);
  const boxes = findMeasuresByCount(fs.readFileSync(f + ".raw"), w, h, total) || [];
  const rows = [];
  for (const b of boxes) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - b.y0) < 0.01) last.n++;
    else rows.push({ y: b.y0, n: 1 });
  }
  const got = rows.map((r) => r.n);
  const exact = boxes.filter((b) => b.exact).length;
  const good = got.join() === want.join() && exact === total;
  console.log(`bar-number mode, ${name}: ${got.join("+") || "not found"} measures per system (expected ${want.join("+")}), ${exact} on barlines ${good ? "PASS" : "FAIL"}`);
  if (!good) ok = false;
}
process.exit(ok ? 0 : 1);
