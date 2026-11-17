// Test 16 pieces without a browser: trouble spots, pairing files by name, one hand of the sheet music, markings moved
// with their pages, the metronome's accents, and notes over time in the journal.
//   node tests/test16-unit.js
import { troubleSpots, troubleText } from "../engine/trouble.js";
import { pairFiles, baseName } from "../importer.js";
import { keepHand } from "../engine/score.js";
import { remapMarks } from "../pages.js";
import { Metronome, tempoName } from "../metronome.js";
import { noteHistory } from "../journal.js";

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);

// ---------- trouble spots ----------
const day = 86400000, now = Date.now();
const sessions = [
  { date: now - 2 * day, hesitations: [[10, 2], [30, 1]], tempo: [[8, 90], [9, 92], [10, 60], [11, 91], [12, 90]], notes: { byMeasure: [[10, 3, 8], [20, 2, 6]] } },
  { date: now - day, hesitations: [[10, 1], [11, 1]], tempo: [[8, 95], [9, 96], [10, 66], [11, 94]], notes: { byMeasure: [[10, 1, 8]] } },
];
const spots = troubleSpots(sessions, 40);
check("the worst bar comes first, with a bar either side", spots[0] && spots[0].from <= 9 && spots[0].to >= 11, JSON.stringify(spots[0]));
check("the reasons are counted", spots[0] && spots[0].reasons.hesitations === 4 && spots[0].reasons.wrong >= 4 && spots[0].reasons.slow >= 2, troubleText(spots[0]));
check("the passage's usual tempo is kept", spots[0] && spots[0].tempo > 60 && spots[0].tempo < 100, String(spots[0] && spots[0].tempo));
check("other bars with trouble are their own spots", spots.some((s) => s.from <= 20 && s.to >= 20) && spots.some((s) => s.from <= 30 && s.to >= 30), spots.map((s) => `${s.from}-${s.to}`).join(" "));
check("spots don't overlap", spots.every((a, i) => spots.every((b, j) => i === j || a.to < b.from || b.to < a.from)));
check("no history, no spots", troubleSpots([], 40).length === 0);

// ---------- pairing files ----------
const f = (name) => ({ name });
let plan = pairFiles([f("Clair de Lune.pdf"), f("clair_de_lune.mxl"), f("Prelude.pdf"), f("Prelude.mvt1.mxl"), f("set.scoreatlas"), f("notes.txt")]);
check("PDFs and sheet music pair by name", plan.pieces.length === 2 && plan.pieces.every((p) => p.score), plan.pieces.map((p) => `${p.pdf.name}+${p.score && p.score.name}`).join(", "));
check("shared setlists and other files are told apart", plan.bundles.length === 1 && plan.other.length === 1);
plan = pairFiles([f("Ballade (1).mxl")], ["Ballade"]);
check("sheet music for a piece already in the library", plan.toLibrary.length === 1 && plan.toLibrary[0].name === "Ballade");
plan = pairFiles([f("scan 0042.pdf"), f("Nocturne.mxl")]);
check("one PDF and one sheet music file go together whatever their names", plan.pieces[0].score && plan.loose.length === 0);
check("names are compared loosely", baseName("Encourage_One-Another.mvt2.mxl") === baseName("encourage one another.pdf"));

// ---------- one hand ----------
const score = { measures: [{ notes: [
  { midi: 72, part: 0, staff: 1 }, { midi: 48, part: 0, staff: 2 }, { midi: 76, part: 0, staff: 1 },
  { midi: 60, part: 1, staff: 1 }, { midi: 40, part: 2, staff: 1 },
] }] };
const right = keepHand(score, "right").measures[0].notes.map((n) => n.midi).sort();
const left = keepHand(score, "left").measures[0].notes.map((n) => n.midi).sort();
check("two-staff part: upper staff is the right hand", right.includes(72) && right.includes(76) && !right.includes(48), right.join(","));
check("single-staff parts: the lower one is the left hand", left.includes(48) && left.includes(40) && right.includes(60), `left ${left.join(",")}`);
check("both hands keeps everything", keepHand(score, "both").measures[0].notes.length === 5);

// ---------- markings move with their pages ----------
const marks = { pages: { 1: [{ t: "pen", p: [0.1, 0.2, 0.5] }], 2: [{ t: "stamp", k: "p", x: 0.25, y: 0.75 }], 3: [{ t: "text", s: "1", x: 0.5, y: 0.5 }] } };
const moved = remapMarks(marks, [{ src: 0, page: 2, rot: 0 }, { src: 1, page: 1, rot: 0 }, { src: 0, page: 1, rot: 90 }]);
check("a page's markings follow it to its new place", moved.pages[1] && moved.pages[1][0].k === "p" && !moved.pages[2] && moved.pages[3]);
check("markings turn with a turned page", moved.pages[3] && Math.abs(moved.pages[3][0].p[0] - 0.8) < 1e-9 && Math.abs(moved.pages[3][0].p[1] - 0.1) < 1e-9, JSON.stringify(moved.pages[3]));
check("markings of a page taken out are gone", !Object.values(moved.pages).flat().some((s) => s.t === "text"));

// ---------- the metronome ----------
const m = new Metronome();
m.beats = 6; m.unit = 8;
check("6/8 goes in two groups of three", [0, 1, 2, 3, 4, 5].map((b) => m.level(b)).join("") === "022122");
m.beats = 4; m.unit = 4;
check("4/4: only the first beat is accented", [0, 1, 2, 3].map((b) => m.level(b)).join("") === "0222");
m.tap(1000); const bpm = m.tap(1500);
check("tap tempo: taps half a second apart are 120", bpm === 120, String(bpm));
check("tempo names", tempoName(100) === "Andante" && tempoName(130) === "Allegro", `${tempoName(100)} ${tempoName(130)}`);
m.setTempo(400);
check("tempo stays in range", m.bpm === 300);

// ---------- notes over time ----------
const h = noteHistory([
  { date: 1, notes: { checked: 100, missed: 8, wrong: 2, byMeasure: [[4, 3, 10], [7, 2, 10]] } },
  { date: 2, notes: { checked: 100, missed: 4, wrong: 1, byMeasure: [[4, 2, 10], [7, 0, 10]] } },
]);
check("notes over time: mistakes per 100", h.points.length === 2 && h.points[0].rate === 10 && h.points[1].rate === 5);
check("bars still tripping and bars fixed", h.stuck.some((x) => x.measure === 4) && h.fixed.some((x) => x.measure === 7));

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
