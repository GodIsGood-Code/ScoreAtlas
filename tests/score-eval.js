// Page turning from sheet music, with no teaching: follow performances using only the written score.
//   1) python3 tools/synth_performances.py tests/output/perf     (A A B A performances)
//      python3 tools/make_test_scores.py tests/output/scores     (scores, PDFs, sample-score performance)
//      Audiveris -batch -export -output tests/output/scores/omr tests/output/scores/{aba_repeat,aba_dc}.pdf
//      (and samples/warm-ups.pdf), to test what Audiveris reads from the PDFs
//   2) node tests/score-eval.js
import fs from "node:fs";
import path from "node:path";
import { featuresOf } from "./engine-eval.js";
import { readScore, playOrder, keepParts, withPageStarts } from "../engine/score.js";
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

// Each expected turn: the new page should show between 2.6 s before and 0.3 s after the moment that page's music starts
// (sheet-music turns come about a second early on purpose: the eyes read ahead of the hands)
function judge(changes, expected) {
  const out = expected.map(({ t, page }) => {
    const hit = changes.find((c) => c.page === page && c.t >= t - 2.6 && c.t <= t + 0.3);
    return hit ? hit.t - t : null;
  });
  const extra = changes.filter((c) => !expected.some(({ t, page }) => c.page === page && c.t >= t - 2.6 && c.t <= t + 0.3));
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

// 3) Bar numbers: sheet music whose own pages don't match the pianist's PDF. The pianist types the first bar of each
// page (from page 2), and the page turns come from those. Here: page 2 starts at bar 5 and page 3 at bar 13, so the
// A A B A performance turns to page 2 in the middle of A, back to page 1 for the repeat, to 2 again, and to 3 in B.
{
  const file = "aba_repeat.musicxml";
  if (fs.existsSync(path.join(SCORES, file))) {
    const score = withPageStarts(readScore(fs.readFileSync(path.join(SCORES, file))), [5, 13]);
    const lesson = { version: 2, sections: [scoreSection(score)] };
    for (const live of ["faster", "slower", "pause"]) {
      const T = JSON.parse(fs.readFileSync(path.join(PERF, live + ".json"), "utf8"));
      const expected = [[16, 2], [32, 1], [48, 2], [80, 3]].map(([b, page]) => ({ t: interp(T.beats, T.times, b), page }));
      const { errs, extra } = judge(follow(lesson, path.join(PERF, live + ".wav")), expected);
      check(`bar numbers 5, 13 / ${live}: page turns on time`, errs.every((e) => e !== null) && extra.length === 0,
        `${fmt(errs)}${extra.length ? "; extra: " + extra.map((c) => `${c.t.toFixed(1)}s→p${c.page} ${c.why}`).join(" ") : ""}`);
    }
  }
}

// 4) Solo part: a duet version of the piece. Part 2 (the "orchestra") holds chords under the piano throughout and
// has 8 bars on its own between B and the last A, where the piano rests. The pianist practices alone, so the
// performance goes from B straight on to A. Keeping only the piano part, the turns must still come on time.
{
  const file = "aba_repeat.musicxml";
  if (fs.existsSync(path.join(SCORES, file))) {
    const base = readScore(fs.readFileSync(path.join(SCORES, file)));
    const measures = base.measures.map((m) => ({ ...m, notes: [...m.notes] }));
    for (const m of measures) {
      const low = Math.min(...m.notes.map((n) => n.midi));
      if (Number.isFinite(low)) for (const d of [12, 16, 19]) m.notes.push({ midi: low + d, start: 0, length: m.quarters, part: 1 });
    }
    // the orchestra's 8 bars alone: B's music a fourth higher, at the top of page 3 (before the last A)
    const tutti = measures.slice(8, 16).map((m, k) => ({ ...m, number: `T${k + 1}`, page: 3, system: k < 4 ? 1 : 2,
      notes: m.notes.filter((n) => n.part === 0).map((n) => ({ ...n, midi: n.midi + 5, part: 1 })) }));
    measures.splice(16, 0, ...tutti);
    measures.forEach((m, i) => m.notes.forEach((n) => { n.measure = i; }));
    const duo = { ...base, measures, parts: [...base.parts, { id: "P2", name: "Orchestra", staves: 1 }] };
    const order = playOrder(duo);
    check("duet: played order is A A B, 8 bars of orchestra, A (40 measures)", order.length === 40, `${order.length}`);
    for (const [label, parts] of [["solo part only", [0]], ["all parts (for comparison)", null]]) {
      const lesson = { version: 2, sections: [scoreSection(keepParts(duo, parts))] };
      let ok = 0, total = 0;
      const notes = [];
      for (const live of ["faster", "slower", "voicing"]) {
        const T = JSON.parse(fs.readFileSync(path.join(PERF, live + ".json"), "utf8"));
        const expected = [[64, 2], [96, 3]].map(([b, page]) => ({ t: interp(T.beats, T.times, b), page }));
        const { errs, extra } = judge(follow(lesson, path.join(PERF, live + ".wav")), expected);
        total++;
        if (errs.every((e) => e !== null) && extra.length === 0) ok++;
        notes.push(`${live}: ${fmt(errs)}${extra.length ? " extra " + extra.map((c) => `${c.t.toFixed(1)}s→p${c.page}`).join(" ") : ""}`);
      }
      if (parts) check(`duet, ${label}: page turns on time`, ok === total, notes.join("; "));
      else results.push(`INFO  duet, ${label}: ${ok}/${total} on time (${notes.join("; ")})`);
    }
  }
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
