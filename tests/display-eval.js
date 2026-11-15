// Compares the note display ("Hearing") with the notes really played in a synthetic performance.
//   node tests/display-eval.js tests/output/perf voicing ref no_pedal
// For every note played: was its note name shown within 0.3 s, and how quickly?
// For every moment something is shown: were those notes really played in the last half second?
// Also runs the Test 2 display method for comparison.
import fs from "node:fs";
import path from "node:path";
import { readWav, featuresOf } from "./engine-eval.js";
import { Hearing, HEARING_SETTINGS } from "../engine/hearing.js";
import { FFT } from "../engine/fft.js";

const dir = process.argv[2] || "tests/output/perf";
const names = process.argv.slice(3).filter((a) => !a.startsWith("--"));

// Test 2's method: 8192-sample slices, 20 per second, normalized to the loudest note, smoothed
function oldDisplay(file) {
  const { sampleRate, samples } = readWav(file);
  const n = 8192, hop = Math.round(sampleRate / 20), fft = new FFT(n), buf = new Float64Array(n), pow = new Float64Array(n / 2 + 1);
  const binHz = sampleRate / n, map = [];
  for (let k = 1; k < n / 2; k++) {
    const f = k * binHz; if (f < 55 || f > 4200) continue;
    const midi = 69 + 12 * Math.log2(f / 440), near = Math.round(midi), w = 1 - 2 * Math.abs(midi - near);
    if (w > 0) map.push([k, ((near % 12) + 12) % 12, w * w]);
  }
  const smooth = new Float32Array(12), out = [];
  for (let end = n; end <= samples.length; end += hop) {
    let sq = 0;
    for (let i = 0; i < n; i++) { const s = samples[end - n + i]; sq += s * s; buf[i] = s * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n)); }
    fft.power(buf, pow);
    const mags = map.map(([k]) => Math.sqrt(pow[k]) / n);
    const floor = (mags.reduce((a, b) => a + b, 0) / mags.length) * 1.5;
    const chroma = new Float32Array(12);
    map.forEach(([, q, w], i) => { const m = mags[i] - floor; if (m > 0) chroma[q] += m * w; });
    const level = 10 * Math.log10(sq / n + 1e-12), quiet = level < -58;
    const max = Math.max(...chroma);
    for (let q = 0; q < 12; q++) smooth[q] = smooth[q] * 0.55 + (quiet || !max ? 0 : chroma[q] / max) * 0.45;
    const heard = quiet ? [] : [...smooth.keys()].sort((a, b) => smooth[b] - smooth[a]).filter((q) => smooth[q] > 0.55).slice(0, 4);
    out.push({ time: end / sampleRate, heard });
  }
  return out;
}

export function newDisplay(file, settings = HEARING_SETTINGS) {
  const h = new Hearing(settings);
  return featuresOf(file).map((f) => ({ time: f.time, heard: h.update(f).heard.slice() }));
}

export function score(shown, notes) {
  let hits = 0, latency = 0;
  const byRole = {};
  for (const [t0, pitch, , role] of notes) {
    const q = pitch % 12;
    const hit = shown.find((s) => s.time >= t0 + 0.02 && s.time <= t0 + 0.3 && s.heard.includes(q));
    byRole[role] ||= [0, 0];
    byRole[role][1]++;
    if (hit) { hits++; latency += hit.time - t0; byRole[role][0]++; }
  }
  let shownCount = 0, right = 0;
  for (const s of shown) {
    if (!s.heard.length) continue;
    const recent = new Set(notes.filter(([t0]) => t0 <= s.time && t0 > s.time - 0.5).map(([, p]) => p % 12));
    shownCount += s.heard.length;
    right += s.heard.filter((q) => recent.has(q)).length;
  }
  return {
    caught: hits / notes.length,
    melody: byRole.mel ? byRole.mel[0] / byRole.mel[1] : NaN,
    accompaniment: byRole.acc ? byRole.acc[0] / byRole.acc[1] : NaN,
    latencyMs: hits ? (1000 * latency) / hits : NaN,
    correctShown: shownCount ? right / shownCount : NaN,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(4);
  for (const name of names.length ? names : ["voicing", "ref", "no_pedal"]) {
    const file = path.join(dir, name + ".wav");
    const notes = JSON.parse(fs.readFileSync(path.join(dir, name + ".json"), "utf8")).notes;
    for (const [label, shown] of [["Test 2", oldDisplay(file)], ["new", newDisplay(file)]]) {
      const r = score(shown, notes);
      console.log(`${name.padEnd(9)} ${label.padEnd(7)} notes caught ${pct(r.caught)} (melody ${pct(r.melody)}, accompaniment ${pct(r.accompaniment)}), shown notes that were really played ${pct(r.correctShown)}, delay ${r.latencyMs.toFixed(0)} ms`);
    }
  }
}
