// Follows a performance through a taught piece and decides when to turn pages.
//
// A "lesson" is one earlier playthrough of the piece: its features (see features.js) plus the moments
// the pianist turned pages. While the piece is played again, two things work together:
//  - Tracking: every new frame of sound is matched against the lesson with online dynamic time warping.
//    For each moment of the lesson we keep the cost of the best way the performance could have arrived
//    there, allowing it to go slower or faster. The cheapest moment is where we think the pianist is.
//    When that passes a page turn, we turn.
//  - Searching (search.js): when we don't know where the pianist is (at the start, after a pause, or when
//    the tracking stops fitting), the last couple of seconds of playing are looked up in the whole piece.
//    If several places sound alike (a repeated section), the one on the page the pianist is looking at wins.
//    While tracking, the same search runs every half second to catch jumps to somewhere else.

import { FRAME_RATE } from "./features.js";
import { Searcher } from "./search.js";

export const FOLLOW_SETTINGS = {
  maxGap: 0.3, // seconds of silence kept; longer pauses are squeezed out of the lesson and ignored live
  stayCost: 0.05, // extra cost for the performance moving slower than the lesson
  skip2Cost: 0.02, // ... for moving up to 2x faster (cheaper, or the follower lags when you speed up)
  skip3Cost: 0.05, // ... for moving up to 3x faster
  silenceCost: 0.9, // cost of sound in one and silence in the other
  onsetWeight: 0.3, // how much "which notes were just struck" counts, versus "which notes sound"
  anticipation: 0.3, // seconds: turn this much before the moment the page was turned in the lesson
  unsureCost: 0.5, // recent match cost above which the follower is unsure and holds turns
  searchBack: 30, // seconds behind the current position still tracked (keeps long pieces light)
  // Practice: finding the pianist anywhere in the piece
  searchFactor: 4, // the search uses groups of this many frames
  pause: 1.0, // seconds of silence after which the pianist may restart anywhere
  queryLength: 2.5, // seconds of recent playing that are looked up
  minQuery: 1.2, // seconds of playing needed before looking up
  searchEvery: 0.25, // seconds between lookups while lost
  checkEvery: 0.5, // seconds between lookups while tracking (to catch jumps)
  separation: 3, // seconds: places closer than this count as the same place
  goodCost: 0.2, // a lookup result must be at least this good to be trusted (good matches are about 0.03–0.06)
  ambiguity: 1.12, // results within this ratio of the best count as equally good (e.g. a repeat) ...
  alikeMargin: 0.04, // ... or within this much of it: tiny differences between identical passages are noise
  jumpRatio: 0.7, // a jump needs a place this much better than where we think the pianist is ...
  jumpMargin: 0.03, // ... and better by at least this much (identical passages differ by about 0.015 at most)
  flipHint: 15, // seconds a page flip by the pianist counts as a hint of where they're about to play
  jumpDistance: 2, // seconds: closer than this is not a jump
  lostAfter: 1.5, // seconds of poor matching before looking up the whole piece again
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

// Which page was showing at each moment of the lesson
function pageTimeline(lesson) {
  const pages = new Int16Array(lesson.length);
  let page = lesson.startPage || 1, k = 0;
  for (let j = 0; j < lesson.length; j++) {
    while (k < lesson.turns.length && lesson.turns[k].frame <= j) page = lesson.turns[k++].page;
    pages[j] = page;
  }
  return pages;
}

export class Follower {
  // page: the page the pianist is looking at when following starts.
  // onTurn(page, why): show this page; why is "turn" (the music reached a page turn) or "jump"
  // (the pianist went somewhere else in the piece).
  constructor(lesson, { onTurn, page, settings = FOLLOW_SETTINGS } = {}) {
    const s = (seconds) => Math.max(1, Math.round(seconds * FRAME_RATE));
    this.lesson = lesson;
    this.cfg = settings;
    this.onTurn = onTurn;
    this.M = lesson.length;
    this.D = new Float64Array(this.M).fill(Infinity);
    this.next = new Float64Array(this.M).fill(Infinity);
    this.reach = 0;
    this.position = 0;
    this.status = "waiting"; // waiting -> searching <-> following (-> finished)
    this.recentCost = 0;
    this.turnIndex = 0;
    this.streak = 0;
    this.silentRun = 0;
    this.lostRun = 0;
    this.sinceLookup = 0;
    this.vote = null;
    this.expectJump = true; // right after a pause or a page flip, a jump needs less proof
    this.holdTurns = false; // after a pause, wait until we know whether the pianist went on or restarted
    this.recent = [];
    this.pageAt = pageTimeline(lesson);
    this.page = page || lesson.startPage || 1;
    this.searcher = new Searcher(lesson, settings);
    this.frames = {
      maxGap: s(settings.maxGap), pause: s(settings.pause), query: s(settings.queryLength), minQuery: s(settings.minQuery),
      searchEvery: s(settings.searchEvery), checkEvery: s(settings.checkEvery), jump: s(settings.jumpDistance),
      lost: s(settings.lostAfter), ahead: s(settings.anticipation), back: s(settings.searchBack), flip: s(settings.flipHint),
    };
    this.flip = null;
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
    const onsetDist = lo > 0 && fo > 0 ? 1 - don : lo > 0 || fo > 0 ? 0.6 : 0;
    return (1 - cfg.onsetWeight) * (1 - dc) + cfg.onsetWeight * onsetDist;
  }

  push(frame) {
    const F = this.frames;
    if (frame.sounding) {
      if (this.silentRun > F.pause) this.afterPause();
      this.silentRun = 0;
    } else {
      this.silentRun++;
      // Before the music starts, and during real pauses, hold still
      if (this.status === "waiting" || this.silentRun > F.maxGap) return this.state();
    }
    this.recent.push(frame);
    if (this.recent.length > F.query) this.recent.shift();
    if (this.flip && --this.flip.left <= 0) this.flip = null;
    if (this.status === "waiting") this.status = "searching";

    if (this.status === "following" || this.status === "finished") this.track(frame);
    this.sinceLookup++;
    if (this.status === "searching" && this.sinceLookup >= F.searchEvery) this.lookUp();
    else if (this.status === "following" && this.sinceLookup >= F.checkEvery) this.checkForJump();
    return this.state();
  }

  afterPause() {
    this.recent = []; // what was played before the pause may be from somewhere else
    this.expectJump = true;
    this.vote = null;
    if (this.status === "finished") this.status = "searching";
    if (this.status === "following") this.holdTurns = true;
  }

  // One step of dynamic time warping around the current position
  track(frame) {
    const { D, next, M, cfg, frames: F } = this;
    const hi = Math.min(M - 1, this.reach + 3);
    const lo = Math.max(0, this.position - F.back);
    next.fill(Infinity, 0, lo);
    let best = Infinity, bestJ = this.position;
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
    for (let j = hi + 1; j <= Math.min(M - 1, this.reach + 6); j++) next[j] = Infinity;
    this.reach = hi;
    this.D = next;
    this.next = D;
    this.position = bestJ;
    this.recentCost = this.recentCost * 0.92 + 0.08 * this.cost(frame, bestJ);

    if (this.status === "following") {
      if (this.recentCost > cfg.unsureCost) {
        if (++this.lostRun > F.lost) { this.status = "searching"; this.sinceLookup = F.searchEvery; }
      } else this.lostRun = 0;
      if (bestJ >= M - 1 - Math.round(0.2 * FRAME_RATE)) this.status = "finished";
    }
    this.checkTurns();
  }

  checkTurns() {
    const turns = this.lesson.turns;
    const finished = this.status === "finished";
    if ((this.holdTurns || this.unsure || this.status === "searching") && !finished) { this.streak = 0; return; }
    while (this.turnIndex < turns.length) {
      const t = turns[this.turnIndex];
      if (this.position >= t.frame - this.frames.ahead || finished) {
        if (++this.streak >= 2 || finished) {
          this.turnIndex++;
          this.streak = 0;
          this.show(t.page, "turn");
          continue;
        }
      } else this.streak = 0;
      break;
    }
  }

  show(page, why) {
    if (page === this.page) return;
    this.page = page;
    if (this.onTurn) this.onTurn(page, why);
  }

  // Choose among lookup results. Places that sound equally good (a repeated section) are told apart by
  // the page the pianist is looking at, then the nearest page, then the earliest place.
  choose(candidates) {
    if (!candidates.length || candidates[0].cost > this.cfg.goodCost) return null;
    const best = candidates[0];
    const limit = Math.max(best.cost * this.cfg.ambiguity, best.cost + this.cfg.alikeMargin);
    const alike = candidates.filter((c) => c.cost <= limit);
    if (alike.length === 1) return best;
    const away = (c) => Math.abs(this.pageAt[c.frame] - this.page);
    return alike.sort((a, b) => away(a) - away(b) || a.frame - b.frame)[0];
  }

  enoughToLookUp() {
    let sounding = 0;
    for (const f of this.recent) if (f.sounding) sounding++;
    return sounding >= this.frames.minQuery;
  }

  // We don't know where the pianist is: look up the recent playing in the whole piece
  lookUp() {
    this.sinceLookup = 0;
    if (!this.enoughToLookUp()) return;
    const pick = this.choose(this.searcher.search(this.recent).candidates);
    if (pick) this.moveTo(pick.frame);
  }

  // We think we know where the pianist is: check that nowhere else fits much better
  checkForJump() {
    this.sinceLookup = 0;
    if (!this.enoughToLookUp()) return;
    const F = this.frames, cfg = this.cfg;
    const { candidates, row } = this.searcher.search(this.recent);
    const pick = this.choose(candidates);
    if (!pick) { this.vote = null; return; }
    const here = this.searcher.costNear(row, this.position, F.jump);
    if (Math.abs(pick.frame - this.position) <= F.jump) {
      // the best fit is where we already are: the pianist went on from there
      this.vote = null;
      this.holdTurns = false;
      this.expectJump = false;
      return;
    }
    // The pianist flipped to a page we didn't think they were on, and the music fits there: go there
    if (this.flip && this.pageAt[pick.frame] === this.flip.page && this.pageAt[this.position] !== this.flip.page) {
      this.moveTo(pick.frame);
      return;
    }
    if (pick.cost >= cfg.jumpRatio * here || here - pick.cost < cfg.jumpMargin) {
      this.vote = null;
      if (here <= candidates[0].cost + cfg.alikeMargin) {
        // where we are fits as well as anywhere (a repeated passage): carry on
        this.holdTurns = false;
        this.expectJump = false;
      }
      return;
    }
    const same = this.vote && Math.abs(this.vote.frame - pick.frame) < 2 * F.jump;
    this.vote = { frame: pick.frame, count: same ? this.vote.count + 1 : 1 };
    if (this.vote.count >= (this.expectJump ? 1 : 2)) this.moveTo(pick.frame);
  }

  // Start tracking from lesson frame j (after a lookup), and show the page that goes with it
  moveTo(j) {
    this.D.fill(Infinity);
    this.next.fill(Infinity);
    this.D[j] = 0;
    this.reach = j;
    this.position = j;
    this.recentCost = 0.2;
    this.lostRun = 0;
    this.streak = 0;
    this.vote = null;
    this.expectJump = false;
    this.holdTurns = false;
    this.status = "following";
    this.flip = null;
    const turns = this.lesson.turns;
    this.turnIndex = turns.findIndex((t) => t.frame - this.frames.ahead > j);
    if (this.turnIndex < 0) this.turnIndex = turns.length;
    this.show(this.pageAt[j], "jump");
  }

  // The pianist turned a page by hand
  pianistTurned(page) {
    this.page = page;
    const turns = this.lesson.turns;
    // skip any automatic turn that is due now or very soon: the pianist took care of it
    while (this.turnIndex < turns.length && turns[this.turnIndex].frame <= this.position + 3 * this.frames.ahead) this.turnIndex++;
    // a flip away from where we think they are probably means they're about to play from there
    if (this.pageAt[this.position] !== page) {
      this.expectJump = true;
      this.flip = { page, left: this.frames.flip };
    }
  }

  get unsure() {
    return this.status === "following" && this.recentCost > this.cfg.unsureCost;
  }

  state() {
    return {
      status: this.status,
      unsure: this.unsure,
      page: this.page,
      position: this.position / FRAME_RATE,
      progress: this.M > 1 ? this.position / (this.M - 1) : 0,
      recentCost: this.recentCost,
    };
  }
}
