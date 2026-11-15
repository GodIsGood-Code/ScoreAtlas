// Offline check of the listening engine and page-turn follower on synthetic piano performances.
//   1) python3 tools/synth_performances.py tests/output/perf    (needs fluidsynth, see that file)
//   2) node tests/engine-eval.js tests/output/perf [--quiet]
// For each case, one performance teaches the lesson (with page turns where the score's pages end)
// and another is followed as if live. Reports when each page turn fired versus when it should have,
// and how far the follower's idea of the position was from the truth.
import fs from "node:fs";
import path from "node:path";
import { FeatureExtractor } from "../engine/features.js";
import { makeLesson, Follower, FOLLOW_SETTINGS } from "../engine/follower.js";

const dir = process.env.PERF_DIR || process.argv[2] || "tests/output/perf";
const quiet = process.argv.includes("--quiet");

export const CASES = [
  ["faster", "ref"], ["slower", "ref"], ["much_faster", "ref_slow"], ["mistakes", "ref"],
  ["pause", "ref"], ["noisy", "ref"], ["voicing", "ref"], ["no_pedal", "ref"],
];

export function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt = null;
  while (p < b.length) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22), format: b.readUInt16LE(p + 8) };
    if (id === "data") {
      const n = size / (fmt.bits / 8) / fmt.channels;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const o = p + 8 + (i * fmt.channels + c) * (fmt.bits / 8);
          s += fmt.format === 3 ? b.readFloatLE(o) : b.readInt16LE(o) / 32768;
        }
        out[i] = s / fmt.channels;
      }
      return { sampleRate: fmt.rate, samples: out };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("no audio data in " + file);
}

export function featuresOf(file) {
  const { sampleRate, samples } = readWav(file);
  const frames = [];
  const fx = new FeatureExtractor(sampleRate, (f) => frames.push(f));
  for (let i = 0; i < samples.length; i += 1024) fx.push(samples.subarray(i, i + 1024));
  return frames;
}

const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
};

export function runCase(liveName, refName, settings = FOLLOW_SETTINGS, cache = {}) {
  const truth = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8"));
  const frames = (n) => (cache[n] ||= featuresOf(path.join(dir, n + ".wav")));
  const refT = truth(refName), liveT = truth(liveName);
  const refF = frames(refName), liveF = frames(liveName);

  // Teaching: the page turns happen where the truth says the turn beats are
  const turns = refT.turnBeats.map((b, i) => {
    const t = interp(refT.beats, refT.times, b);
    return { frame: refF.findIndex((f) => f.time >= t), page: i + 2 };
  });
  const lesson = makeLesson(refF, turns, {}, settings);

  const fired = [];
  const follower = new Follower(lesson, { settings, onTurn: (page) => fired.push({ page, time: now }) });
  let now = 0, errs = [], t0 = process.hrtime.bigint();
  const [pauseAt, pauseLen] = liveT.pause || [null, 0];
  for (const f of liveF) {
    now = f.time;
    const st = follower.push(f);
    if (st.status !== "following" || !f.sounding) continue;
    // Where the follower thinks we are (as a beat of the score) versus where we really are
    const refTime = refF[lesson.source[follower.position]].time;
    const refBeat = interp(refT.times, refT.beats, refTime);
    const liveBeat = interp(liveT.times, liveT.beats, f.time);
    if (liveBeat < 1 || liveBeat > refT.totalBeats - 1) continue;
    errs.push(interp(liveT.beats, liveT.times, refBeat) - f.time);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const turnReport = liveT.turnBeats.map((b, i) => {
    const should = interp(liveT.beats, liveT.times, b);
    const got = fired.find((x) => x.page === i + 2);
    return { page: i + 2, should, got: got ? got.time : null, error: got ? got.time - should : null };
  });
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return {
    liveName, refName, turnReport,
    extraTurns: fired.length - turnReport.filter((t) => t.got !== null).length,
    meanAbs: abs.reduce((s, x) => s + x, 0) / abs.length,
    p95: abs[Math.floor(abs.length * 0.95)],
    max: abs[abs.length - 1],
    msPerSecond: ms / (liveF.length / 50),
  };
}

// A turn is good if it comes no more than 1.5 s early and no more than 0.3 s late
export const goodTurn = (t) => t.error !== null && t.error >= -1.5 && t.error <= 0.3;

if (import.meta.url === `file://${process.argv[1]}`) {
  const cache = {};
  let good = 0, total = 0;
  for (const [live, ref] of CASES) {
    const r = runCase(live, ref, FOLLOW_SETTINGS, cache);
    const turns = r.turnReport.map((t) => (t.error === null ? "missed" : `${t.error >= 0 ? "+" : ""}${t.error.toFixed(2)}s`)).join("  ");
    good += r.turnReport.filter(goodTurn).length;
    total += r.turnReport.length;
    console.log(`${live.padEnd(12)} turns: ${turns.padEnd(30)} extra: ${r.extraTurns}  position error: mean ${r.meanAbs.toFixed(2)}s, 95% ${r.p95.toFixed(2)}s, max ${r.max.toFixed(2)}s  (${r.msPerSecond.toFixed(1)} ms of work per second of music)`);
  }
  console.log(`\nGood page turns: ${good}/${total}`);
  process.exit(good === total ? 0 : 1);
}
