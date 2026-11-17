// Wrong-note detection against a synthetic performance with known mistakes (dropped notes and wrong notes).
//   1) the notes Basic Pitch hears: tools/basic_pitch_node.mjs tests/output/perf/mistakes.wav (writes mistakes.bp.json)
//   2) node tests/notecheck-eval.js [perf name, default mistakes] [--follow] [--list] [--no-soft]
// The written notes come from the A A B A score; when each bar began comes from the performance's own timing (the app
// gets it from the practice report). Truth: which written notes were dropped or played as another note.
import fs from "node:fs";
import path from "node:path";
import { readScore, playOrder } from "../engine/score.js";
import { expectedNotes, checkNotes } from "../engine/notecheck.js";

const name = process.argv[2] || "mistakes";
const PERF = process.env.PERF_DIR || "tests/output/perf";
const T = JSON.parse(fs.readFileSync(path.join(PERF, `${name}.json`), "utf8"));
const bpFile = path.join(PERF, `${name}.bp.json`);
if (!fs.existsSync(bpFile)) { console.log(`make ${bpFile} first (see the top of this file)`); process.exit(2); }
const heardAll = JSON.parse(fs.readFileSync(bpFile, "utf8")).map(([t, midi, dur, amp]) => ({ t, midi, dur, amp }));
const until = heardAll.reduce((m, h) => Math.max(m, h.t + h.dur), 0);
const at = (b) => { let i = T.beats.findIndex((x) => x >= b); if (i <= 0) return T.times[Math.max(0, i)]; return T.times[i - 1] + ((b - T.beats[i - 1]) / (T.beats[i] - T.beats[i - 1])) * (T.times[i] - T.times[i - 1]); };

const score = readScore(fs.readFileSync("tests/output/scores/aba_repeat.musicxml"));
const order = playOrder(score);
let bars = order.map((m, k) => ({ played: k, measure: m, t0: at(4 * k), t1: at(4 * k + 4) })).filter((b) => b.t1 <= until);
if (process.argv.includes("--follow")) {
  // as in the app: bar times from following the performance and the practice report
  const { featuresOf } = await import("./engine-eval.js");
  const { scoreSection } = await import("../engine/scorelesson.js");
  const { Follower } = await import("../engine/follower.js");
  const { PracticeLog } = await import("../engine/practice.js");
  const sec = scoreSection(score);
  const fol = new Follower({ version: 2, sections: [sec] }, { page: 1 });
  const log = new PracticeLog(fol.lesson, order, score.measures, (f, j) => fol.cost(f, j));
  for (const f of featuresOf(path.join(PERF, `${name}.wav`))) {
    fol.push(f);
    log.record(f, fol.status === "following" && !fol.unsure ? fol.position : -1, fol.moves || 0);
  }
  bars = log.report().bars.filter((b) => b.t0 !== null && b.t0 <= until);
  console.log(`(bar times from following: ${bars.length} bars)`);
}
const expected = expectedNotes(bars, score.measures);
const softFile = path.join(PERF, `${name}.bpsoft.json`);
const soft = !process.argv.includes("--no-soft") && fs.existsSync(softFile) ? JSON.parse(fs.readFileSync(softFile, "utf8")).map(([t, midi, dur, amp]) => ({ t, midi, dur, amp })) : null;
const res = checkNotes(expected, heardAll, undefined, soft);

// truth for each written note, from what was really played
const played = T.notes.map(([t, midi]) => ({ t, midi }));
let tp = 0, fp = 0, fn = 0, okRight = 0, okTotal = 0, wrongRight = 0;
const truthOf = (e) => {
  const ideal = at(4 * e.played + e.beat); // when it really was due in this performance
  const near = played.filter((p) => Math.abs(p.t - ideal) <= 0.12 && Math.abs(p.midi - e.midi) <= 2);
  if (near.some((p) => p.midi === e.midi)) return "ok";
  return near.length ? "wrong" : "missed";
};
for (const e of res.notes) {
  const truth = truthOf(e);
  const flagged = e.status !== "ok";
  if (truth === "ok") { okTotal++; if (!flagged) okRight++; else fp++; }
  else if (flagged) { tp++; if (truth === "wrong" && e.status === "wrong") wrongRight++; }
  else fn++;
  if (process.argv.includes("--list") && (truth === "ok") === flagged) {
    console.log(`  ${truth === "ok" ? "flagged but played" : "not found"}: bar ${e.played + 1} beat ${e.beat} midi ${e.midi} (${e.status}, due ${e.t.toFixed(2)}, corrected ${e.tc.toFixed(2)}${e.heardAt ? `, heard ${e.heardAt.toFixed(2)}` : ""})`);
  }
}
const mistakes = tp + fn;
console.log(`${name}: ${res.checked} written notes checked (${bars.length} bars); real mistakes ${mistakes}`);
console.log(`  mistakes found ${tp}/${mistakes} (${(100 * tp / Math.max(1, mistakes)).toFixed(0)}%), of them called "wrong note" correctly ${wrongRight}`);
console.log(`  correct notes wrongly flagged ${fp}/${okTotal} (${(100 * fp / Math.max(1, okTotal)).toFixed(1)}%)`);
process.exit(0);
