// Wrong-note detection: the notes a note-recognition model heard in a recording (Spotify's Basic Pitch, see
// pitch.js), compared with the notes written in the sheet music, bar by bar.
//
// The model hears nearly every note played, but it also reports extras that weren't played (overtones an octave up,
// echoes of held notes) and can miss very soft notes, so the check leans on what's dependable:
//   missed: a written note with no matching note heard near its time (the time following the playing's own timing,
//           an octave off or a quick repeat of a held note forgiven, softly played notes heard less strictly accepted);
//   wrong:  a missed note where a clearly played note that isn't written (and isn't an echo or overtone of what is
//           written there) was heard instead: "played F instead of E".
// Extra notes on their own are not reported.

// How sure the note-recognition model must be to report a note (pitch.js, tools/basic_pitch_node.mjs): the start of
// a note (onset), the note sounding (frame), and the shortest note in model frames (about 11.6 ms each). The notes
// heard less strictly (soft*) only count as softly played written notes (checkNotes step 1e), never as wrong ones.
export const PITCH_SETTINGS = { onset: 0.4, frame: 0.3, minFrames: 5, softOnset: 0.25, softFrame: 0.25 };

export const NOTECHECK_SETTINGS = {
  window: 0.15, // seconds either side of a note's expected time a heard note may be
  windowShare: 0.1, // ... or this share of the bar's length, if longer (slow bars, rubato)
  loud: 0.35, // a heard note must be at least this strong (model amplitude) to count as a wrong note played
  lowest: 36, // notes below the C two octaves below middle C aren't checked (a microphone hardly hears them)
  unsureShare: 0.6, // a bar with more than this share of its notes missing is left out (timing, not playing)
  heldWithin: 0.3, // a note struck this long before and still sounding past the note's time by heldPast counts as
  heldPast: 0.3, // played: the model merges quick repeats of a held note
  chord: 0.07, // heard notes starting within this of each other are one chord (for lining up)
  reach: 0.8, // a written chord may line up with a heard chord at most this far from its expected time
  timeFree: 0.08, // ... free up to this far, then costing more the further (per timeScale seconds)
  timeScale: 0.3,
  softWindow: 0.08, // a softly played note (heard less strictly) must be this close to its time
  skipHeard: 0.05, // the cost of a heard chord that isn't written (overtones, echoes: common, so cheap)
};

// Line up the written chords with the chords heard, in order (dynamic programming, like the follower's own
// alignment), so each note's expected time follows the playing's timing inside the bar (rubato, a bar's times a
// little off). Each written chord takes the time of the heard chord it matches; chords with no match take a time in
// between their neighbors'. Sets `tc` (the corrected time) on every note.
function alignTimes(notes, H, cfg) {
  const E = [];
  for (const e of notes) {
    const last = E[E.length - 1];
    if (last && last.played === e.played && Math.abs(last.t - e.t) < 0.02) last.notes.push(e);
    else E.push({ t: e.t, played: e.played, notes: [e] });
  }
  if (!E.length) return;
  const t0 = E[0].t - cfg.reach, t1 = E[E.length - 1].t + cfg.reach;
  const C = [];
  for (const h of H) {
    if (h.t < t0 || h.t > t1) continue;
    const last = C[C.length - 1];
    if (last && h.t - last.t < cfg.chord) last.pitches.add(h.midi);
    else C.push({ t: h.t, pitches: new Set([h.midi]) });
  }
  const n = E.length, m = C.length;
  const firstC = (t) => { let lo = 0, hi = m; while (lo < hi) { const k = (lo + hi) >> 1; if (C[k].t < t) lo = k + 1; else hi = k; } return lo; };
  // the heard chords each written chord may match: C[lo[i]] .. C[hi[i]]
  const lo = new Int32Array(n), hi = new Int32Array(n);
  for (let i = 0; i < n; i++) { lo[i] = firstC(E[i].t - cfg.reach); hi[i] = firstC(E[i].t + cfg.reach + 1e-9) - 1; }
  // row r (r written chords lined up) keeps columns A[r]..B[r] (j heard chords used)
  const A = new Int32Array(n + 1), B = new Int32Array(n + 1);
  for (let r = 1; r <= n; r++) { A[r] = Math.max(A[r - 1], lo[r - 1]); B[r] = Math.max(B[r - 1], hi[r - 1] + 1, A[r]); }
  B[n] = m;
  for (let r = n; r >= 1; r--) B[r - 1] = Math.max(B[r - 1], Math.min(B[r] - 1, m), A[r]);
  const off = new Int32Array(n + 2);
  for (let r = 0; r <= n; r++) off[r + 1] = off[r] + (B[r] - A[r] + 1);
  const D = new Float64Array(off[n + 1]).fill(Infinity), how = new Uint8Array(off[n + 1]);
  const at = (r, j) => (j >= A[r] && j <= B[r] ? D[off[r] + j - A[r]] : Infinity);
  const overlap = (e, c) => {
    let s = 0;
    for (const x of e.notes) s += c.pitches.has(x.midi) ? 1 : c.pitches.has(x.midi + 12) || c.pitches.has(x.midi - 12) ? 0.6 : 0;
    return s / e.notes.length;
  };
  for (let j = A[0]; j <= B[0]; j++) D[off[0] + j - A[0]] = j * cfg.skipHeard;
  for (let r = 1; r <= n; r++) {
    const e = E[r - 1];
    for (let j = A[r]; j <= B[r]; j++) {
      let best = at(r - 1, j) + 1, way = 1; // this written chord not heard
      if (j - 1 >= lo[r - 1] && j - 1 <= hi[r - 1]) {
        const c = C[j - 1], ov = overlap(e, c);
        if (ov > 0) {
          const v = at(r - 1, j - 1) + (1 - ov) + Math.max(0, Math.abs(c.t - e.t) - cfg.timeFree) / cfg.timeScale;
          if (v < best) { best = v; way = 0; }
        }
      }
      const left = at(r, j - 1) + cfg.skipHeard;
      if (left < best) { best = left; way = 2; }
      D[off[r] + j - A[r]] = best;
      how[off[r] + j - A[r]] = way;
    }
  }
  // follow the best path back
  const dt = new Array(n).fill(null);
  let r = n, j = m;
  while (r > 0 && Number.isFinite(at(r, j))) {
    const way = how[off[r] + j - A[r]];
    if (way === 0) { dt[r - 1] = C[j - 1].t - E[r - 1].t; r--; j--; }
    else if (way === 1) r--;
    else j--;
  }
  // chords with no match: in between their neighbors' corrections
  for (let i = 0; i < n; i++) {
    let d = dt[i];
    if (d === null) {
      let p = i - 1, q = i + 1;
      while (p >= 0 && dt[p] === null) p--;
      while (q < n && dt[q] === null) q++;
      if (p >= 0 && q < n) d = dt[p] + ((E[i].t - E[p].t) / Math.max(1e-6, E[q].t - E[p].t)) * (dt[q] - dt[p]);
      else d = p >= 0 ? dt[p] : q < n ? dt[q] : 0;
    }
    for (const x of E[i].notes) x.tc = x.t + d;
  }
}

// When each written note should sound, from when each played bar began and ended.
// bars: [{ played, measure, t0, t1 }] (from the practice report; t0/t1 in seconds, t1 may be missing at a run's end);
// measures: the score's measures ({ quarters, notes: [{ midi, start, length }] }).
export function expectedNotes(bars, measures) {
  const out = [];
  bars.forEach((b, i) => {
    if (b.t0 === null || b.t0 === undefined) return;
    const m = measures[b.measure];
    if (!m) return;
    let t1 = b.t1;
    if (t1 === null || t1 === undefined) {
      // a run's last bar: at the pace of the bar before
      const prev = bars[i - 1];
      if (!prev || prev.t1 === null || prev.t0 === null) return;
      const perQuarter = (prev.t1 - prev.t0) / Math.max(0.25, measures[prev.measure].quarters || 4);
      t1 = b.t0 + perQuarter * (m.quarters || 4);
    }
    const q = Math.max(0.25, m.quarters || 4);
    for (const n of m.notes) {
      if (n.start >= q) continue;
      out.push({ t: b.t0 + (n.start / q) * (t1 - b.t0), midi: n.midi, measure: b.measure, played: b.played, beat: n.start, barLength: t1 - b.t0 });
    }
  });
  return out.sort((a, b) => a.t - b.t || a.midi - b.midi);
}

// expected: from expectedNotes; heard: [{ t, midi, dur, amp }] (seconds on the same clock); soft: the notes heard less
// strictly (optional, same form).
// Returns { notes: expected with status "ok" | "missed" | "wrong" (and `instead` for wrong), byMeasure: Map(measure ->
// { total, missed, wrong }), checked, missed, wrong }.
export function checkNotes(expected, heard, cfg = NOTECHECK_SETTINGS, soft = null) {
  const H = [...heard].sort((a, b) => a.t - b.t);
  const used = new Uint8Array(H.length);
  const winOf = (e) => Math.max(cfg.window, cfg.windowShare * (e.barLength || 0));
  // the first heard index at or after time t
  const from = (t) => { let lo = 0, hi = H.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H[m].t < t) lo = m + 1; else hi = m; } return lo; };
  const notes = expected.filter((e) => e.midi >= cfg.lowest).map((e) => ({ ...e, status: "missed" }));
  // 0) each note's time, following the playing (see alignTimes); the steps below use it
  alignTimes(notes, H, cfg);
  // 1) written notes heard: the nearest unused heard note of the same pitch in the window (closest pairs first)
  const pairs = [];
  notes.forEach((e, i) => {
    const w = winOf(e);
    for (let j = from(e.tc - w); j < H.length && H[j].t <= e.tc + w; j++) if (H[j].midi === e.midi) pairs.push([Math.abs(H[j].t - e.tc), i, j]);
  });
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of pairs) {
    if (notes[i].status === "ok" || used[j]) continue;
    notes[i].status = "ok";
    notes[i].heardAt = H[j].t;
    used[j] = 1;
  }
  // 1b) each bar's timing, corrected by the notes heard in it (the bar times can be a little off): the typical gap
  // between when its notes were due and when they were heard. Then a second look for its missing notes, tight again.
  const byBar = new Map();
  notes.forEach((e) => { if (!byBar.has(e.played)) byBar.set(e.played, []); byBar.get(e.played).push(e); });
  for (const list of byBar.values()) {
    const gaps = list.filter((e) => e.status === "ok").map((e) => e.heardAt - e.tc).sort((x, y) => x - y);
    if (gaps.length < 2) continue;
    const shift = gaps[Math.floor(gaps.length / 2)];
    for (const e of list) {
      if (e.status === "ok") continue;
      const t = e.tc + shift, w = winOf(e);
      let best = -1;
      for (let j = from(t - w); j < H.length && H[j].t <= t + w; j++) {
        if (!used[j] && H[j].midi === e.midi && (best < 0 || Math.abs(H[j].t - t) < Math.abs(H[best].t - t))) best = j;
      }
      if (best >= 0) { e.status = "ok"; e.heardAt = H[best].t; used[best] = 1; }
    }
  }
  // 1c) the same note an octave off counts as played (bass octaves, and the model's octave slips)
  for (const e of notes) {
    if (e.status === "ok") continue;
    const w = winOf(e);
    for (let j = from(e.tc - w); j < H.length && H[j].t <= e.tc + w; j++) {
      if (!used[j] && Math.abs(H[j].midi - e.midi) === 12) { e.status = "ok"; e.heardAt = H[j].t; used[j] = 1; break; }
    }
  }
  // 1d) the same note still sounding then (struck a moment before and held, or merged with the pedal): played
  for (const e of notes) {
    if (e.status === "ok") continue;
    const w = cfg.heldWithin;
    for (let j = from(e.tc - w); j < H.length && H[j].t < e.tc; j++) {
      const h = H[j];
      if ((h.midi === e.midi || Math.abs(h.midi - e.midi) === 12) && h.t + (h.dur || 0) >= e.tc + cfg.heldPast) { e.status = "ok"; e.heardAt = h.t; break; }
    }
  }
  // 1e) softly played: heard by the model when it listens less strictly (`soft`), right on time, and not an overtone
  // of a louder note below (an octave, an octave and a fifth, two octaves) or spill-over from a note beside it
  if (soft && soft.length) {
    const S = [...soft].sort((a, b) => a.t - b.t);
    const fromS = (t) => { let lo = 0, hi = S.length; while (lo < hi) { const m = (lo + hi) >> 1; if (S[m].t < t) lo = m + 1; else hi = m; } return lo; };
    for (const e of notes) {
      if (e.status === "ok") continue;
      for (let j = fromS(e.tc - cfg.softWindow); j < S.length && S[j].t <= e.tc + cfg.softWindow; j++) {
        const x = S[j];
        if (x.midi !== e.midi) continue;
        let overtone = false;
        for (let k = from(x.t - 1.5); k < H.length && H[k].t <= x.t + 0.05 && !overtone; k++) {
          const d = x.midi - H[k].midi;
          if ((d === 12 || d === 19 || d === 24) && H[k].t + (H[k].dur || 0) >= x.t) overtone = true;
          // or spill-over from a note a semitone or two away struck at that moment (a wrong note played)
          if (d !== 0 && Math.abs(d) <= 2 && Math.abs(H[k].t - x.t) <= 0.06) overtone = true;
        }
        if (!overtone) { e.status = "ok"; e.heardAt = x.t; e.soft = true; break; }
      }
    }
  }
  // 2) a missed note with a clearly played note that isn't written there: a wrong note
  const written = (t, w) => notes.filter((e) => Math.abs(e.tc - t) <= w);
  for (const e of notes) {
    if (e.status !== "missed") continue;
    const w = winOf(e);
    let best = null;
    for (let j = from(e.tc - w); j < H.length && H[j].t <= e.tc + w; j++) {
      const h = H[j];
      if (used[j] || h.amp < cfg.loud) continue;
      const near = written(h.t, w);
      // not something written nearby, nor its octave or overtone, nor an echo of a note still sounding
      const echo = near.some((x) => { const d = h.midi - x.midi; return d === 0 || d === 12 || d === -12 || d === 19 || d === 24; });
      const held = notes.some((x) => x.midi === h.midi && x.tc < h.t && h.t - x.tc < 1.5 && x.status === "ok");
      if (echo || held) continue;
      if (!best || Math.abs(h.t - e.tc) < Math.abs(best.h.t - e.tc)) best = { h, j };
    }
    if (best && Math.abs(best.h.midi - e.midi) <= 4) {
      e.status = "wrong";
      e.instead = best.h.midi;
      used[best.j] = 1;
    }
  }
  // 3) bars where most notes seem missing: more likely the timing (or a skipped bar) than the playing; leave them out
  const perBar = new Map();
  for (const e of notes) { const r = perBar.get(e.played) || { n: 0, bad: 0 }; r.n++; if (e.status !== "ok") r.bad++; perBar.set(e.played, r); }
  for (const e of notes) { const r = perBar.get(e.played); if (r.n >= 3 && r.bad / r.n > cfg.unsureShare && e.status !== "ok") e.status = "unsure"; }
  const byMeasure = new Map();
  let missed = 0, wrong = 0;
  for (const e of notes) {
    if (e.status === "unsure") continue;
    const r = byMeasure.get(e.measure) || { total: 0, missed: 0, wrong: 0 };
    r.total++;
    if (e.status === "missed") { r.missed++; missed++; }
    if (e.status === "wrong") { r.wrong++; wrong++; }
    byMeasure.set(e.measure, r);
  }
  return { notes, byMeasure, checked: notes.filter((e) => e.status !== "unsure").length, missed, wrong };
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
