// Checks measure finding on page images (made from the test PDFs) against what the sheet-music files say.
//   python3 -c (see tests/output/scores/pages: grayscale page images at 130 dpi, made with PyMuPDF)
//   node tests/layout-eval.js
import fs from "node:fs";
import { readScore } from "../engine/score.js";
import { findMeasures, systemCounts } from "../engine/layout.js";

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
process.exit(ok ? 0 : 1);
