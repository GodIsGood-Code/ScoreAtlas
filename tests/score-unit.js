// Unit checks of reading MusicXML and the order measures are played in.  node tests/score-unit.js
import { readScore, playOrder, keepParts, withPageStarts, parsePageStarts, suggestParts } from "../engine/score.js";

// A one-staff score; each measure: { notes: "C4 D4" (quarters), marks: MusicXML to put first, end: MusicXML to put last }
function xml(measures, { divisions = 1 } = {}) {
  const body = measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` : ""}${m.marks || ""}${
    (m.notes || "C4 C4 C4 C4").split(" ").map((n) => `<note><pitch><step>${n[0]}</step><octave>${n.slice(-1)}</octave></pitch><duration>${divisions}</duration></note>`).join("")
  }${m.end || ""}${m.raw || ""}</measure>`).join("");
  return `<?xml version="1.0"?><!DOCTYPE score-partwise><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
const fwd = `<barline location="left"><repeat direction="forward"/></barline>`;
const back = (times) => `<barline location="right"><repeat direction="backward"${times ? ` times="${times}"` : ""}/></barline>`;
const ending = (num, type, loc = "left") => `<barline location="${loc}"><ending number="${num}" type="${type}"/></barline>`;
const dir = (inner) => `<direction><direction-type>${inner}</direction-type></direction>`;
const sound = (attrs) => `<sound ${attrs}/>`;

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};
const order = (ms) => playOrder(readScore(xml(ms))).map((i) => i + 1);

check("plain", order([{}, {}, {}]), [1, 2, 3]);
check("repeat from the start", order([{}, { end: back() }, {}]), [1, 2, 1, 2, 3]);
check("repeat a middle passage", order([{}, { marks: fwd }, { end: back() }, {}]), [1, 2, 3, 2, 3, 4]);
check("repeat three times", order([{ marks: fwd }, { end: back(3) }, {}]), [1, 2, 1, 2, 1, 2, 3]);
check("first and second endings", order([{ marks: fwd }, {}, { marks: ending("1", "start"), end: ending("1", "stop", "right") + back() }, { marks: ending("2", "start"), end: ending("2", "stop", "right") }, {}]), [1, 2, 3, 1, 2, 4, 5]);
check("two repeats in a row", order([{ marks: fwd }, { end: back() }, { marks: fwd }, { end: back() }]), [1, 2, 1, 2, 3, 4, 3, 4]);
check("D.C. al Fine (sound marks)", order([{}, { raw: sound('fine="yes"') }, {}, { raw: sound('dacapo="yes"') }]), [1, 2, 3, 4, 1, 2]);
check("D.C. al Fine (words only)", order([{}, { marks: dir("<words>Fine</words>") }, {}, { marks: dir("<words>D.C. al Fine</words>") }]), [1, 2, 3, 4, 1, 2]);
check("D.C. with repeats skipped after the jump", order([{ marks: fwd }, { end: back() }, { raw: sound('dacapo="yes"') }]), [1, 2, 1, 2, 3, 1, 2, 3]);
check("D.S. al Coda", order([{}, { marks: dir("<segno/>") + sound('segno="s"') }, { raw: sound('tocoda="c"') }, { raw: sound('dalsegno="s"') }, { marks: dir("<coda/>") + sound('coda="c"') }, {}]), [1, 2, 3, 4, 2, 3, 5, 6]);
check("al Fine with the Fine not read: stop at the repeat sign", order([{ marks: fwd }, { end: back() }, {}, { marks: dir("<words>Da Capo a ine</words>") }]), [1, 2, 1, 2, 3, 4, 1, 2]);

// Reading notes: chords, two voices (backup), ties, rests
{
  const s = readScore(`<?xml version="1.0"?><score-partwise><part-list/><part id="P1"><measure number="1"><attributes><divisions>2</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
    <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
    <note><rest/><duration>2</duration></note>
    <note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><tie type="start"/></note>
    <backup><duration>8</duration></backup>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration></note>
  </measure><measure number="2">
    <note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><tie type="stop"/></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>6</duration></note>
  </measure></part></score-partwise>`);
  const m1 = s.measures[0].notes.map((n) => `${n.midi}@${n.start}+${n.length}`);
  check("chord, rest, second voice", m1, ["60@0+1", "64@0+1", "68@2+3", "48@0+4"]);
  check("a tied note isn't struck again", s.measures[1].notes.map((n) => `${n.midi}@${n.start}`), ["69@1"]);
  check("measure length", s.measures.map((m) => m.quarters), [4, 4]);
}
// Parts, and the pianist's own page breaks given as bar numbers
{
  const note = (step, octave, dur = 4) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration></note>`;
  const bar = (n, body) => `<measure number="${n}">${n === 1 ? "<attributes><divisions>1</divisions></attributes>" : ""}${body}</measure>`;
  const s = readScore(`<?xml version="1.0"?><score-partwise><part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Violin</part-name></score-part></part-list>
    <part id="P1">${bar(1, note("C", 4))}${bar(2, note("D", 4))}${bar(3, note("E", 4))}${bar(4, note("F", 4))}</part>
    <part id="P2">${bar(1, note("G", 5))}${bar(2, note("A", 5))}${bar(3, note("B", 5))}${bar(4, note("C", 6))}</part></score-partwise>`);
  check("part names", s.parts.map((p) => p.name), ["Piano", "Violin"]);
  check("notes know their part", s.measures[0].notes.map((n) => n.part), [0, 1]);
  check("keep only the piano part", keepParts(s, [0]).measures.map((m) => m.notes.map((n) => n.midi).join()), ["60", "62", "64", "65"]);
  check("keeping no parts means all of them", keepParts(s, []).measures[0].notes.length, 2);
  const paged = withPageStarts(s, [3]);
  check("bar numbers give the pages", paged.measures.map((m) => m.page), [1, 1, 2, 2]);
  check("... and the page count", paged.pages, 2);
  check("reading typed bar numbers", parsePageStarts("12, 27 41;  60"), [12, 27, 41, 60]);
  check("page turns from bar numbers", playOrder(paged).map((i) => paged.measures[i].page), [1, 1, 2, 2]);
}
// Which parts the pianist plays: the piano (by name or two staves), and tiny misread bits grouped
check("piano suggested among choir parts", suggestParts([{ name: "Part I", staves: 1, notes: 97 }, { name: "l ;", staves: 1, notes: 7 }, { name: "Piano", staves: 2, notes: 960 }]), { mine: [2], fragments: [1] });
check("a two-staff part counts as piano", suggestParts([{ name: "", staves: 2, notes: 300 }, { name: "Orchestra", staves: 1, notes: 200 }]).mine, [0]);
check("no clear piano: keep everything", suggestParts([{ name: "Flute", staves: 1, notes: 300 }, { name: "Piano", staves: 2, notes: 100 }]).mine, null);
process.exit(fails ? 1 : 0);
