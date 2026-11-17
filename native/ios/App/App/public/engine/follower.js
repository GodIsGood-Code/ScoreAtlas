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
  scoreLead: 0.5, // seconds more for turns learned from sheet music: the eyes read ahead of the hands (owner, Test 8)
  farAgree: 1.2, // seconds that lookups must keep agreeing before a so-so match moves us to another page
  anchorTime: 30, // seconds a page the pianist turned to holds (renewed as they play on over page turns)
  anchorRatio: 0.6, // leaving that page needs a strong match this much better than the best place on it (owner, Test 13)
  unsureCost: 0.25, // recent match cost above which the follower is unsure and holds turns
  searchBack: 30, // seconds behind the current position still tracked (keeps long pieces light)
  // Practice: finding the pianist anywhere in the piece
  searchFactor: 4, // the search uses groups of this many frames
  pause: 1.0, // seconds of silence after which the pianist may restart anywhere
  queryLength: 2.5, // seconds of recent playing that are looked up
  minQuery: 0.8, // seconds of playing needed before looking up
  searchEvery: 0.15, // seconds between lookups while lost
  checkEvery: 0.5, // seconds between lookups while tracking (to catch jumps)
  separation: 3, // seconds: places closer than this count as the same place
  goodCost: 0.2, // a lookup result must be at least this good to be trusted (good matches are about 0.03–0.06)
  // Compared with how well a typical place in the piece fits (the "background"), real playing matches at under
  // about 0.2 of it and random playing at over about 0.5, whatever the room or piano
  goodRatio: 0.35, // a lookup result must stand out at least this much to be trusted ...
  strongRatio: 0.2, // ... and this much to be acted on at once (otherwise two lookups in a row must agree)
  turnRatio: 0.4, // before a page turn, the recent playing must match the music before it at least this well
  lostRatio: 0.5, // two checks in a row fitting worse than this (wrong notes fit better) mean the pianist is lost
  trackRatio: 0.3, // the tracker's own match versus a random moment of the piece: real playing is usually under 0.3
  holdRelease: 0.3, // seconds of good tracking after a pause that show the pianist went on from where they were
  // Sections learned from sheet music match real playing less closely than a taught playthrough (no pedal,
  // dynamics or timing in the written notes): real playing fits at about 0.35–0.6 of the background there,
  // random playing at about 0.65–0.9. The same checks, with these limits:
  score: { goodRatio: 0.6, strongRatio: 0.42, turnRatio: 0.65, lostRatio: 0.72, jumpMargin: 0.06, alikeMargin: 0.03, trackRatio: 0.55, tail: false },
  ambiguity: 1.12, // results within this ratio of the best count as equally good (e.g. a repeat) ...
  pageAmbiguity: 1.3, // ... and within this ratio, a copy on the page showing (or the next) still counts as the same music
  alikeMargin: 0.04, // ... or within this much of it: tiny differences between identical passages are noise
  jumpRatio: 0.7, // a jump needs a place this much better than where we think the pianist is ...
  jumpMargin: 0.03, // ... and better by at least this much (identical passages differ by about 0.015 at most)
  flipHint: 15, // seconds a page flip by the pianist counts as a hint of where they're about to play
  coverCost: 0.08, // re-teaching: a section's opening and ending must match this well to count as covered
  jumpDistance: 2, // seconds: closer than this is not a jump
  racePace: 1.2, // page turns wait while the tracking moves this much faster than the pianist's pace of the last seconds
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

// A piece can be taught in sections: each Teach adds one (a stretch of playing with its own page turns).
// A lesson is { version: 2, sections: [...] }. Lessons from Tests 3 and 4 are a single section.
export function sectionsOf(lesson) {
  if (!lesson) return [];
  return lesson.version >= 2 ? lesson.sections : [lesson];
}

// Add a newly taught section. Older sections whose music the new one fully covers are dropped,
// so re-teaching a passage replaces it.
export function addSection(lesson, section, settings = FOLLOW_SETTINGS) {
  const kept = sectionsOf(lesson).filter((old) => old.fromScore || !covers(section, old, settings));
  return { version: 2, sections: [...kept, section] };
}

// Does section `big` contain all of section `small`? Looks up small's opening and ending in big.
export function covers(big, small, settings = FOLLOW_SETTINGS) {
  const q = Math.round(settings.queryLength * FRAME_RATE);
  const frameAt = (j) => ({
    chroma: small.chroma.subarray(j * 12, j * 12 + 12),
    onset: small.onset.subarray(j * 12, j * 12 + 12),
    sounding: small.sound[j] === 1,
  });
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => frameAt(a + i));
  const searcher = new Searcher(flatten(big), settings);
  const find = (frames) => {
    const best = searcher.search(frames).candidates[0];
    return best && best.cost <= settings.coverCost ? best.frame : -1;
  };
  if (small.length <= 2 * q) return find(range(0, small.length)) >= 0;
  const head = find(range(0, q)), tail = find(range(small.length - q, small.length));
  if (head < 0 || tail < 0 || head >= tail) return false;
  // the stretch between them must be about as long as the old section (allowing for tempo)
  const ratio = (tail - head) / (small.length - q);
  return ratio > 0.4 && ratio < 2.5;
}

// All sections laid end to end, with what the follower needs to keep them apart
export function flatten(lesson) {
  const sections = sectionsOf(lesson);
  const length = sections.reduce((n, sec) => n + sec.length, 0);
  const flat = {
    length,
    chroma: new Float32Array(length * 12),
    onset: new Float32Array(length * 12),
    sound: new Uint8Array(length),
    pageAt: new Int16Array(length), // the page showing at each moment while teaching
    fromScore: new Uint8Array(length), // 1 where the section was learned from sheet music
    measure: new Int16Array(length).fill(-1), // the score measure being played (sheet-music sections only)
    played: new Int16Array(length).fill(-1), // ... and its place in the played order (repeats count twice)
    startOf: new Int32Array(length), // where each moment's section starts ...
    endOf: new Int32Array(length), // ... and ends (exclusive)
    starts: [],
    ends: [],
    turns: [],
    firstPage: sections.length ? sections[0].startPage || 1 : 1,
  };
  let at = 0;
  for (const sec of sections) {
    flat.chroma.set(sec.chroma, at * 12);
    flat.onset.set(sec.onset, at * 12);
    flat.sound.set(sec.sound, at);
    flat.startOf.fill(at, at, at + sec.length);
    if (sec.fromScore) flat.fromScore.fill(1, at, at + sec.length);
    if (sec.measure) flat.measure.set(sec.measure, at);
    if (sec.played) flat.played.set(sec.played, at);
    if (sec.layout) flat.layout = sec.layout; // where each score measure is on the page
    if (sec.order) flat.order = sec.order; // played-order index -> score measure
    flat.endOf.fill(at + sec.length, at, at + sec.length);
    flat.starts.push(at);
    flat.ends.push(at + sec.length);
    let page = sec.startPage || 1, k = 0;
    for (let j = 0; j < sec.length; j++) {
      while (k < sec.turns.length && sec.turns[k].frame <= j) page = sec.turns[k++].page;
      flat.pageAt[at + j] = page;
    }
    for (const t of sec.turns) flat.turns.push({ frame: at + Math.min(t.frame, sec.length - 1), page: t.page });
    at += sec.length;
  }
  flat.turns.sort((a, b) => a.frame - b.frame);
  return flat;
}

export class Follower {
  // page: the page the pianist is looking at when following starts.
  // onTurn(page, why): show this page; why is "turn" (the music reached a page turn) or "jump"
  // (the pianist went somewhere else in the piece).
  constructor(lesson, { onTurn, page, settings = FOLLOW_SETTINGS } = {}) {
    const s = (seconds) => Math.max(1, Math.round(seconds * FRAME_RATE));
    lesson = flatten(lesson);
    this.lesson = lesson;
    // A turn learned from sheet music never comes before the last bar of the old page has begun (the pianist must
    // still see that bar): the earliest moment for each turn, a fifth of a second into that bar
    for (const t of lesson.turns) {
      t.earliest = 0;
      if (!lesson.fromScore[t.frame]) continue;
      let j = t.frame;
      while (j > lesson.startOf[t.frame] && lesson.played[j - 1] === lesson.played[t.frame]) j--;
      t.earliest = Math.min(t.frame, j + Math.round(0.2 * FRAME_RATE));
    }
    this.cfg = settings;
    this.onTurn = onTurn;
    this.M = lesson.length;
    this.D = new Float64Array(this.M).fill(Infinity);
    this.next = new Float64Array(this.M).fill(Infinity);
    this.reach = 0;
    this.position = 0;
    this.status = "waiting"; // waiting -> searching <-> following
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
    this.pageAt = lesson.pageAt;
    this.page = page || lesson.firstPage;
    this.searcher = new Searcher(lesson, settings);
    this.frames = {
      maxGap: s(settings.maxGap), pause: s(settings.pause), query: s(settings.queryLength), minQuery: s(settings.minQuery),
      searchEvery: s(settings.searchEvery), checkEvery: s(settings.checkEvery), jump: s(settings.jumpDistance),
      lost: s(settings.lostAfter), ahead: s(settings.anticipation), back: s(settings.searchBack), flip: s(settings.flipHint),
      holdRelease: s(settings.holdRelease), scoreLead: s(settings.scoreLead || 0), farAgree: s(settings.farAgree),
      anchor: s(settings.anchorTime || 30),
    };
    this.flip = null;
    // the page on screen when following starts is where the pianist means to begin: it holds like a page they turned
    // to (the clock only runs while they play)
    if (page) this.anchor = { page, until: this.frames.anchor };
  }

  // The page the pianist turned to (in the last half minute, or played on from there): places on it or next to it are
  // fine; anywhere else must fit clearly better than the best place there (similar passages elsewhere are common)
  anchorOk(frame) {
    const a = this.anchor;
    return !a || (this.clock || 0) >= a.until || Math.abs(this.pageAt[frame] - a.page) <= 1;
  }
  anchorBest(row) {
    const a = this.anchor, se = this.searcher;
    let best = null;
    for (let c = 0; c < row.length; c++) {
      const f = se.endFrame[c];
      if (Math.abs(this.pageAt[f] - a.page) > 1) continue;
      if (!best || row[c] < best.cost) best = { frame: f, cost: row[c] };
    }
    return best;
  }
  // a move to `pick` that leaves the pianist's page: allowed only when strong and well ahead of the best there
  leavesAnchor(pick, row, background) {
    if (this.anchorOk(pick.frame)) return null;
    const best = this.anchorBest(row);
    const strong = pick.cost <= this.limits(pick.frame).strongRatio * background;
    if (strong && (!best || pick.cost <= this.cfg.anchorRatio * best.cost)) return null;
    return best || { frame: -1, cost: Infinity };
  }

  // How far ahead of a page turn's moment the page is turned, in lesson frames. The lead is meant in the pianist's
  // seconds, so it is scaled by their pace (lesson frames per live frame): playing slower than the lesson, the
  // same lead covers less of the lesson.
  aheadOf(t) {
    return (this.frames.ahead + (this.lesson.fromScore[t.frame] ? this.frames.scoreLead : 0)) * this.pace();
  }

  // Lesson frames per live frame over the last few seconds of tracking (1 until there's enough to tell)
  pace() {
    const tr = this.trail, n = tr ? tr.length : 0;
    if (n < 1.5 * FRAME_RATE) return 1;
    return Math.min(2, Math.max(0.5, (tr[n - 1] - tr[0]) / (n - 1)));
  }

  // The match limits for lesson frame j (sheet-music sections have their own)
  limits(j) {
    const c = this.cfg;
    if (j >= 0 && this.lesson.fromScore[j]) return { tail: true, ...c, ...c.score };
    return { goodRatio: c.goodRatio, strongRatio: c.strongRatio, turnRatio: c.turnRatio, lostRatio: c.lostRatio, jumpMargin: c.jumpMargin, alikeMargin: c.alikeMargin, trackRatio: c.trackRatio, tail: true };
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
    this.clock = (this.clock || 0) + 1;
    this.recent.push(frame);
    if (this.recent.length > F.query) this.recent.shift();
    if (this.flip && --this.flip.left <= 0) this.flip = null;
    if (this.status === "waiting") this.status = "searching";

    if (this.status === "following") this.track(frame);
    this.sinceLookup++;
    if (this.status === "searching" && this.sinceLookup >= F.searchEvery) this.lookUp();
    else if (this.status === "following" && this.sinceLookup >= F.checkEvery) this.checkForJump();
    return this.state();
  }

  afterPause() {
    this.recent = []; // what was played before the pause may be from somewhere else
    this.trail = []; // ... and the pace may be different
    this.expectJump = true;
    this.vote = null;
    if (this.status === "following") this.holdTurns = true;
  }

  // One step of dynamic time warping around the current position
  track(frame) {
    const { D, next, M, cfg, frames: F } = this;
    const startOf = this.lesson.startOf;
    const hi = Math.min(M - 1, this.reach + 3);
    const lo = Math.max(0, this.position - F.back);
    next.fill(Infinity, 0, lo);
    let best = Infinity, bestJ = this.position;
    for (let j = lo; j <= hi; j++) {
      // the path may not cross from one taught section into another
      const first = startOf[j];
      let b = D[j] + cfg.stayCost;
      if (j - 1 >= first && D[j - 1] < b) b = D[j - 1];
      if (j - 2 >= first && D[j - 2] + cfg.skip2Cost < b) b = D[j - 2] + cfg.skip2Cost;
      if (j - 3 >= first && D[j - 3] + cfg.skip3Cost < b) b = D[j - 3] + cfg.skip3Cost;
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
    (this.trail ||= []).push(bestJ); // recent positions, to notice the tracking racing ahead
    if (this.trail.length > 3 * FRAME_RATE) this.trail.shift();
    this.recentCost = this.recentCost * 0.92 + 0.08 * this.cost(frame, bestJ);
    // How well this sound fits a random moment of the piece (a yardstick for recentCost)
    let typical = 0;
    for (let k = 0; k < 8; k++) {
      this.seed = ((this.seed || 7) * 1103515245 + 12345) >>> 0;
      typical += this.cost(frame, this.seed % M);
    }
    this.typicalCost = this.typicalCost === undefined ? typical / 8 : this.typicalCost * 0.97 + 0.03 * (typical / 8);
    // A run of good tracking right after a pause shows the pianist went on from where they were
    this.goodRun = this.trackingWell() ? (this.goodRun || 0) + 1 : 0;
    if (this.holdTurns && this.goodRun >= this.frames.holdRelease) this.holdTurns = false;

    if (this.recentCost > cfg.unsureCost) {
      if (++this.lostRun > F.lost) {
        this.lostAt = { position: this.position, clock: this.clock };
        this.status = "searching";
        this.sinceLookup = F.searchEvery;
      }
    } else this.lostRun = 0;
    this.checkTurns();

    // End of a taught section: any turn left in it is due now; then look for the pianist again
    // (in the next section, if one was taught)
    const end = this.lesson.endOf[bestJ];
    if (this.status === "following" && bestJ >= end - 1 - Math.round(0.2 * FRAME_RATE)) {
      const turns = this.lesson.turns;
      while (this.turnIndex < turns.length && turns[this.turnIndex].frame < end) this.show(turns[this.turnIndex++].page, "turn");
      this.status = "searching";
      this.recent = [];
      this.sinceLookup = 0;
    }
  }

  checkTurns() {
    const turns = this.lesson.turns;
    if (this.holdTurns || this.unsure || this.status !== "following" || this.racing()) { this.streak = 0; return; }
    while (this.turnIndex < turns.length) {
      const t = turns[this.turnIndex];
      if (this.position >= Math.max(t.frame - this.aheadOf(t), t.earliest || 0)) {
        if (++this.streak >= 2 && this.confirmed()) {
          this.turnIndex++;
          this.streak = 0;
          this.show(t.page, "turn");
          continue;
        }
      } else this.streak = 0;
      break;
    }
  }

  // Has the tracking just raced ahead much faster than the pianist has been playing? (It can slide through a held
  // note or a passage it isn't sure of.) Then a page turn waits until the pace looks right again, or the tracking
  // comes back: common sense says a pianist doesn't suddenly play half again as fast.
  racing() {
    const tr = this.trail, n = tr ? tr.length : 0, sec = FRAME_RATE;
    if (n < 3 * sec) return false;
    const base = tr[n - 1 - sec];
    const pace = Math.min(2.5, Math.max(0.5, (base - tr[0]) / (n - 1 - sec)));
    return tr[n - 1] > base + sec * pace * this.cfg.racePace + 5;
  }

  // Before turning: do the last couple of seconds really sound like the music leading up to this point?
  // (Random playing can drift the tracking along; it never matches this well.) Checked at most every 0.15 s.
  confirmed() {
    if (this.trackingWell()) return true;
    if (this.verdict && this.verdict.until > this.clock) return this.verdict.ok;
    let ok = true;
    if (this.enoughToLookUp()) {
      const { row, background } = this.searcher.search(this.recent);
      ok = this.searcher.costNear(row, this.position, this.frames.jump) <= this.limits(this.position).turnRatio * background;
    }
    this.verdict = { ok, until: this.clock + this.frames.searchEvery };
    return ok;
  }

  // Is the tracker's own frame-by-frame match clearly better than a random moment of the piece?
  trackingWell() {
    return this.typicalCost > 0 && this.recentCost <= this.limits(this.position).trackRatio * this.typicalCost;
  }

  show(page, why) {
    if (page === this.page) return;
    this.page = page;
    // playing on over a page turn keeps the pianist's page choice in force, on the new page
    const now = this.clock || 0;
    if (why === "turn" && this.anchor && now < this.anchor.until) this.anchor = { page, until: now + this.frames.anchor, seen: true };
    // found elsewhere after playing on the anchor's page: the pianist has moved on (the anchor only guards the page
    // they meant to start from, or turned to, until the music has been heard there)
    if (why === "jump" && this.anchor && this.anchor.seen && Math.abs(page - this.anchor.page) > 1) this.anchor = null;
    if (this.onTurn) this.onTurn(page, why);
  }

  // Choose among lookup results. Places that sound equally good (a repeated section) are told apart by
  // the page the pianist is looking at, or the page next to it.
  choose(candidates, background) {
    if (!candidates.length) return null;
    const best = candidates[0];
    if (best.cost > this.cfg.goodCost || best.cost > this.limits(best.frame).goodRatio * background) return null;
    const limit = Math.max(best.cost * this.cfg.ambiguity, best.cost + this.limits(best.frame).alikeMargin);
    // Common sense: a copy of this music on the page showing (or the next) wins even when it fits a little less
    // well than one further away; small differences between copies are mostly noise
    const wide = Math.max(best.cost * this.cfg.pageAmbiguity, best.cost + 2 * this.limits(best.frame).alikeMargin);
    const onPage = candidates.filter((c) => c.cost <= wide && c.cost <= this.limits(c.frame).goodRatio * background && c.cost <= this.cfg.goodCost);
    const alike = candidates.filter((c) => c.cost <= limit || (onPage.includes(c) && Math.abs(this.pageAt[c.frame] - this.page) <= 1));
    if (alike.length === 1) return best;
    // Music that sounds the same in several places only moves us to one on the page the pianist is looking at,
    // or else the page next to it (going back over a page turn is common), earlier first. Further away they may be
    // playing a copy that was never taught; if they really jumped there, they'll flip the page.
    // Among those, the place just ahead of where we think the pianist is (or was, just before we lost them) comes
    // first, since they usually go on; after a pause, the nearest place behind; then the earliest
    // After a pause the pianist more often goes back (to repeat something): then the nearest place behind comes first
    const from = this.status === "following" ? this.position : this.lostAt ? this.lostAt.position : -1;
    const ahead = (c) => {
      if (from < 0) return Infinity;
      const d = c.frame - from;
      if (this.expectJump) return d <= this.frames.jump ? -d : 1e6 + d;
      return d >= -this.frames.jump ? d : Infinity;
    };
    // Once a lookup has picked one of the copies, later lookups stay with it while it still fits (otherwise the
    // pick could flicker between copies and never settle)
    const vote = this.farVote || this.pending;
    const cont = (c) => (vote && Math.abs(c.frame - (vote.frame + this.clock - vote.clock)) <= this.frames.jump ? 0 : 1);
    for (const distance of [0, 1]) {
      const near = alike.filter((c) => Math.abs(this.pageAt[c.frame] - this.page) === distance);
      if (near.length) return near.sort((a, b) => cont(a) - cont(b) || ahead(a) - ahead(b) || a.frame - b.frame)[0];
    }
    // None on or next to the page showing: the pianist jumped without turning the page. The earliest copy is the
    // best guess (moving there still takes lookups agreeing for a while; a page flip corrects it at once)
    return alike.sort((a, b) => cont(a) - cont(b) || a.frame - b.frame)[0];
  }

  // The best place for the last moment of playing within a few seconds after where the pianist was lost, if it fits
  // well; else null
  nearLost() {
    const F = this.frames;
    const tail = this.recent.slice(-F.minQuery);
    let sounding = 0;
    for (const f of tail) if (f.sounding) sounding++;
    if (sounding < 0.75 * F.minQuery) return null;
    const { row, background } = this.searcher.search(tail);
    if (!row) return null;
    const at = this.lostAt.position, se = this.searcher;
    const c0 = se.coarseIndex(Math.max(this.lesson.startOf[at], at - FRAME_RATE));
    const c1 = se.coarseIndex(Math.min(this.lesson.endOf[at] - 1, at + 5 * FRAME_RATE));
    let best = -1;
    for (let c = c0; c <= c1; c++) if (best < 0 || row[c] < row[best]) best = c;
    if (best < 0) return null;
    const frame = se.endFrame[best];
    return row[best] <= this.limits(frame).goodRatio * background && row[best] <= this.cfg.goodCost ? frame : null;
  }

  enoughToLookUp() {
    let sounding = 0;
    for (const f of this.recent) if (f.sounding) sounding++;
    return sounding >= this.frames.minQuery;
  }

  // We don't know where the pianist is: look up the recent playing in the whole piece
  lookUp() {
    if (!this.enoughToLookUp()) return;
    this.sinceLookup = 0;
    let { candidates, background, row } = this.searcher.search(this.recent);
    this.lastSearch = { row, background };
    let pick = this.choose(candidates, background);
    let strong = pick && candidates[0].cost <= this.limits(candidates[0].frame).strongRatio * background;
    if (!strong && this.recent.length > this.frames.minQuery && (!pick || this.limits(pick.frame).tail)) {
      // The older part of what we heard may be something else (noodling just before): try the last moment alone
      const tail = this.searcher.search(this.recent.slice(-this.frames.minQuery));
      const tailPick = this.choose(tail.candidates, tail.background);
      if (tailPick && this.limits(tailPick.frame).tail && tail.candidates[0].cost <= this.cfg.strongRatio * tail.background) {
        ({ candidates, background } = tail);
        this.lastSearch = { row: tail.row, background: tail.background };
        pick = tailPick;
        strong = true;
      }
    }
    // Just lost the pianist? The last moment alone, compared with the few bars right after where they were, often
    // settles it sooner (what came before may be a long held chord or a hesitation the lesson doesn't have)
    if (!strong && this.lostAt && this.clock - this.lostAt.clock < 10 * FRAME_RATE) {
      const near = this.nearLost();
      if (near) {
        const nv = this.nearVote;
        const agrees = nv && Math.abs(near - (nv.frame + this.clock - nv.clock)) <= this.frames.jump;
        this.nearVote = { frame: near, clock: this.clock };
        if (agrees) { this.moveTo(near); return; }
      } else this.nearVote = null;
    }
    if (!pick) { this.pending = null; return; }
    {
      const lookup = this.lastSearch;
      const stay = lookup ? this.leavesAnchor(pick, lookup.row, lookup.background) : null;
      if (stay) {
        // the place on the pianist's page, if it fits well enough; otherwise wait
        if (stay.frame >= 0 && stay.cost <= this.limits(stay.frame).goodRatio * background && stay.cost <= this.cfg.goodCost) {
          pick = { frame: stay.frame, cost: stay.cost };
          strong = stay.cost <= this.limits(stay.frame).strongRatio * background;
        } else { this.pending = null; return; }
      }
    }
    // Just lost the pianist? They most likely picked up where they were (playing something else doesn't move
    // them through the piece): prefer the good place closest to there, unless somewhere else fits clearly better
    if (this.lostAt && this.clock - this.lostAt.clock < 20 * FRAME_RATE) {
      const at = this.lostAt.position, reach = 3 * FRAME_RATE;
      const near = candidates
        .filter((c) => Math.abs(c.frame - at) <= reach && c.cost <= this.limits(c.frame).goodRatio * background && c.cost <= this.cfg.goodCost)
        .sort((x, y) => Math.abs(x.frame - at) - Math.abs(y.frame - at))[0];
      if (near && near !== pick && !(pick.cost < this.cfg.jumpRatio * near.cost && near.cost - pick.cost >= this.limits(pick.frame).jumpMargin)) {
        pick = near;
        strong = near.cost <= this.limits(near.frame).strongRatio * background;
      }
    }
    // Common sense: a so-so match may move us within the page on screen, but going to another page takes a strong
    // match (or a page flip by the pianist), since a look-alike passage on another page is more likely than a jump
    // (After a pause a restart is expected, and going back over a page turn is common: the next page either way is fine.)
    const pageGap = Math.abs(this.pageAt[pick.frame] - this.page);
    const otherPage = pageGap > 0 && !(this.flip && this.pageAt[pick.frame] === this.flip.page) && !(this.expectJump && pageGap === 1);
    if (otherPage && !strong) {
      // ... unless lookups keep agreeing on that place for a while: then the pianist really is there (they jumped
      // without turning to the page)
      const fv = this.farVote, F = this.frames;
      const agreesFar = fv && Math.abs(pick.frame - (fv.frame + (this.clock - fv.clock))) <= F.jump;
      this.farVote = { frame: pick.frame, clock: this.clock, since: agreesFar ? fv.since : this.clock };
      this.pending = null;
      if (agreesFar && this.clock - this.farVote.since >= F.farAgree && pick.cost <= this.limits(pick.frame).goodRatio * background) this.moveTo(pick.frame);
      return;
    }
    this.farVote = null;
    const agrees = this.pending && Math.abs(this.pending.frame - pick.frame) <= this.frames.jump;
    if (strong || agrees) this.moveTo(pick.frame);
    else this.pending = { ...pick, clock: this.clock };
  }

  // We think we know where the pianist is: check that nowhere else fits much better
  checkForJump() {
    this.sinceLookup = 0;
    if (!this.enoughToLookUp()) return;
    const F = this.frames, cfg = this.cfg;
    const { candidates, row, background } = this.searcher.search(this.recent);
    const pick = this.choose(candidates, background);
    const here = this.searcher.costNear(row, this.position, F.jump);
    // Two checks in a row where what we hear doesn't fit where we are (or anywhere): we've lost the pianist
    // (if the tracker's own frame-by-frame match is good, we haven't lost anyone, whatever this slower check says)
    this.misfit = here <= this.limits(this.position).lostRatio * background || this.trackingWell() ? 0 : (this.misfit || 0) + 1;
    if (this.misfit >= 2) {
      this.misfit = 0;
      this.lostAt = { position: this.position, clock: this.clock };
      this.status = "searching";
      this.sinceLookup = F.searchEvery;
      return;
    }
    if (!pick) { this.vote = null; return; }
    // Back to the pianist's page: we're following a copy of this music elsewhere while the same music on the page
    // they turned to (or started from) fits about as well
    const a = this.anchor;
    if (a && (this.clock || 0) < a.until && Math.abs(this.pageAt[this.position] - a.page) > 1) {
      const best = this.anchorBest(row);
      if (best && best.cost <= this.limits(best.frame).goodRatio * background && best.cost <= cfg.pageAmbiguity * Math.min(here, candidates[0].cost)) {
        this.moveTo(best.frame);
        return;
      }
    }
    // Common sense: while what we hear still fits where we are, the pianist is there, however well some copy of
    // the music elsewhere fits (refrains); only a page flip by the pianist overrides that
    if (this.trackingWell() && this.anchor && Math.abs(this.pageAt[this.position] - this.anchor.page) <= 1) this.anchor.seen = true;
    if (this.trackingWell() && !(this.flip && this.pageAt[this.position] !== this.flip.page)) {
      this.vote = null;
      this.holdTurns = false;
      this.expectJump = false;
      return;
    }
    if (this.leavesAnchor(pick, row, background)) { this.vote = null; return; }
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
    if (pick.cost >= cfg.jumpRatio * here || here - pick.cost < this.limits(pick.frame).jumpMargin) {
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
    const strong = pick.cost <= this.limits(pick.frame).strongRatio * background;
    if (this.vote.count >= (this.expectJump && strong ? 1 : 2)) this.moveTo(pick.frame);
  }

  // Start tracking from lesson frame j (after a lookup), and show the page that goes with it
  moveTo(j) {
    this.moves = (this.moves || 0) + 1; // lets the measure highlight follow a jump at once
    this.D.fill(Infinity);
    this.next.fill(Infinity);
    this.D[j] = 0;
    this.reach = j;
    this.position = j;
    this.trail = [];
    this.recentCost = 0.2;
    this.lostRun = 0;
    this.streak = 0;
    this.vote = null;
    this.expectJump = false;
    this.holdTurns = false;
    this.status = "following";
    this.flip = null;
    this.pending = null;
    this.farVote = null;
    this.nearVote = null;
    this.verdict = null;
    this.misfit = 0;
    this.lostAt = null;
    const turns = this.lesson.turns;
    this.turnIndex = turns.findIndex((t) => t.frame - this.aheadOf(t) > j);
    if (this.turnIndex < 0) this.turnIndex = turns.length;
    this.show(this.pageAt[j], "jump");
  }

  // The pianist turned a page by hand
  pianistTurned(page) {
    this.page = page;
    // the pianist has shown us where they are: stay on that page (or next to it) unless the music clearly says otherwise
    this.anchor = { page, until: this.clock + this.frames.anchor };
    const turns = this.lesson.turns;
    // skip any automatic turn that is due now or very soon: the pianist took care of it
    while (this.turnIndex < turns.length && turns[this.turnIndex].frame <= this.position + 3 * this.aheadOf(turns[this.turnIndex])) this.turnIndex++;
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
      // how far through the taught section the pianist is in
      progress: (this.position - this.lesson.startOf[this.position]) / Math.max(1, this.lesson.endOf[this.position] - this.lesson.startOf[this.position] - 1),
      recentCost: this.recentCost,
    };
  }
}
