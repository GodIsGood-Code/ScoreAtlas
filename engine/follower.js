// Follows a performance through a taught piece and decides when to turn pages.
//
// A "lesson" is one earlier playthrough of the piece: its features (see features.js) plus the moments
// the pianist turned pages. While the piece is played again, every new frame of sound is matched
// against the lesson with online dynamic time warping: for each moment of the lesson we keep the cost
// of the best way the performance so far could have arrived there, allowing it to go slower or faster.
// The cheapest lesson moment is where we think the pianist is. When that passes a page turn, we turn.

import { FRAME_RATE } from "./features.js";

export const FOLLOW_SETTINGS = {
  maxGap: 0.3, // seconds of silence kept; longer pauses are squeezed out of the lesson and ignored live
  stayCost: 0.05, // extra cost for the performance moving slower than the lesson
  skip2Cost: 0.02, // ... for moving up to 2x faster (cheaper, or the follower lags when you speed up)
  skip3Cost: 0.05, // ... for moving up to 3x faster
  silenceCost: 0.9, // cost of sound in one and silence in the other
  onsetWeight: 0.3, // how much "which notes were just struck" counts, versus "which notes sound"
  startWindow: 2, // seconds: the performance must begin within this much of the lesson's start
  anticipation: 0.3, // seconds: turn this much before the moment the page was turned in the lesson
  unsureCost: 0.5, // recent match cost above which the follower says it's unsure and holds turns
  searchBack: 30, // seconds behind the current position still considered (keeps long pieces light)
};

// frames: features recorded while teaching. turns: [{ frame, page }] where frame indexes into frames.
export function makeLesson(frames, turns, info = {}, settings = FOLLOW_SETTINGS) {
  const first = frames.findIndex((f) => f.sounding);
  if (first < 0) throw new Error("No music was heard while teaching.");
  let last = frames.length - 1;
  while (!frames[last].sounding) last--;

  const maxGap = Math.round(settings.maxGap * FRAME_RATE);
  const keep = [];
  const map = new Int32Array(frames.length); // teaching frame -> lesson frame
  let gap = 0;
  for (let i = 0; i < frames.length; i++) {
    if (i < first) { map[i] = 0; continue; }
    if (i > last) { map[i] = keep.length - 1; continue; }
    gap = frames[i].sounding ? 0 : gap + 1;
    if (gap <= maxGap) keep.push(i);
    map[i] = Math.max(0, keep.length - 1);
  }

  const length = keep.length;
  const chroma = new Float32Array(length * 12);
  const onset = new Float32Array(length * 12);
  const sound = new Uint8Array(length);
  keep.forEach((src, j) => {
    chroma.set(frames[src].chroma, j * 12);
    onset.set(frames[src].onset, j * 12);
    sound[j] = frames[src].sounding ? 1 : 0;
  });
  const lessonTurns = turns
    .map((t) => ({ frame: map[Math.min(Math.max(t.frame, 0), frames.length - 1)], page: t.page }))
    .sort((a, b) => a.frame - b.frame);
  const source = Int32Array.from(keep); // lesson frame -> teaching frame
  return { version: 1, frameRate: FRAME_RATE, length, chroma, onset, sound, source, turns: lessonTurns, ...info };
}

export class Follower {
  constructor(lesson, { onTurn, settings = FOLLOW_SETTINGS } = {}) {
    this.lesson = lesson;
    this.cfg = settings;
    this.M = lesson.length;
    this.D = new Float64Array(this.M).fill(Infinity);
    this.next = new Float64Array(this.M).fill(Infinity);
    this.t = 0;
    this.reach = -1;
    this.silentRun = 0;
    this.maxGap = Math.round(settings.maxGap * FRAME_RATE);
    this.ahead = Math.round(settings.anticipation * FRAME_RATE);
    this.position = 0;
    this.status = "waiting"; // waiting -> following -> finished
    this.recentCost = 0;
    this.turnIndex = 0;
    this.streak = 0;
    this.onTurn = onTurn;
  }

  cost(f, j) {
    const L = this.lesson, cfg = this.cfg;
    const ls = L.sound[j] === 1;
    if (!f.sounding && !ls) return 0;
    if (f.sounding !== ls) return cfg.silenceCost;
    const o = j * 12;
    let dc = 0, don = 0, lo = 0, fo = 0;
    for (let q = 0; q < 12; q++) {
      dc += f.chroma[q] * L.chroma[o + q];
      don += f.onset[q] * L.onset[o + q];
      lo += L.onset[o + q];
      fo += f.onset[q];
    }
    let onsetDist;
    if (lo > 0 && fo > 0) onsetDist = 1 - don;
    else onsetDist = lo > 0 || fo > 0 ? 0.6 : 0;
    return (1 - cfg.onsetWeight) * (1 - dc) + cfg.onsetWeight * onsetDist;
  }

  push(frame) {
    if (this.status === "finished") return this.state();
    if (frame.sounding) this.silentRun = 0;
    else {
      this.silentRun++;
      // Before the music starts, and during real pauses, hold still
      if (this.status === "waiting" || this.silentRun > this.maxGap) return this.state();
    }
    if (this.status === "waiting") this.status = "following";

    const { D, next, M, cfg } = this;
    let best = Infinity, bestJ = 0;
    let hi;
    if (this.t === 0) {
      hi = Math.min(M - 1, Math.round(cfg.startWindow * FRAME_RATE));
      for (let j = 0; j <= hi; j++) {
        const v = this.cost(frame, j) + j * 0.002;
        next[j] = v;
        if (v < best) { best = v; bestJ = j; }
      }
    } else {
      hi = Math.min(M - 1, this.reach + 3);
      const lo = Math.max(0, this.position - Math.round(cfg.searchBack * FRAME_RATE));
      next.fill(Infinity, 0, lo);
      for (let j = lo; j <= hi; j++) {
        let b = D[j] + cfg.stayCost;
        if (j >= 1 && D[j - 1] < b) b = D[j - 1];
        if (j >= 2 && D[j - 2] + cfg.skip2Cost < b) b = D[j - 2] + cfg.skip2Cost;
        if (j >= 3 && D[j - 3] + cfg.skip3Cost < b) b = D[j - 3] + cfg.skip3Cost;
        if (b === Infinity) { next[j] = Infinity; continue; }
        const v = b + this.cost(frame, j);
        next[j] = v;
        if (v < best) { best = v; bestJ = j; }
      }
    }
    this.reach = hi;
    this.D = next;
    this.next = D;
    this.t++;
    this.position = bestJ;
    this.recentCost = this.t === 1 ? this.cost(frame, bestJ) : this.recentCost * 0.92 + 0.08 * this.cost(frame, bestJ);

    if (bestJ >= M - 1 - Math.round(0.2 * FRAME_RATE)) this.status = "finished";
    this.checkTurns();
    return this.state();
  }

  checkTurns() {
    const turns = this.lesson.turns;
    const finished = this.status === "finished";
    while (this.turnIndex < turns.length) {
      const t = turns[this.turnIndex];
      if (this.position >= t.frame - this.ahead || finished) {
        this.streak++;
        if ((this.streak >= 2 && !this.unsure) || finished) {
          this.turnIndex++;
          this.streak = 0;
          if (this.onTurn) this.onTurn(t.page, t);
          continue;
        }
      } else {
        this.streak = 0;
      }
      break;
    }
  }

  // The pianist turned a page by hand: skip any automatic turn that is due now or very soon
  manualTurn() {
    const turns = this.lesson.turns;
    while (this.turnIndex < turns.length && turns[this.turnIndex].frame <= this.position + 3 * this.ahead) this.turnIndex++;
  }

  get unsure() {
    return this.status === "following" && this.recentCost > this.cfg.unsureCost;
  }

  state() {
    return {
      status: this.status,
      unsure: this.unsure,
      position: this.position / FRAME_RATE,
      progress: this.M > 1 ? this.position / (this.M - 1) : 0,
      recentCost: this.recentCost,
      turnsDone: this.turnIndex,
    };
  }
}
