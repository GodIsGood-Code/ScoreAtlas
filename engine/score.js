// Reads sheet music from MusicXML (what Audiveris exports, as .mxl or .musicxml/.xml) and works out
// the order the measures are played in (repeats, first and second endings, D.C., D.S., coda, Fine).
//
// readScore(bytes or text) -> {
//   measures: [{ number, page, system, width, quarters, notes: [{ midi, start, length }] (in quarter notes),
//                tempo, repeat/ending/jump marks }],
//   pages, stavesPerSystem, title }
// playOrder(score) -> the indices of the measures in the order they're played

import { parseXml, child, children, textOf } from "./xml.js";
import { unzipSync, strFromU8 } from "../vendor/fflate/fflate.js";

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function xmlText(input) {
  if (typeof input === "string") return input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // .mxl: a zip; META-INF/container.xml says which file holds the score
    const files = unzipSync(bytes);
    let path = null;
    if (files["META-INF/container.xml"]) {
      const rf = /full-path\s*=\s*"([^"]+)"/.exec(strFromU8(files["META-INF/container.xml"]));
      if (rf) path = rf[1];
    }
    if (!path || !files[path]) path = Object.keys(files).find((f) => !f.startsWith("META-INF") && /\.(xml|musicxml)$/i.test(f));
    if (!path) throw new Error("This .mxl file has no music inside.");
    return strFromU8(files[path]);
  }
  return strFromU8(bytes);
}

const words = (el) => children(el, "direction-type").flatMap((dt) => children(dt, "words").map((w) => w.text.trim())).join(" ");

export function readScore(input) {
  const root = parseXml(xmlText(input));
  if (root.name === "score-timewise") throw new Error("This MusicXML layout (timewise) isn't supported yet.");
  if (root.name !== "score-partwise") throw new Error("This doesn't look like a MusicXML file.");
  const parts = children(root, "part");
  const partNames = {};
  for (const sp of children(child(root, "part-list"), "score-part")) partNames[sp.attrs.id] = textOf(sp, "part-name") || "";
  const partInfo = [];
  if (!parts.length) throw new Error("This MusicXML file has no music in it.");
  const title = textOf(child(root, "work"), "work-title") || textOf(root, "movement-title") || "";

  const count = Math.max(...parts.map((p) => children(p, "measure").length));
  const measures = Array.from({ length: count }, () => ({
    number: "", page: 1, system: 1, width: 0, quarters: 0, notes: [], tempo: 0,
    forward: false, backward: false, times: 2, ending: null, segno: false, coda: false,
    dacapo: false, dalsegno: false, tocoda: false, fine: false, alFine: false, finalBar: false,
  }));
  let stavesPerSystem = 0;

  parts.forEach((part, pi) => {
    let divisions = 1, staves = 1;
    let page = 1, system = 1;
    const open = new Map(); // tied notes still sounding: key -> note
    children(part, "measure").forEach((mx, mi) => {
      const m = measures[mi];
      if (pi === 0) {
        m.number = mx.attrs.number || String(mi + 1);
        m.width = parseFloat(mx.attrs.width) || 0;
      }
      let cursor = 0, longest = 0, lastStart = 0;
      for (const el of mx.children) {
        switch (el.name) {
          case "print":
            if (pi === 0) {
              if (el.attrs["new-page"] === "yes" && mi > 0) { page++; system = 1; }
              else if (el.attrs["new-system"] === "yes" && mi > 0) system++;
            }
            break;
          case "attributes": {
            const d = parseFloat(textOf(el, "divisions"));
            if (d > 0) divisions = d;
            const s = parseInt(textOf(el, "staves"), 10);
            if (s > 0) staves = s;
            break;
          }
          case "backup":
            cursor -= parseFloat(textOf(el, "duration")) || 0;
            break;
          case "forward":
            cursor += parseFloat(textOf(el, "duration")) || 0;
            longest = Math.max(longest, cursor);
            break;
          case "note": {
            const dur = parseFloat(textOf(el, "duration")) || 0;
            const isChord = !!child(el, "chord"), isGrace = !!child(el, "grace");
            const start = isChord ? lastStart : cursor;
            if (!isChord) lastStart = cursor;
            const pitch = child(el, "pitch");
            if (pitch && !child(el, "rest")) {
              const midi = 12 * (parseInt(textOf(pitch, "octave"), 10) + 1) + STEPS[textOf(pitch, "step")] + (parseFloat(textOf(pitch, "alter")) || 0);
              const ties = children(el, "tie").map((t) => t.attrs.type);
              const key = `${midi}|${textOf(el, "staff") || 1}|${textOf(el, "voice") || 1}`;
              const length = isGrace ? 0.1 : dur / divisions;
              if (ties.includes("stop") && open.has(key)) {
                open.get(key).length += length; // a tied note keeps sounding: no new attack
                if (!ties.includes("start")) open.delete(key);
              } else {
                const note = { midi: Math.round(midi), start: start / divisions, length, measure: mi, part: pi };
                m.notes.push(note);
                if (ties.includes("start")) open.set(key, note);
              }
            }
            if (!isChord && !isGrace) cursor += dur;
            longest = Math.max(longest, cursor);
            break;
          }
          case "direction": {
            const sound = child(el, "sound");
            markSound(m, sound);
            if (children(el, "direction-type").some((dt) => child(dt, "segno"))) m.segno = true;
            if (children(el, "direction-type").some((dt) => child(dt, "coda"))) m.coda = true;
            markWords(m, words(el));
            break;
          }
          case "sound":
            markSound(m, el);
            break;
          case "barline": {
            const style = textOf(el, "bar-style");
            if (style === "light-heavy" || style === "light-light") m.finalBar = true;
            const rep = child(el, "repeat");
            if (rep && rep.attrs.direction === "forward") m.forward = true;
            if (rep && rep.attrs.direction === "backward") {
              m.backward = true;
              if (rep.attrs.times) m.times = parseInt(rep.attrs.times, 10) || 2;
            }
            const end = child(el, "ending");
            if (end) {
              const numbers = (end.attrs.number || "1").split(/[,\s]+/).map(Number).filter((x) => x > 0);
              if (end.attrs.type === "start") m.ending = { ...(m.ending || {}), numbers, start: true };
              else m.ending = { ...(m.ending || { numbers }), stop: true };
            }
            if (child(el, "segno")) m.segno = true;
            if (child(el, "coda")) m.coda = true;
            break;
          }
        }
      }
      m.quarters = Math.max(m.quarters, longest / divisions);
      if (pi === 0) { m.page = page; m.system = system; }
    });
    stavesPerSystem += staves;
    const notes = measures.reduce((n, m) => n + m.notes.filter((x) => x.part === pi).length, 0);
    partInfo.push({ id: part.attrs.id || `P${pi + 1}`, name: partNames[part.attrs.id] || "", staves, notes });
  });
  return { title, measures, parts: partInfo, pages: measures.length ? measures[measures.length - 1].page : 0, stavesPerSystem };
}

function markSound(m, s) {
  if (!s) return;
  const a = s.attrs;
  if (a.tempo) m.tempo = parseFloat(a.tempo) || m.tempo;
  if (a.dacapo === "yes") m.dacapo = true;
  if (a.dalsegno) m.dalsegno = true;
  if (a.tocoda) m.tocoda = true;
  if (a.fine) m.fine = true;
  if (a.segno) m.segno = true;
  if (a.coda) m.coda = true;
}

// Jump instructions that are only written as text
function markWords(m, w) {
  if (!w) return;
  const t = w.toLowerCase().replace(/\s+/g, " ");
  if (/\bd\.? ?c\.?\b|da capo/.test(t)) m.dacapo = true;
  if (/\bd\.? ?s\.?\b|dal segno/.test(t)) m.dalsegno = true;
  if (/to coda|al coda/.test(t) && !/\bd\.? ?[cs]\.?\b|da capo|dal segno/.test(t)) m.tocoda = true;
  if (/^fine\b/.test(t.trim())) m.fine = true;
  // "D.C. al Fine" (text reading sometimes garbles it, e.g. "Da Capo a ine")
  if ((m.dacapo || m.dalsegno) && /fine|\bine\b|al f/.test(t)) m.alFine = true;
}

// The order the measures are played in
export function playOrder(score) {
  const M = score.measures, n = M.length;
  // which ending (if any) each measure belongs to, and the highest number in its group of endings
  const endingOf = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!M[i].ending || !M[i].ending.start) continue;
    let j = i;
    while (j < n && !(M[j].ending && M[j].ending.stop && j >= i)) j++;
    for (let k = i; k <= Math.min(j, n - 1); k++) endingOf[k] = M[i].ending.numbers;
  }
  const lastEnding = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!endingOf[i]) continue;
    // the group: consecutive ending spans
    let a = i;
    while (a > 0 && endingOf[a - 1]) a--;
    let b = i;
    while (b < n - 1 && endingOf[b + 1]) b++;
    let max = 0;
    for (let k = a; k <= b; k++) max = Math.max(max, ...endingOf[k]);
    lastEnding[i] = max;
  }
  const segnoAt = M.findIndex((m) => m.segno && !m.dalsegno);
  // the coda sign is usually written twice (at "To Coda" and where the coda starts): jump to the last one
  let codaAt = -1;
  for (let k = n - 1; k >= 0; k--) if (M[k].coda) { codaAt = k; break; }

  // "al Fine" without a Fine that was read: Fine almost always sits at a repeat sign or double bar
  const anyFine = M.some((m) => m.fine);
  let stopAfterJumpAt = -1;

  const order = [];
  let i = 0, pass = 1, repeatStart = 0, jumped = false, guard = 0;
  let backFromRepeat = false;
  while (i < n && guard++ < 20 * n + 100) {
    const m = M[i];
    if (m.forward && !backFromRepeat) { repeatStart = i; pass = 1; }
    backFromRepeat = false;
    if (endingOf[i]) {
      const want = jumped ? lastEnding[i] : pass;
      if (!endingOf[i].includes(want)) { i++; continue; }
    }
    order.push(i);
    if (m.backward && !jumped && pass < m.times) {
      pass++;
      i = repeatStart;
      backFromRepeat = true;
      continue;
    }
    if (m.backward) { pass = 1; repeatStart = i + 1; }
    if (m.fine && jumped) break;
    if (jumped && i === stopAfterJumpAt) break;
    if (m.tocoda && jumped && codaAt > i) { i = codaAt; continue; }
    if ((m.dacapo || m.dalsegno) && !jumped) {
      jumped = true;
      const to = m.dacapo ? 0 : segnoAt >= 0 ? segnoAt : 0;
      if (m.alFine && !anyFine) stopAfterJumpAt = M.findIndex((x, k) => k >= to && k < i && (x.backward || x.finalBar));
      i = to;
      pass = 1;
      continue;
    }
    i++;
  }
  return order;
}

// Seconds for each played measure at the written tempo (quarter notes per minute; 90 if none is written),
// and every note's start and end in seconds
export function timeline(score, order, defaultTempo = 90) {
  let tempo = defaultTempo;
  const starts = new Float64Array(order.length + 1);
  const notes = [];
  let t = 0;
  order.forEach((mi, k) => {
    const m = score.measures[mi];
    if (m.tempo > 0) tempo = m.tempo;
    const q = 60 / tempo;
    starts[k] = t;
    for (const note of m.notes) notes.push({ midi: note.midi, t0: t + note.start * q, t1: t + (note.start + note.length) * q, played: k });
    t += Math.max(m.quarters, 0.25) * q;
  });
  starts[order.length] = t;
  return { starts, notes, tempoAt: (k) => {
    let tp = defaultTempo;
    for (let j = 0; j <= k; j++) if (score.measures[order[j]].tempo > 0) tp = score.measures[order[j]].tempo;
    return tp;
  } };
}

// Only the notes of the parts the pianist plays (part indices; null or empty keeps every part)
export function keepParts(score, parts) {
  if (!parts || !parts.length) return score;
  const keep = new Set(parts);
  return { ...score, measures: score.measures.map((m) => ({ ...m, notes: m.notes.filter((n) => keep.has(n.part)) })) };
}

// Which parts the pianist probably plays, and which are tiny bits a reader like Audiveris split off by mistake.
// mine: the piano parts (named so, or written on two or more staves) if they hold at least half the notes, else null
// (keep everything); fragments: other parts with only a handful of notes.
export function suggestParts(parts) {
  const piano = parts.map((p, i) => (/piano|pno|klavier|keyboard|accomp|\bpf\b/i.test(p.name || "") || p.staves >= 2 ? i : -1)).filter((i) => i >= 0);
  if (parts.some((p) => p.notes === undefined)) return { mine: piano.length ? piano : null, fragments: [] }; // no counts kept
  const total = parts.reduce((n, p) => n + p.notes, 0);
  const pianoNotes = piano.reduce((n, i) => n + (parts[i].notes || 0), 0);
  const mine = piano.length && pianoNotes >= 0.5 * total ? piano : null;
  const small = Math.max(12, 0.03 * total);
  const fragments = parts.map((p, i) => (!piano.includes(i) && (p.notes || 0) < small ? i : -1)).filter((i) => i >= 0);
  return { mine, fragments };
}

// The bar number a measure carries (repeated or unnumbered measures take the last number seen)
export function barNumbers(score) {
  let last = 0;
  return score.measures.map((m) => {
    const n = parseInt(m.number, 10);
    if (Number.isFinite(n)) last = n;
    return last;
  });
}

// Pages from the pianist's own edition: starts = the first bar number on page 2, 3, ... Every measure gets the page
// its bar number falls on; systems are then unknown (the measures are found on the page image instead).
// first: the PDF page the music starts on (a later movement, say); starts then name the first bar of each page after it.
export function withPageStarts(score, starts, first = 1) {
  const sorted = starts.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const bars = barNumbers(score);
  const measures = score.measures.map((m, i) => ({ ...m, page: first + sorted.filter((s) => bars[i] >= s).length, system: 0 }));
  return { ...score, measures, pages: first + sorted.length, pageStarts: sorted };
}

// The sheet music's own pages moved later in the PDF (it starts on PDF page `first`)
export function shiftPages(score, first = 1) {
  if (first <= 1) return score;
  return { ...score, measures: score.measures.map((m) => ({ ...m, page: m.page + first - 1 })), pages: score.pages + first - 1 };
}

// "12, 27 41" -> [12, 27, 41]
export function parsePageStarts(text) {
  return (text.match(/\d+/g) || []).map(Number).filter((n) => n > 0);
}
