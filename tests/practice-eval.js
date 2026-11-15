// Offline check of practice-style following: starting mid-piece, repeating, jumping, noodling.
//   1) python3 tools/synth_performances.py tests/output/perf ref
//      python3 tools/synth_performances.py tests/output/perf --practice
//   2) node tests/practice-eval.js tests/output/perf
// Every session is followed with the lesson taught from "ref". For each one it reports:
//  - found: seconds from each restart until the follower knows where the pianist is
//  - right page: share of playing time the correct page shows (ignoring 3 s after restarts and 1 s around turns)
//  - turns: page turns when playing straight through a page break, on time (-1.5 s to +0.5 s)
//  - stray: page changes while nothing from the piece is being played (pauses, noodling)
import fs from "node:fs";
import path from "node:path";
import { featuresOf } from "./engine-eval.js";
import { makeLesson, Follower, FOLLOW_SETTINGS } from "../engine/follower.js";

const dir = process.env.PERF_DIR || process.argv[2] || "tests/output/perf";
export const SESSIONS = ["p_start_mid", "p_start_mid_no_flip", "p_repeat_passage", "p_jump_back", "p_jump_back_flip", "p_noodle", "p_skip_ahead", "p_repeat_section", "p_back_over_turn",
  "p_start_mid_fast", "p_repeat_passage_slow", "p_skip_ahead_noisy", "p_noodle_fast"];

const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + ((x - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
};

export function runSession(name, settings = FOLLOW_SETTINGS, cache = {}) {
  const json = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8"));
  const frames = (n) => (cache[n] ||= featuresOf(path.join(dir, n + ".wav")));
  const refT = json("ref"), refF = frames("ref"), S = json(name), liveF = frames(name);
  const turnBeats = refT.turnBeats;
  const turns = turnBeats.map((b, i) => ({ frame: refF.findIndex((f) => f.time >= interp(refT.beats, refT.times, b)), page: i + 2 }));
  const lesson = makeLesson(refF, turns, { startPage: 1 }, settings);
  const pageOfBeat = (b) => 1 + turnBeats.filter((t) => b >= t).length;
  const trackT = S.track.map((x) => x[0]), trackB = S.track.map((x) => x[1]);
  const beatAt = (t) => { const i = Math.min(S.track.length - 1, Math.max(0, Math.round(t / 0.05))); return trackB[i]; };

  // Play segments with their start and end times
  const plays = [];
  for (let i = 0; i < S.track.length; i++) {
    const playing = trackB[i] >= 0;
    const continues = playing && i > 0 && trackB[i - 1] >= 0 && Math.abs(trackB[i] - trackB[i - 1]) < 1;
    if (playing && !continues) plays.push({ t0: trackT[i], b0: trackB[i], t1: trackT[i] });
    if (playing) plays[plays.length - 1].t1 = trackT[i];
  }

  let page = S.initialPage, now = 0;
  const changes = [];
  const follower = new Follower(lesson, { page, settings, onTurn: (p, why) => { page = p; changes.push({ t: now, page: p, why }); } });
  const timeline = [];
  const flips = (S.flips || []).slice();
  for (const f of liveF) {
    now = f.time;
    while (flips.length && flips[0][0] <= now) {
      page = flips.shift()[1];
      changes.push({ t: now, page, why: "pianist" });
      follower.pianistTurned(page);
    }
    const st = follower.push(f);
    const lessonBeat = st.status === "following" || st.status === "finished" ? interp(refT.times, refT.beats, refF[lesson.source[follower.position]].time) : null;
    timeline.push({ t: now, page, lessonBeat });
  }

  const found = plays.map((p) => {
    const ok = timeline.find((x) => x.t >= p.t0 && x.t <= p.t1 && x.lessonBeat !== null && Math.abs(x.lessonBeat - beatAt(x.t)) < 1.5);
    return ok ? ok.t - p.t0 : null;
  });
  let rightTime = 0, total = 0;
  const nearTurn = (t) => plays.some((p) => turnBeats.some((tb) => {
    if (!(p.b0 <= tb && beatAt(p.t1) >= tb)) return false;
    const tt = trackT[trackB.findIndex((b, i) => trackT[i] >= p.t0 && b >= tb)];
    return Math.abs(t - tt) < 1.0;
  }));
  for (const x of timeline) {
    const b = beatAt(x.t);
    if (b < 0 || plays.some((p) => x.t >= p.t0 && x.t < p.t0 + 3) || nearTurn(x.t)) continue;
    total++;
    if (x.page === pageOfBeat(b)) rightTime++;
  }
  // Straight-through crossings of a page break, after the follower had time to settle (3 s)
  const crossings = [];
  for (const p of plays) {
    for (const [k, tb] of turnBeats.entries()) {
      if (!(p.b0 <= tb && beatAt(p.t1) > tb + 0.5)) continue;
      const tt = trackT[trackB.findIndex((b, i) => trackT[i] >= p.t0 && b >= tb)];
      if (tt < p.t0 + 3) continue;
      const hit = changes.find((c) => c.page === k + 2 && c.t >= tt - 1.5 && c.t <= tt + 0.5);
      crossings.push(hit ? hit.t - tt : null);
    }
  }
  const stray = changes.filter((c) => c.why !== "pianist" && beatAt(c.t) < 0 && beatAt(c.t - 0.5) < 0).length;
  return { name, found, rightPage: total ? rightTime / total : 1, crossings, stray, changes };
}

export function summary(results) {
  let foundOk = 0, foundAll = 0, turnsOk = 0, turnsAll = 0, stray = 0, right = 0;
  for (const r of results) {
    for (const f of r.found) { foundAll++; if (f !== null && f <= 4) foundOk++; }
    for (const c of r.crossings) { turnsAll++; if (c !== null) turnsOk++; }
    stray += r.stray;
    right += r.rightPage;
  }
  return { foundOk, foundAll, turnsOk, turnsAll, stray, rightPage: right / results.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cache = {};
  const results = SESSIONS.map((n) => runSession(n, FOLLOW_SETTINGS, cache));
  for (const r of results) {
    const found = r.found.map((f) => (f === null ? "never" : `${f.toFixed(1)}s`)).join(", ");
    const turns = r.crossings.map((c) => (c === null ? "missed" : `${c >= 0 ? "+" : ""}${c.toFixed(2)}s`)).join(", ") || "none";
    console.log(`${r.name.padEnd(20)} found: ${found.padEnd(22)} right page: ${(100 * r.rightPage).toFixed(0).padStart(3)}%  turns: ${turns.padEnd(16)} stray: ${r.stray}`);
    if (process.argv.includes("--changes")) console.log("   ", r.changes.map((c) => `${c.t.toFixed(1)}s→p${c.page}(${c.why})`).join("  "));
  }
  const s = summary(results);
  console.log(`\nFound within 4 s: ${s.foundOk}/${s.foundAll}   turns on time: ${s.turnsOk}/${s.turnsAll}   stray page changes: ${s.stray}   right page: ${(100 * s.rightPage).toFixed(0)}% of the time`);
  process.exit(s.foundOk === s.foundAll && s.turnsOk === s.turnsAll && s.stray === 0 ? 0 : 1);
}
