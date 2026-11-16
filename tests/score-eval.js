// Page turning from sheet music, with no teaching: follow performances using only the written score.
//   1) python3 tools/synth_performances.py tests/output/perf     (A A B A performances)
//      python3 tools/make_test_scores.py tests/output/scores     (scores, PDFs, sample-score performance)
//      Audiveris -batch -export -output tests/output/scores/omr tests/output/scores/{aba_repeat,aba_dc}.pdf
//      (and samples/warm-ups.pdf), to test what Audiveris reads from the PDFs
//   2) node tests/score-eval.js
import fs from "node:fs";
import path from "node:path";
import { featuresOf } from "./engine-eval.js";
import { readScore, playOrder } from "../engine/score.js";
import { scoreSection } from "../engine/scorelesson.js";
import { Follower } from "../engine/follower.js";

const PERF = process.env.PERF_DIR || "tests/output/perf";
const SCORES = process.env.SCORES_DIR || "tests/output/scores";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  let i = xs.findIndex((v) => v >= x);
  if (i < 0) return ys[ys.length - 1];
  return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
};
const cache = {};
const frames = (file) => (cache[file] ||= featuresOf(file));
const lessons = {};
function lessonFor(file) {
  if (!lessons[file]) {
    const t0 = Date.now();
    const score = readScore(fs.readFileSync(path.join(SCORES, file)));
    lessons[file] = { lesson: { version: 2, sections: [scoreSection(score)] }, score, ms: Date.now() - t0 };
  }
  return lessons[file];
}

// Follow one performance; return the page changes [{ t, page, why }]
function follow(lesson, wav, startPage = 1) {
  const changes = [];
  let now = 0;
  const fol = new Follower(lesson, { page: startPage, onTurn: (page, why) => changes.push({ t: now, page, why }) });
  for (const f of frames(wav)) { now = f.time; fol.push(f); }
  return changes;
}

// Each expected turn: the new page should show between 2 s before and 0.3 s after the moment that page's music starts
function judge(changes, expected) {
  const out = expected.map(({ t, page }) => {
    const hit = changes.find((c) => c.page === page && c.t >= t - 2 && c.t <= t + 0.3);
    return hit ? hit.t - t : null;
  });
  const extra = changes.filter((c) => !expected.some(({ t, page }) => c.page === page && c.t >= t - 2 && c.t <= t + 0.3));
  return { errs: out, extra };
}
const fmt = (errs) => errs.map((e) => (e === null ? "missed" : `${e >= 0 ? "+" : ""}${e.toFixed(2)}s`)).join(", ");

// 1) The A A B A performances with the piece written with repeats (pages A, B, A) and with D.C. al Fine (A, B)
const aaba = ["faster", "slower", "mistakes", "voicing", "no_pedal", "pause"];
for (const [file, pagesAfter] of [["aba_repeat.musicxml", [2, 3]], ["omr/aba_repeat.mxl", [2, 3]], ["aba_dc.musicxml", [2, 1]], ["omr/aba_dc.mxl", [2, 1]]]) {
  if (!fs.existsSync(path.join(SCORES, file))) { check(`${file}: present`, false, "make it first (see the top of this file)"); continue; }
  const { lesson, score, ms } = lessonFor(file);
  const order = playOrder(score);
  check(`${file}: played order is A A B A (32 measures)`, order.length === 32, `${order.length} measures; learned in ${ms} ms`);
  for (const live of aaba) {
    const T = JSON.parse(fs.readFileSync(path.join(PERF, live + ".json"), "utf8"));
    const expected = [64, 96].map((b, i) => ({ t: interp(T.beats, T.times, b), page: pagesAfter[i] }));
    const { errs, extra } = judge(follow(lesson, path.join(PERF, live + ".wav")), expected);
    check(`${file} / ${live}: page turns on time`, errs.every((e) => e !== null) && extra.length === 0,
      `${fmt(errs)}${extra.length ? "; extra: " + extra.map((c) => `${c.t.toFixed(1)}s→p${c.page} ${c.why}`).join(" ") : ""}`);
  }
}

// 2) The sample score: a performance of it, followed with what Audiveris read from its PDF
{
  const file = "omr/warm-ups.mxl";
  if (fs.existsSync(path.join(SCORES, file))) {
    const { lesson, score, ms } = lessonFor(file);
    const P = JSON.parse(fs.readFileSync(path.join(SCORES, "warmups_play.json"), "utf8"));
    const expected = P.pageStarts.slice(1).map((t, i) => ({ t, page: i + 2 }));
    const { errs, extra } = judge(follow(lesson, path.join(SCORES, "warmups_play.wav")), expected);
    check(`sample score read by Audiveris (${score.measures.length} of 64 measures found): page turns`, errs.filter((e) => e !== null).length >= 2,
      `${fmt(errs)}${extra.length ? "; extra: " + extra.map((c) => `${c.t.toFixed(1)}s→p${c.page} ${c.why}`).join(" ") : ""}; learned in ${ms} ms`);
  }
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
