// Finds where in a taught piece the last couple of seconds of playing fit best, searching the whole piece.
// The follower uses it when the pianist starts mid-piece, after a pause, and to notice a jump elsewhere.
// It works on a coarse copy of the lesson (groups of 4 frames averaged), so even a long piece searches quickly.
//
// Method: subsequence dynamic time warping. The recent playing may begin anywhere in the lesson and may run
// slower or faster (up to 3x); for every lesson moment we get the cost of the best way the recent playing
// could have ended there.

import { FRAME_RATE } from "./features.js";

// Cost of matching row a of table A with row b of table B. Tables hold chroma, onset (12 per row) and sound.
export function pairCost(A, a, B, b, cfg) {
  const sa = A.sound[a] === 1, sb = B.sound[b] === 1;
  if (!sa && !sb) return 0;
  if (sa !== sb) return cfg.silenceCost;
  const ia = a * 12, ib = b * 12;
  let dc = 0, don = 0, oa = 0, ob = 0;
  for (let q = 0; q < 12; q++) {
    dc += A.chroma[ia + q] * B.chroma[ib + q];
    don += A.onset[ia + q] * B.onset[ib + q];
    oa += A.onset[ia + q];
    ob += B.onset[ib + q];
  }
  const onsetDist = oa > 0 && ob > 0 ? 1 - don : oa > 0 || ob > 0 ? 0.6 : 0;
  return (1 - cfg.onsetWeight) * (1 - dc) + cfg.onsetWeight * onsetDist;
}

function unit(v, o) {
  let s = 0;
  for (let q = 0; q < 12; q++) s += v[o + q] * v[o + q];
  if (s <= 1e-20) return;
  const k = 1 / Math.sqrt(s);
  for (let q = 0; q < 12; q++) v[o + q] *= k;
}

// Average groups of `factor` rows. get(i) returns { chroma, onset, sounding } for row i of the source.
function coarsen(count, factor, get, fromEnd) {
  const n = Math.floor(count / factor) || 0;
  const t = { length: n, chroma: new Float32Array(n * 12), onset: new Float32Array(n * 12), sound: new Uint8Array(n) };
  const start = fromEnd ? count - n * factor : 0;
  for (let g = 0; g < n; g++) {
    let loud = 0;
    for (let k = 0; k < factor; k++) {
      const f = get(start + g * factor + k);
      if (f.sounding) loud++;
      for (let q = 0; q < 12; q++) {
        t.chroma[g * 12 + q] += f.chroma[q];
        t.onset[g * 12 + q] += f.onset[q];
      }
    }
    unit(t.chroma, g * 12);
    unit(t.onset, g * 12);
    t.sound[g] = loud * 2 >= factor ? 1 : 0;
    if (!t.sound[g]) {
      t.chroma.fill(0, g * 12, g * 12 + 12);
      t.onset.fill(0, g * 12, g * 12 + 12);
    }
  }
  return t;
}

export class Searcher {
  // lesson: a flattened lesson (see follower.js), or a single section; each section is searched on its own
  constructor(lesson, settings) {
    this.cfg = settings;
    this.factor = settings.searchFactor;
    const L = lesson, f = this.factor;
    const starts = L.starts || [0], ends = L.ends || [L.length];
    const frame = { chroma: null, onset: null, sounding: false };
    const parts = starts.map((start, k) => {
      const len = ends[k] - start;
      // pad each section so its last partial group still counts
      return coarsen(Math.ceil(len / f) * f, f, (i) => {
        const j = start + Math.min(i, len - 1);
        frame.chroma = L.chroma.subarray(j * 12, j * 12 + 12);
        frame.onset = L.onset.subarray(j * 12, j * 12 + 12);
        frame.sounding = L.sound[j] === 1;
        return frame;
      }, false);
    });
    const M = parts.reduce((n, p) => n + p.length, 0);
    const C = { length: M, chroma: new Float32Array(M * 12), onset: new Float32Array(M * 12), sound: new Uint8Array(M) };
    this.first = new Int32Array(M); // where each coarse position's section starts (coarse index)
    this.endFrame = new Int32Array(M); // the lesson frame each coarse position ends on
    this.coarseStart = []; // per section
    let at = 0;
    parts.forEach((p, k) => {
      C.chroma.set(p.chroma, at * 12);
      C.onset.set(p.onset, at * 12);
      C.sound.set(p.sound, at);
      this.coarseStart.push(at);
      for (let g = 0; g < p.length; g++) {
        this.first[at + g] = at;
        this.endFrame[at + g] = Math.min(ends[k] - 1, starts[k] + g * f + f - 1);
      }
      at += p.length;
    });
    this.coarse = C;
    this.starts = starts;
    this.ends = ends;
    this.prev = new Float64Array(M);
    this.cur = new Float64Array(M);
  }

  // The coarse position that lesson frame `frame` falls in
  coarseIndex(frame) {
    let k = 0;
    while (k + 1 < this.starts.length && frame >= this.starts[k + 1]) k++;
    return Math.min(this.coarse.length - 1, this.coarseStart[k] + Math.floor((frame - this.starts[k]) / this.factor));
  }

  // frames: recent live frames, oldest first. Returns up to 5 distinct candidate places, best first,
  // each { frame (lesson frame where the recent playing ends), cost (average per step, lower is better) },
  // plus the cost of ending at every coarse lesson position (`row`) for costNear.
  search(frames) {
    const { cfg, factor, coarse: C } = this;
    // quiet before the playing began says nothing about where it is, but would count against places that come after
    // sound in the piece and for places after rests (and the very start of the piece has nothing before it at all)
    let lead = 0;
    while (lead < frames.length && !frames[lead].sounding) lead++;
    if (lead > 0 && frames.length - lead >= 40) frames = frames.slice(lead);
    const Q = coarsen(frames.length, factor, (i) => frames[i], true);
    const n = Q.length, M = C.length;
    if (n === 0 || M === 0) return { candidates: [], row: null };
    let prev = this.prev, cur = this.cur;
    for (let j = 0; j < M; j++) prev[j] = pairCost(Q, 0, C, j, cfg);
    const first = this.first;
    for (let i = 1; i < n; i++) {
      for (let j = 0; j < M; j++) {
        // a match may not run from one taught section into another
        const f0 = first[j];
        let b = prev[j] + cfg.stayCost;
        if (j - 1 >= f0 && prev[j - 1] < b) b = prev[j - 1];
        if (j - 2 >= f0 && prev[j - 2] + cfg.skip2Cost < b) b = prev[j - 2] + cfg.skip2Cost;
        if (j - 3 >= f0 && prev[j - 3] + cfg.skip3Cost < b) b = prev[j - 3] + cfg.skip3Cost;
        cur[j] = b + pairCost(Q, i, C, j, cfg);
      }
      const t = prev;
      prev = cur;
      cur = t;
    }
    const row = new Float64Array(M);
    for (let j = 0; j < M; j++) row[j] = prev[j] / n;

    // Pick distinct places: the best, then the best at least `separation` seconds away from those chosen
    const sep = Math.round((cfg.separation * FRAME_RATE) / factor);
    const taken = [];
    const candidates = [];
    for (let k = 0; k < 5; k++) {
      let best = Infinity, bj = -1;
      for (let j = 0; j < M; j++) {
        if (row[j] < best && taken.every((t) => Math.abs(t - j) > sep)) { best = row[j]; bj = j; }
      }
      if (bj < 0) break;
      taken.push(bj);
      candidates.push({ frame: this.endFrame[bj], cost: best });
    }
    // How well a typical place fits: a real match stands out far below this; random playing doesn't
    const sorted = Float64Array.from(row).sort();
    const background = sorted[Math.floor(sorted.length / 2)];
    return { candidates, row, background };
  }

  // Best cost of ending within `radius` lesson frames of `frame`
  costNear(row, frame, radius) {
    if (!row) return Infinity;
    const c = this.coarseIndex(frame), r = Math.ceil(radius / this.factor);
    const lo = Math.max(this.first[c], c - r), hi = Math.min(row.length - 1, c + r);
    let best = Infinity;
    for (let j = lo; j <= hi; j++) if (row[j] < best) best = row[j];
    return best;
  }
}
