// Following a real recording from sheet music, with ground truth worked out offline.
//   node tests/real-eval.js SCORE.mxl RECORDING.wav [--parts 12,13] [--end SECONDS] [--quiet]
// The recording must begin with a run-through from the start of the piece (up to --end seconds; the default is the
// whole recording). Convert a Voice Memo first: ffmpeg -i memo.m4a -ac 1 -ar 22050 rec.wav
// The owner's sheet music and recordings stay out of the repository: keep them outside it (or in tests/output/).
//
// 1) Truth: the run-through is aligned with the score reference offline (full dynamic time warping, which sees the
//    whole recording at once), giving the moment each bar starts.
// 2) Run-through: the follower as in the app; page turns versus when each new page's music starts, position error,
//    and the measure highlight.
// 3) Practice: sessions cut from the run-through (start mid-page, go back, skip ahead, back to the beginning, ...),
//    with pauses between, once with the pianist flipping to the right page before playing and once without.
//    How quickly the follower finds them, how often the right page shows, and stray page changes.
import fs from "node:fs";
import { readWav } from "./engine-eval.js";
import { FeatureExtractor } from "../engine/features.js";
import { readScore, keepParts, playOrder } from "../engine/score.js";
import { scoreSection } from "../engine/scorelesson.js";
import { Follower } from "../engine/follower.js";
import { MeasureMarker } from "../engine/marker.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const [mxl, wav] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--quiet"));
if (!mxl || !wav) { console.log("usage: node tests/real-eval.js SCORE.mxl RECORDING.wav [--parts 12] [--end SECONDS]"); process.exit(2); }
const parts = opt("--parts") ? opt("--parts").split(",").map(Number) : null;
const quiet = args.includes("--quiet");

const score = keepParts(readScore(fs.readFileSync(mxl)), parts);
const order = playOrder(score);
const sec = scoreSection(score);
const lesson = { version: 2, sections: [sec] };
const { sampleRate, samples } = readWav(wav);
const featuresOfSamples = (x) => {
  const out = [];
  const fx = new FeatureExtractor(sampleRate, (f) => out.push(f));
  for (let i = 0; i < x.length; i += 1024) fx.push(x.subarray(i, i + 1024));
  return out;
};
const live = featuresOfSamples(samples);
const END = Number(opt("--end", live[live.length - 1].time));
const pageOfPlayed = (k) => score.measures[order[k]].page;

// ---------- 1) Truth by offline alignment ----------
const probe = new Follower(lesson, { page: 1 });
const a = live.findIndex((f) => f.sounding);
const b = Math.min(live.length, Math.round(END * 50));
const N = b - a, M = sec.length;
const dir = new Uint8Array(N * M);
let prev = new Float64Array(M), cur = new Float64Array(M);
for (let i = 0; i < N; i++) {
  const f = live[a + i];
  for (let j = 0; j < M; j++) {
    const c = probe.cost(f, j);
    if (i === 0 && j === 0) { cur[j] = c; continue; }
    let best = Infinity, d = 0;
    if (i > 0 && j > 0 && prev[j - 1] < best) { best = prev[j - 1]; d = 1; }
    if (i > 0 && prev[j] + 0.02 < best) { best = prev[j] + 0.02; d = 2; }
    if (j > 0 && cur[j - 1] + 0.02 < best) { best = cur[j - 1] + 0.02; d = 3; }
    cur[j] = best + c;
    dir[i * M + j] = d;
  }
  [prev, cur] = [cur, prev];
}
let jEnd = 0;
for (let k = 0; k < M; k++) if (prev[k] < prev[jEnd]) jEnd = k;
const refAt = new Int32Array(live.length).fill(-1); // live frame -> lesson frame
{
  let i = N - 1, j = jEnd;
  while (i > 0 || j > 0) {
    if (refAt[a + i] < 0) refAt[a + i] = j;
    const d = dir[i * M + j];
    if (d === 1) { i--; j--; } else if (d === 2) i--; else j--;
  }
  refAt[a] = 0;
  for (let k = a + 1; k < b; k++) if (refAt[k] < 0) refAt[k] = refAt[k - 1];
}
// the live frame where each played bar starts
const barStart = new Map();
for (let k = a; k < b; k++) { const p = sec.played[refAt[k]]; if (!barStart.has(p)) barStart.set(p, k); }
const playedBars = [...barStart.keys()].sort((x, y) => x - y);
const lastPlayed = playedBars[playedBars.length - 1];
const barName = (k) => score.measures[order[k]].number;

// ---------- 2) Run-through ----------
{
  const turns = [];
  let now = 0;
  const fol = new Follower(lesson, { page: 1, onTurn: (page, why) => turns.push({ page, why, t: now }) });
  const marker = new MeasureMarker(25);
  let moves = 0, hlRight = 0, hlNear = 0, hlCount = 0, flips = 0, lastShown = -1;
  const errs = [];
  for (let k = 0; k < b; k++) {
    const f = live[k];
    now = f.time;
    fol.push(f);
    if (k >= a && fol.status === "following") errs.push((fol.position - refAt[k]) / 50);
    if (k % 2 === 0 && k >= a) {
      const sure = fol.status === "following" && !fol.unsure;
      const shown = marker.update(sure ? fol.lesson.played[fol.position] : -1, (fol.moves || 0) !== moves);
      moves = fol.moves || 0;
      if (shown >= 0) {
        const t = sec.played[refAt[k]];
        hlCount++;
        if (shown === t) hlRight++;
        if (Math.abs(shown - t) <= 1) hlNear++;
        if (lastShown >= 0 && shown < lastShown) flips++;
        lastShown = shown;
      }
    }
  }
  const pageStarts = [];
  for (const p of playedBars) if (p > 0 && pageOfPlayed(p) !== pageOfPlayed(p - 1)) pageStarts.push({ page: pageOfPlayed(p), bar: barName(p), t: live[barStart.get(p)].time });
  const res = pageStarts.map((s) => {
    const t = turns.find((x) => x.page === s.page && x.t > s.t - 6 && x.t < s.t + 4);
    return { ...s, d: t ? t.t - s.t : null };
  });
  errs.sort((x, y) => x - y);
  const q = (p) => (errs.length ? errs[Math.floor(p * (errs.length - 1))] : NaN).toFixed(2);
  const stray = turns.filter((t) => !res.some((r) => r.d !== null && r.page === t.page && Math.abs(r.t + r.d - t.t) < 0.01));
  console.log(`Run-through (bars ${barName(playedBars[0])} to ${barName(lastPlayed)}, ${(END - live[a].time).toFixed(0)} s):`);
  console.log(`  page turns (seconds before the new page's first bar): ${res.map((r) => `p${r.page} ${r.d === null ? "missed" : (-r.d).toFixed(2)}`).join("  ")}`);
  console.log(`  stray page changes: ${stray.length ? stray.map((t) => `${t.t.toFixed(1)}s→p${t.page} ${t.why}`).join(", ") : "none"}`);
  console.log(`  position error (follower minus truth, lesson seconds): 5% ${q(0.05)}, median ${q(0.5)}, 95% ${q(0.95)}`);
  console.log(`  highlight: right bar ${(100 * hlRight / Math.max(1, hlCount)).toFixed(0)}%, within one bar ${(100 * hlNear / Math.max(1, hlCount)).toFixed(0)}%, backward steps ${flips}`);
  globalThis.runResult = { res, stray, hlRight: hlRight / Math.max(1, hlCount) };
}

// ---------- 3) Practice sessions cut from the run-through ----------
const P = pageOfPlayed(lastPlayed);
const firstOnPage = (p) => playedBars.find((k) => pageOfPlayed(k) === p);
const clampBar = (k) => Math.max(playedBars[0], Math.min(lastPlayed - 1, k));
function plan() {
  const segs = [];
  const add = (from, bars) => { const f = clampBar(from); segs.push({ from: f, to: clampBar(f + bars) }); };
  const mid = (p) => (firstOnPage(p) ?? 0) + 4;
  add(mid(Math.min(3, P)), 10); // start in the middle of page 3 and play on over the turn
  add(segs[0].to - 6, 9); // go back a few bars
  add(firstOnPage(Math.max(1, P - 2)) ?? 0, 10); // skip ahead near the end
  add(playedBars[0], 8); // back to the beginning
  add(mid(Math.max(2, Math.round(P / 2))), 10); // somewhere in the middle
  add(firstOnPage(Math.max(1, P - 1)) - 3, 8); // over the second-to-last turn
  return segs.filter((s) => s.to > s.from + 2 && barStart.has(s.from) && barStart.has(s.to));
}
const segs = plan();
// the quietest second of the recording, looped, stands in for the room during pauses
let quietAt = 0, quietLevel = Infinity;
for (let s = 0; s + sampleRate < samples.length; s += sampleRate / 4) {
  let e = 0;
  for (let i = s; i < s + sampleRate; i += 8) e += samples[i] * samples[i];
  if (e < quietLevel) { quietLevel = e; quietAt = s; }
}
function session(flip) {
  const pieces = [], truthOf = []; // per output frame: the lesson frame being played, or -1 (pause)
  const hop = Math.round(sampleRate / 50);
  const pause = (secs) => {
    const n = Math.round(secs * sampleRate);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = samples[quietAt + (i % sampleRate)];
    pieces.push(x);
    for (let i = 0; i < n / hop; i++) truthOf.push(-1);
  };
  const events = [];
  pause(2);
  for (const s of segs) {
    const f0 = barStart.get(s.from), f1 = barStart.get(s.to);
    const s0 = Math.round(live[f0].time * sampleRate - 0.1 * sampleRate), s1 = Math.round(live[f1].time * sampleRate);
    events.push({ at: truthOf.length, seg: s });
    pieces.push(samples.slice(s0, s1));
    for (let k = 0; k < (s1 - s0) / hop; k++) truthOf.push(refAt[Math.min(b - 1, f0 - 5 + k)]);
    pause(2.5);
  }
  const total = pieces.reduce((n, x) => n + x.length, 0);
  const all = new Float32Array(total);
  let at = 0;
  for (const x of pieces) { all.set(x, at); at += x.length; }
  const frames = featuresOfSamples(all);
  const turns = [];
  let now = 0;
  const fol = new Follower(lesson, { page: 1, onTurn: (page, why) => turns.push({ page, why, t: now }) });
  let shownPage = 1;
  const out = events.map((e) => ({ seg: e.seg, found: null, right: 0, n: 0 }));
  let ev = -1, stray = 0;
  for (let k = 0; k < frames.length; k++) {
    now = frames[k].time;
    const next = events[ev + 1];
    if (flip && next && k === next.at - 50) { // the pianist turns to the page they're about to play from
      const page = pageOfPlayed(next.seg.from);
      if (page !== shownPage) { shownPage = page; fol.pianistTurned(page); }
    }
    if (next && k >= next.at) ev++;
    const before = turns.length;
    fol.push(frames[k]);
    if (process.env.TRACE === (flip ? "flip" : "noflip") && k % 25 === 0) {
      const t = truthOf[k];
      console.log(`    ${now.toFixed(1)}s truth ${t >= 0 ? "bar " + barName(sec.played[t]) : "pause"}; ${fol.status}${fol.unsure ? " unsure" : ""} ${fol.status === "following" ? "bar " + barName(sec.played[fol.position]) : ""} page ${shownPage}`);
    }
    if (turns.length > before) {
      shownPage = turns[turns.length - 1].page;
      const t = truthOf[k];
      if (t >= 0) {
        const p = sec.pageAt ? null : null;
        const truthPage = pageOfPlayed(sec.played[t]);
        if (shownPage !== truthPage && shownPage !== truthPage + 1) stray++;
      } else if (ev >= 0) {
        const lastPage = pageOfPlayed(events[ev].seg.to - 1);
        if (shownPage !== lastPage && shownPage !== lastPage + 1 && !(next && shownPage === pageOfPlayed(next.seg.from))) stray++;
      }
    }
    if (ev >= 0 && truthOf[k] >= 0) {
      const o = out[ev], t = truthOf[k];
      const elapsed = (k - events[ev].at) / 50;
      if (o.found === null && fol.status === "following" && Math.abs(fol.position - t) <= 50) o.found = elapsed;
      if (elapsed >= 3) {
        o.n++;
        const tp = pageOfPlayed(sec.played[t]);
        if (shownPage === tp || (shownPage === tp + 1 && sec.turns.some((x) => x.page === tp + 1 && x.frame - t < 150 && x.frame >= t))) o.right++;
      }
    }
  }
  return { out, stray };
}
let foundOk = 0, foundAll = 0;
const report = [];
for (const flip of [true, false]) {
  const { out, stray } = session(flip);
  const label = flip ? "flipping to the page first" : "without flipping";
  if (!quiet) console.log(`Practice, ${label}:`);
  let right = 0, n = 0;
  for (const o of out) {
    right += o.right; n += o.n;
    foundAll++;
    if (o.found !== null && o.found <= 4) foundOk++;
    if (!quiet) console.log(`  bars ${barName(o.seg.from)}–${barName(o.seg.to)} (page ${pageOfPlayed(o.seg.from)}): found ${o.found === null ? "never" : o.found.toFixed(1) + " s"}; right page ${o.n ? (100 * o.right / o.n).toFixed(0) + "%" : "–"} after the first 3 s`);
  }
  report.push(`${label}: right page ${(100 * right / Math.max(1, n)).toFixed(0)}%, stray page changes ${stray}`);
}
console.log(`Practice: found within 4 s ${foundOk}/${foundAll}; ${report.join("; ")}`);
