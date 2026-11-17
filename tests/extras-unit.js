// The practice journal and the tempo ladder, from made-up data.
//   node tests/extras-unit.js
import { journal } from "../journal.js";
import { TempoLadder } from "../metronome.js";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};
const DAY = 86400000, now = new Date(2026, 10, 17, 18, 0).getTime();
const sessions = [
  { date: now - 10 * DAY, seconds: 1200, plays: [[0, 1]], hesitations: [[5, 3]], tempo: [[5, 90], [6, 120]] },
  { date: now - 2 * DAY, seconds: 600, plays: [[0, 1]], hesitations: [[5, 1], [7, 2]], tempo: [[5, 130], [6, 121]] },
  { date: now - 1 * DAY, seconds: 900, plays: [[0, 1]], hesitations: [[7, 1]], tempo: [[5, 150]] },
];
const j = journal(sessions, now);
check("two weeks of days", j.days.length, 14);
check("minutes on the right days", j.days.map((d) => Math.round(d.seconds / 60)).filter(Boolean), [20, 10, 15]);
check("this week: 25 minutes on 2 days", [Math.round(j.weekSeconds / 60), j.weekDays], [25, 2]);
check("getting faster: bar 6 (index 5) from 90 to 150", j.better.map((b) => [b.measure, b.from, b.to]), [[5, 90, 150]]);
check("still tricky: bar index 5 (4 times), then 7 (3)", j.tricky.map((t) => [t.measure, t.count]), [[5, 4], [7, 3]]);

const l = new TempoLadder({ start: 80, step: 4, goal: 88 });
const reps = [];
const add = (tempo) => reps.push({ t0: reps.length * 10, t1: reps.length * 10 + 8, tempo });
add(81); check("a clean repetition moves the ladder up", [l.update(reps, () => false), l.tempo], ["up", 84]);
add(70); check("too slow: once more", [l.update(reps, () => false), l.tempo], ["again", 84]);
add(85); check("a hesitation: once more", [l.update(reps, () => true), l.tempo], ["again", 84]);
check("nothing new: nothing happens", l.update(reps, () => false), null);
add(85); check("reaching the goal", [l.update(reps, () => false), l.tempo], ["goal", 88]);
process.exit(fails ? 1 : 0);
