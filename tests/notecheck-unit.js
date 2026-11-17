// Wrong-note detection (engine/notecheck.js) on made-up notes, without the note-recognition model.
//   node tests/notecheck-unit.js
import { expectedNotes, checkNotes } from "../engine/notecheck.js";

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);

// a bar of 4 quarters: C major chord on beat 0, E4 on 1, G4 on 2, C5 on 3; played from 0 to 2 s
const measures = [{ quarters: 4, notes: [
  { midi: 48, start: 0, length: 1 }, { midi: 60, start: 0, length: 1 }, { midi: 64, start: 0, length: 1 },
  { midi: 64, start: 1, length: 1 }, { midi: 67, start: 2, length: 1 }, { midi: 72, start: 3, length: 1 },
] }];
const bars = (n, len = 2) => Array.from({ length: n }, (_, k) => ({ played: k, measure: 0, t0: k * len, t1: (k + 1) * len }));
const exp = expectedNotes(bars(1), measures);
check("written notes timed from the bar", exp.length === 6 && exp[3].t === 0.5 && exp[5].t === 1.5, exp.map((e) => e.t).join(" "));
const note = (t, midi, amp = 0.5, dur = 0.3) => ({ t, midi, amp, dur });
const played = [note(0, 48), note(0, 60), note(0, 64), note(0.5, 64), note(1, 67), note(1.5, 72)];
const status = (res) => res.notes.map((e) => e.status).join(" ");

let r = checkNotes(exp, played);
check("all played: nothing flagged", r.missed === 0 && r.wrong === 0 && r.checked === 6, status(r));

r = checkNotes(exp, played.filter((n) => n.midi !== 67));
check("a dropped note is missed", r.missed === 1 && r.notes.find((e) => e.midi === 67).status === "missed", status(r));

r = checkNotes(exp, played.map((n) => (n.midi === 67 ? note(1, 65, 0.6) : n)));
const g = r.notes.find((e) => e.midi === 67);
check("F played for G is a wrong note", g.status === "wrong" && g.instead === 65, `${g.status} ${g.instead}`);

r = checkNotes(exp, played.map((n) => (n.midi === 72 ? note(1.5, 60) : n)));
check("an octave off counts as played", r.missed === 0 && r.wrong === 0, status(r));

// rubato: beats 1–3 come early (0.35, 0.75, 1.15 s): lining up the chords follows the playing
r = checkNotes(exp, [note(0, 48), note(0, 60), note(0, 64), note(0.3, 64), note(0.7, 67), note(1.12, 72)]);
check("notes early inside the bar (rubato) are still found", r.missed === 0, status(r));

// soft notes: G heard only by the lenient listener, on time, nothing below it: played softly
const noG = played.filter((n) => n.midi !== 67);
r = checkNotes(exp, noG, undefined, [note(1.01, 67, 0.2)]);
check("a softly played note heard less strictly counts", r.notes.find((e) => e.midi === 67).status === "ok", status(r));
// ... but not when it's the overtone (an octave and a fifth up) of the low C still sounding
r = checkNotes(exp, noG.map((n) => (n.midi === 48 ? note(0, 48, 0.6, 1.2) : n)), undefined, [note(1.01, 67, 0.2)]);
check("a soft note that is an overtone of a louder note below doesn't count", r.notes.find((e) => e.midi === 67).status !== "ok", status(r));
// ... nor spill-over from A played instead of G (a wrong note must stay wrong)
r = checkNotes(exp, [...noG, note(1, 69, 0.6)], undefined, [note(1.01, 67, 0.2)]);
check("a soft note beside a wrong note played doesn't hide it", r.notes.find((e) => e.midi === 67).status === "wrong", status(r));

// a bar where almost nothing was heard: timing, not playing; left out
r = checkNotes(expectedNotes(bars(2), measures), [...played, note(2, 48)]);
check("a bar mostly unheard is left out, not counted as missed", r.missed === 0 && r.checked === 7, `${r.checked} checked, ${r.missed} missed`);

// a repeated note merged by the model into one held note
const rep = [{ quarters: 2, notes: [{ midi: 64, start: 0, length: 0.5 }, { midi: 64, start: 0.5, length: 0.5 }, { midi: 60, start: 1, length: 1 }] }];
r = checkNotes(expectedNotes([{ played: 0, measure: 0, t0: 0, t1: 1 }], rep), [note(0, 64, 0.5, 0.9), note(0.5, 60)]);
check("a quick repeat heard as one held note counts as played", r.missed === 0, status(r));

// below C2 isn't checked
r = checkNotes([{ t: 0, midi: 30, measure: 0, played: 0, beat: 0, barLength: 2 }], []);
check("very low notes aren't checked", r.checked === 0);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
