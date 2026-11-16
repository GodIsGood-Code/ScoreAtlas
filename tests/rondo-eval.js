// The rondo (A B A C A B A, 7 pages; the refrain A is on pages 1, 3, 5 and 7), followed only from its sheet music.
//   python3 tools/synth_performances.py tests/output/perf --rondo
//   python3 tools/make_test_scores.py tests/output/scores   (and Audiveris on aba_rondo.pdf into scores/omr/)
//   node tests/rondo-eval.js
// For each performance: page turns (on time = from 2.5 s before to 0.3 s after the new page's music starts),
// stray page changes (e.g. jumping to the refrain on another page), and the measure highlight: how often it shows the
// right measure, how often it steps backward, and how far behind it is.
import fs from "node:fs";
import { featuresOf } from "./engine-eval.js";
import { readScore } from "../engine/score.js";
import { scoreSection } from "../engine/scorelesson.js";
import { Follower } from "../engine/follower.js";
import { MeasureMarker } from "../engine/marker.js";

const PERF = "tests/output/perf", SC = "tests/output/scores";
const LIVES = ["r_play", "r_fast", "r_slow", "r_bright", "r_rhodes", "r_mistakes", "r_voicing"];
const interp = (xs, ys, x) => { if (x <= xs[0]) return ys[0]; let i = xs.findIndex((v) => v >= x); if (i < 0) return ys[ys.length - 1]; return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]); };
let allOk = true;
const totals = {};
for (const file of ["aba_rondo.musicxml", "omr/aba_rondo.mxl"]) {
  if (!fs.existsSync(`${SC}/${file}`)) { console.log(`(${file} not made yet)`); continue; }
  const lesson = { version: 2, sections: [scoreSection(readScore(fs.readFileSync(`${SC}/${file}`)))] };
  const t = (totals[file] = { turns: 0, ok: 0, late: 0, stray: 0, right: 0, near: 0, frames: 0, back: 0 });
  for (const live of LIVES) {
    const T = JSON.parse(fs.readFileSync(`${PERF}/${live}.json`, "utf8"));
    const expected = [1, 2, 3, 4, 5, 6].map((k) => ({ beat: 32 * k, page: k + 1, t: interp(T.beats, T.times, 32 * k) }));
    const changes = [];
    let now = 0;
    const fol = new Follower(lesson, { page: 1, onTurn: (page, why) => changes.push({ t: now, page, why }) });
    const marker = new MeasureMarker();
    let moves = 0, lastShown = -1;
    for (const f of featuresOf(`${PERF}/${live}.wav`)) {
      now = f.time;
      fol.push(f);
      const jumped = (fol.moves || 0) !== moves;
      moves = fol.moves || 0;
      const played = fol.status === "following" && !fol.unsure ? fol.lesson.played[fol.position] : -1;
      const shown = marker.update(played, jumped);
      const beat = interp(T.times, T.beats, now);
      if (f.sounding && beat > 2 && beat < 222) {
        const truth = Math.floor(beat / 4);
        t.frames++;
        if (shown === truth) t.right++;
        if (shown >= 0 && Math.abs(shown - truth) <= 1) t.near++;
        if (shown >= 0 && lastShown >= 0 && shown < lastShown) t.back++;
      }
      if (shown >= 0) lastShown = shown;
    }
    const turnErr = expected.map((e) => { const c = changes.find((x) => x.page === e.page && x.t >= e.t - 2.5 && x.t <= e.t + 0.3); return c ? c.t - e.t : null; });
    const lateErr = expected.map((e) => { const c = changes.find((x) => x.page === e.page && x.t > e.t + 0.3 && x.t <= e.t + 4); return c ? c.t - e.t : null; });
    const stray = changes.filter((c) => !expected.some((e) => c.page === e.page && c.t >= e.t - 2.5 && c.t <= e.t + 4));
    t.turns += 6; t.ok += turnErr.filter((e) => e !== null).length; t.late += lateErr.filter((e) => e !== null).length; t.stray += stray.length;
    const fmt = turnErr.map((e, i) => (e !== null ? `${e.toFixed(1)}` : lateErr[i] !== null ? `LATE+${lateErr[i].toFixed(1)}` : "miss")).join(" ");
    console.log(`${file.padEnd(20)} ${live.padEnd(11)} turns: ${fmt.padEnd(36)} stray: ${stray.map((c) => `${c.t.toFixed(0)}s→p${c.page}`).join(" ") || "none"}`);
    if (turnErr.some((e) => e === null) || stray.length) allOk = false;
  }
}
for (const [file, t] of Object.entries(totals)) {
  console.log(`\n${file}: turns on time ${t.ok}/${t.turns} (late ${t.late}), stray page changes ${t.stray}; highlight on the right measure ${(100 * t.right / t.frames).toFixed(0)}% of the time, within one measure ${(100 * t.near / t.frames).toFixed(0)}%, backward steps ${t.back}`);
}
process.exit(allOk ? 0 : 1);
