// Offline check of teaching a piece in sections and following with them.
//   1) python3 tools/synth_performances.py tests/output/perf            (the followed performances)
//      python3 tools/synth_performances.py tests/output/perf --practice
//      python3 tools/synth_performances.py tests/output/perf --sections (the taught sections)
//   2) node tests/sections-eval.js tests/output/perf
// Sections: a = beats 0-40 (pages 1-2), b = 56-100 (pages 2-4), c = 36-70 (overlaps both), late = 70-128,
// cover = 50-110 (contains b). Page turns are at beats 31, 63 and 95.
import fs from "node:fs";
import path from "node:path";
import { featuresOf } from "./engine-eval.js";
import { runSession, summary } from "./practice-eval.js";
import { makeLesson, addSection, sectionsOf, flatten, Follower, FOLLOW_SETTINGS } from "../engine/follower.js";

const dir = process.env.PERF_DIR || process.argv[2] || "tests/output/perf";
const cache = {};
const json = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8"));
const frames = (n) => (cache[n] ||= featuresOf(path.join(dir, n + ".wav")));
const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = xs.findIndex((v) => v >= x);
  return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
};
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);

// Teach one section from a recording: turns where the playing crosses a page break
const taught = {};
function section(name) {
  if (taught[name]) return taught[name];
  const T = json(name), F = frames(name);
  const beatAt = (t) => T.track[Math.min(T.track.length - 1, Math.round(t / 0.05))][1];
  const first = T.track.find(([, b]) => b >= 0)[1];
  const startPage = 1 + T.turnBeats.filter((b) => first >= b).length;
  const turns = [];
  T.turnBeats.forEach((tb, i) => {
    const hit = T.track.find(([, b]) => b >= tb);
    if (hit && first < tb) turns.push({ frame: F.findIndex((f) => f.time >= hit[0]), page: i + 2 });
  });
  const sec = makeLesson(F, turns, { startPage });
  return (taught[name] = { sec, beatOf: (local) => beatAt(F[sec.source[local]].time) });
}
const lessonOf = (names) => names.reduce((L, n) => addSection(L, section(n).sec), null);
// Which beat a follower position (in the sections laid end to end) stands for
function beatMapper(names) {
  const lesson = lessonOf(names), flat = flatten(lesson);
  const kept = sectionsOf(lesson).map((sec) => names.find((n) => section(n).sec === sec));
  return { lesson, beatOf: (pos) => { const k = flat.starts.findLastIndex((s) => s <= pos); return section(kept[k]).beatOf(pos - flat.starts[k]); } };
}

// Straight through with a sectioned lesson: page turns must still come on time
function straight(names, live) {
  const lesson = lessonOf(names), L = json(live), F = frames(live);
  const fired = [];
  let now = 0;
  const fol = new Follower(lesson, { page: 1, onTurn: (page, why) => fired.push({ page, why, t: now }) });
  for (const f of F) { now = f.time; fol.push(f); }
  return L.turnBeats.map((b, i) => {
    const should = interp(L.beats, L.times, b);
    const got = fired.find((x) => x.page === i + 2);
    return got ? got.t - should : null;
  });
}
const fmt = (errs) => errs.map((e) => (e === null ? "missed" : `${e >= 0 ? "+" : ""}${e.toFixed(2)}s`)).join(", ");
const onTime = (e) => e !== null && e >= -1.5 && e <= 0.5;

// 1) Re-teaching replaces a covered section; sections that only overlap are both kept
check("a section that covers another replaces it", sectionsOf(lessonOf(["s_teach_b", "s_teach_cover"])).length === 1);
check("overlapping sections are both kept", sectionsOf(lessonOf(["s_teach_a", "s_teach_c"])).length === 2);
check("separate sections are both kept", sectionsOf(lessonOf(["s_teach_a", "s_teach_b"])).length === 2);

// 2) Straight through with three overlapping sections (whole piece covered)
for (const live of ["faster", "slower", "mistakes"]) {
  const e = straight(["s_teach_a", "s_teach_b", "s_teach_c"], live);
  check(`${live}: all turns on time with three taught sections`, e.every(onTime), fmt(e));
}
// 3) Taught in the order the pianist might: the middle first, then the start
{
  const e = straight(["s_teach_c", "s_teach_a", "s_teach_late"], "faster");
  check("faster: sections taught out of order", e.every(onTime), fmt(e));
}
// 4) With an untaught gap (beats 40-70): turns in taught music still come; the one in the gap can't
{
  const e = straight(["s_teach_a", "s_teach_late"], "faster");
  check("faster: turns around an untaught gap", onTime(e[0]) && onTime(e[2]), `${fmt(e)}; the middle turn is in untaught music`);
}
// 5) Practice sessions followed with the three sections
const sessions = ["p_start_mid", "p_start_mid_no_flip", "p_repeat_passage", "p_jump_back_flip", "p_skip_ahead", "p_back_over_turn", "p_noodle"];
const custom = beatMapper(["s_teach_a", "s_teach_b", "s_teach_c"]);
const rs = sessions.map((n) => runSession(n, FOLLOW_SETTINGS, cache, custom));
for (const r of rs) {
  const turns = r.crossings.map((c) => (c === null ? "missed" : `${c >= 0 ? "+" : ""}${c.toFixed(2)}s`)).join(", ") || "none";
  check(`${r.name} with sections`, r.found.every((f) => f !== null && f <= 4) && r.crossings.every((c) => c !== null) && r.stray === 0,
    `found ${r.found.map((f) => (f === null ? "never" : f.toFixed(1) + "s")).join(", ")}; turns ${turns}; right page ${(100 * r.rightPage).toFixed(0)}%`);
}
console.log(results.join("\n"));
const sm = summary(rs);
console.log(`\nPractice with sections: found within 4 s ${sm.foundOk}/${sm.foundAll}, turns ${sm.turnsOk}/${sm.turnsAll}, stray ${sm.stray}`);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
