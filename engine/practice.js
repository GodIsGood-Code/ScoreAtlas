// Practice insights from a Follow session with sheet music: which bars were played most, where the pianist hesitated
// (stopped and went back, paused, or took much longer than the bars around), the tempo bar by bar, and repetitions
// of a looped passage with the tempo of each.
//
// During the session it keeps, for every live frame, what was heard and where the follower placed it. The report
// cuts the session into runs (stretches played straight through) and, for exact bar times, lines each run up with
// the lesson again afterwards, seeing the whole run at once (much steadier than the moment-to-moment follower).

export const PRACTICE_SETTINGS = {
  pause: 0.8, // seconds of silence inside a bar that count as a pause
  slower: 1.6, // a bar taking this many times as long per beat as the bars around it is a hesitation
  minRun: 4, // bars with a tempo in a row that make a run worth graphing
  band: 1.5, // seconds: the after-the-fact alignment stays this close to where the follower was
  lostGap: 1.5, // seconds without a position that end a run
  back: 2, // seconds: moving back further than this starts a new run
};

const RATE = 50; // frames per second (see features.js)

export class PracticeLog {
  // lesson: the follower's (flattened) lesson, with `played` per frame (-1 outside sheet music); order: played index ->
  // measure index; measures: the score's measures; cost(frame, j): how badly a live frame fits lesson frame j
  constructor(lesson, order, measures, cost, settings = PRACTICE_SETTINGS) {
    Object.assign(this, { lesson, order, measures, cost, cfg: settings });
    this.n = 0;
    this.size = 0;
    this.grow(4096);
    this.loop = null;
    // first lesson frame of each played bar
    this.firstFrame = new Int32Array(order.length).fill(-1);
    for (let j = 0; j < lesson.length; j++) {
      const p = lesson.played[j];
      if (p >= 0 && p < order.length && this.firstFrame[p] < 0) this.firstFrame[p] = j;
    }
  }

  grow(size) {
    const more = (old, n) => { const a = new old.constructor(n); if (this.n) a.set(old.subarray(0, Math.min(old.length, n))); return a; };
    this.time = more(this.time || new Float64Array(0), size);
    this.sound = more(this.sound || new Uint8Array(0), size);
    this.pos = more(this.pos || new Int32Array(0), size);
    this.moves = more(this.moves || new Int32Array(0), size);
    this.chroma = more(this.chroma || new Float32Array(0), size * 12);
    this.onset = more(this.onset || new Float32Array(0), size * 12);
    this.size = size;
  }

  // Every live frame: position = the follower's lesson frame when it's sure of the pianist, else -1; moves = its
  // count of jumps (a jump starts a new run)
  record(frame, position, moves) {
    if (this.n >= 60 * 60 * RATE) return; // an hour is plenty
    if (this.n === this.size) this.grow(this.size * 2);
    const i = this.n++;
    this.time[i] = frame.time;
    this.chroma.set(frame.chroma, i * 12);
    this.onset.set(frame.onset, i * 12);
    this.sound[i] = frame.sounding ? 1 : 0;
    this.pos[i] = position >= 0 && this.lesson.played[position] >= 0 ? position : -1;
    this.moves[i] = moves;
  }

  frameAt(i) {
    return { chroma: this.chroma.subarray(i * 12, i * 12 + 12), onset: this.onset.subarray(i * 12, i * 12 + 12), sounding: this.sound[i] === 1 };
  }

  quarters(p) { return Math.max(0.25, this.measures[this.order[p]].quarters || 4); }

  barFrames(p) {
    const a = this.firstFrame[p];
    let b = p + 1 < this.firstFrame.length ? this.firstFrame[p + 1] : -1;
    if (b < 0) b = this.lesson.length;
    return Math.max(1, b - a);
  }

  // A loop over played bars from..to (inclusive); null clears it
  setLoop(from, to) {
    this.loop = from === null || from === undefined ? null : { from: Math.min(from, to), to: Math.max(from, to) };
  }

  // Stretches played straight through: [{ i0, i1 }] (live frames)
  runs() {
    const out = [], gap = this.cfg.lostGap * RATE, played = this.lesson.played;
    let cur = null;
    for (let i = 0; i < this.n; i++) {
      const p = this.pos[i];
      if (p < 0) { if (cur && i - cur.i1 > gap) { out.push(cur); cur = null; } continue; }
      // a jump by the follower starts a new run, unless it only corrected itself (landing about where it was)
      // (the follower also steps back a second or so now and then when it corrects itself: going back further than
      // `back` is the pianist going back; a one-bar stumble shows up as a slow bar instead)
      const back = this.cfg.back * RATE;
      const jumped = cur && this.moves[i] !== cur.moves && (p < cur.maxP - back || p > cur.maxP + 3 * RATE);
      if (cur && (jumped || p < cur.maxP - back)) { out.push(cur); cur = null; }
      if (!cur) cur = { i0: i, i1: i, moves: this.moves[i], maxP: p };
      cur.moves = this.moves[i];
      cur.i1 = i;
      cur.maxP = Math.max(cur.maxP, p);
    }
    if (cur) out.push(cur);
    return out;
  }

  // The lesson frame for each live frame of a run: the follower's own (carried over moments it wasn't sure, never
  // going backwards), or, refined, the best path within `band` of it, found with the whole run in view
  path(run, refine) {
    const len = run.i1 - run.i0 + 1;
    const online = new Int32Array(len);
    let last = this.pos[run.i0];
    for (let k = 0; k < len; k++) { const p = this.pos[run.i0 + k]; if (p >= 0) last = p; online[k] = last; }
    for (let k = 1; k < len; k++) if (online[k] < online[k - 1]) online[k] = online[k - 1];
    if (!refine) return online;
    const W = Math.round(this.cfg.band * RATE), B = 2 * W + 1, M = this.lesson.length, played = this.lesson.played;
    const dir = new Uint8Array(len * B);
    let prev = new Float64Array(B), cur = new Float64Array(B);
    for (let k = 0; k < len; k++) {
      const f = this.frameAt(run.i0 + k);
      const base = online[k] - W, prevBase = k ? online[k - 1] - W : 0;
      cur.fill(Infinity);
      for (let b = 0; b < B; b++) {
        const j = base + b;
        if (j < 0 || j >= M || played[j] < 0) continue;
        const c = this.cost(f, j);
        if (k === 0) { cur[b] = c; continue; } // a run may begin anywhere near where the follower put it
        let best = Infinity, d = 0;
        const pb = j - prevBase; // this lesson frame's place in the previous row
        if (pb - 1 >= 0 && pb - 1 < B && prev[pb - 1] < best) { best = prev[pb - 1]; d = 1; }
        if (pb >= 0 && pb < B && prev[pb] + 0.02 < best) { best = prev[pb] + 0.02; d = 2; }
        if (b > 0 && cur[b - 1] + 0.02 < best) { best = cur[b - 1] + 0.02; d = 3; }
        if (best === Infinity) continue;
        cur[b] = best + c;
        dir[k * B + b] = d;
      }
      [prev, cur] = [cur, prev];
    }
    let bEnd = -1;
    for (let b = 0; b < B; b++) if (Number.isFinite(prev[b]) && (bEnd < 0 || prev[b] < prev[bEnd])) bEnd = b;
    if (bEnd < 0) return online;
    const out = new Int32Array(len).fill(-1);
    let k = len - 1, b = bEnd;
    for (;;) {
      const j = online[k] - W + b;
      out[k] = j; // walking back, the last write for a row is the first lesson frame it reached
      const d = dir[k * B + b];
      if (k === 0 || d === 0) break;
      if (d === 3) { b--; continue; }
      const pb = j - (online[k - 1] - W);
      k--;
      b = d === 1 ? pb - 1 : pb;
    }
    for (let q = 0; q < len; q++) if (out[q] < 0) out[q] = q ? out[q - 1] : online[0];
    for (let q = 1; q < len; q++) if (out[q] < out[q - 1]) out[q] = out[q - 1];
    return out;
  }

  // Everything so far. refine: line each run up again for exact bar times (slower; for the end of a session).
  report({ refine = true } = {}) {
    const L = this.lesson, cfg = this.cfg, ff = this.firstFrame;
    const plays = new Map(), hes = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const runs = this.runs().map((run) => {
      const path = this.path(run, refine);
      let iEnd = run.i1; // the run ends when the sound does
      while (iEnd > run.i0 && !this.sound[iEnd]) iEnd--;
      const last = iEnd - run.i0;
      const startBar = L.played[path[0]], endBar = L.played[path[last]];
      const entry = new Map(); // played bar -> live time it began
      if (path[0] - ff[startBar] <= 0.25 * this.barFrames(startBar)) entry.set(startBar, this.time[run.i0]);
      let k = 0;
      for (let p = startBar + 1; p <= endBar; p++) {
        while (k <= last && path[k] < ff[p]) k++;
        if (k <= last) entry.set(p, this.time[run.i0 + k]);
      }
      const endTime = this.time[iEnd];
      const endDone = path[last] - ff[endBar] >= 0.75 * this.barFrames(endBar);
      const bars = [];
      for (let p = startBar; p <= endBar; p++) {
        const t0 = entry.has(p) ? entry.get(p) : null;
        const t1 = entry.has(p + 1) ? entry.get(p + 1) : p === endBar && endDone ? endTime : null;
        const seconds = t0 !== null && t1 !== null ? t1 - t0 : null;
        let pause = 0; // the longest silence inside the bar
        if (seconds !== null) {
          let s = 0;
          for (let i = run.i0; i <= iEnd; i++) {
            if (this.time[i] < t0 || this.time[i] >= t1) continue;
            s = this.sound[i] ? 0 : s + 1;
            if (s / RATE > pause) pause = s / RATE;
          }
        }
        const through = entry.has(p) && entry.has(p + 1);
        bars.push({ played: p, measure: this.order[p], t0, t1, seconds, tempo: through && seconds > 0 ? (this.quarters(p) * 60) / seconds : null, pause, hesitation: null });
      }
      // a bar far faster than the run's usual pace is an alignment slip at the run's edge, not playing
      const tempos = bars.map((b) => b.tempo).filter(Boolean).sort((x, y) => x - y);
      const usual = tempos.length ? tempos[Math.floor(tempos.length / 2)] : 0;
      for (const b of bars) if (b.tempo && b.tempo > 2.2 * usual) { b.tempo = null; b.seconds = null; }
      return { bars, startBar, endBar };
    });
    const lastBar = this.order.length - 1, Lp = this.loop;
    runs.forEach((r, ri) => {
      for (const b of r.bars) bump(plays, b.measure);
      r.bars.forEach((b, i) => {
        if (b.pause >= cfg.pause && b.played < r.endBar) b.hesitation = "paused";
        else if (b.tempo) {
          const around = r.bars.slice(Math.max(0, i - 3), i + 4).filter((x) => x !== b && x.tempo);
          if (around.length >= 2) {
            const perBeat = around.map((x) => x.seconds / this.quarters(x.played)).sort((p, q) => p - q)[Math.floor(around.length / 2)];
            if (b.seconds / this.quarters(b.played) > cfg.slower * perBeat) b.hesitation = "slow";
          }
        }
      });
      // stopped and went back: the next run starts at or before the bar this one stopped in (not at the end of the
      // piece, and not at the end of the loop being practised)
      const next = runs[ri + 1];
      if (next && r.endBar < lastBar && next.startBar <= r.endBar && !(Lp && r.endBar === Lp.to)) r.bars[r.bars.length - 1].hesitation = "went back";
      for (const b of r.bars) if (b.hesitation) bump(hes, b.measure);
    });
    // loop repetitions: runs that go from the start of the loop's first bar through its last
    const loopReps = [];
    if (Lp) {
      let q = 0;
      for (let p = Lp.from; p <= Lp.to; p++) q += this.quarters(p);
      for (const r of runs) {
        const a = r.bars.find((b) => b.played === Lp.from), z = r.bars.find((b) => b.played === Lp.to);
        if (!a || !z || a.t0 === null || z.t1 === null) continue;
        const seconds = z.t1 - a.t0;
        if (seconds > 0.3) loopReps.push({ t0: a.t0, t1: z.t1, seconds, tempo: (q * 60) / seconds });
      }
    }
    const longRuns = runs.filter((r) => r.bars.filter((b) => b.tempo).length >= cfg.minRun).map((r) => r.bars);
    let longest = null;
    for (const r of longRuns) if (!longest || r.length > longest.length) longest = r;
    return {
      seconds: this.n ? this.time[this.n - 1] - this.time[0] : 0,
      plays, // measure -> times played
      hesitations: hes, // measure -> times hesitated
      bars: runs.flatMap((r) => r.bars), // { played, measure, t0, t1, seconds, tempo, pause, hesitation }
      runs: longRuns,
      longest,
      loop: Lp,
      loopReps,
    };
  }
}

// Groups of neighbouring measures played about equally often (at least twice): [{ from, to, count }] (measure
// indices), most first
export function busiestPassages(plays, measureCount, top = 3) {
  const out = [];
  let i = 0;
  while (i < measureCount) {
    const c = plays.get(i) || 0;
    if (c < 2) { i++; continue; }
    let j = i;
    while (j + 1 < measureCount && (plays.get(j + 1) || 0) >= Math.max(2, c - 1) && (plays.get(j + 1) || 0) <= c + 1) j++;
    let sum = 0;
    for (let k = i; k <= j; k++) sum += plays.get(k) || 0;
    out.push({ from: i, to: j, count: Math.round(sum / (j - i + 1)) });
    i = j + 1;
  }
  return out.sort((a, b) => b.count - a.count || b.to - b.from - (a.to - a.from)).slice(0, top);
}
