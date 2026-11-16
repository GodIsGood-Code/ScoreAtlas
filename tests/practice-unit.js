// Practice insights: bars played, hesitations, tempo, loop repetitions, from made-up sessions.
//   node tests/practice-unit.js
import { PracticeLog, busiestPassages } from "../engine/practice.js";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};
// 12 bars of 4 beats; the lesson spends 100 frames (2 s) on each bar, so playing at the lesson's pace is 120 a minute
const BAR = 100;
const measures = Array.from({ length: 12 }, (_, i) => ({ number: String(i + 1), quarters: 4, page: 1 + Math.floor(i / 6) }));
const order = measures.map((_, i) => i);
const lesson = { length: 12 * BAR, played: Int16Array.from({ length: 12 * BAR }, (_, j) => Math.floor(j / BAR)) };
// script: [[bar, seconds, options], ...]; the follower is placed evenly through each bar. Options: { from, to } part
// of the bar (default all of it), sound: false for silence, lost: true for the follower not knowing
function run(script, loop) {
  const log = new PracticeLog(lesson, order, measures, () => 0);
  if (loop) log.setLoop(...loop);
  let t = 0, moves = 0, lastPos = -1;
  const zero = new Float32Array(12);
  for (const [bar, secs, o = {}] of script) {
    const n = Math.round(secs * 50), a = o.from ?? 0, z = o.to ?? 1;
    for (let k = 0; k < n; k++) {
      const pos = o.lost || bar < 0 ? -1 : Math.round((bar + a + ((z - a) * k) / n) * BAR);
      if (pos >= 0 && lastPos >= 0 && pos < lastPos - 50) moves++; // the follower jumped back
      if (pos >= 0) lastPos = pos;
      log.record({ time: t, chroma: zero, onset: zero, sounding: o.sound !== false && bar >= 0 }, pos, moves);
      t += 0.02;
    }
  }
  return log.report({ refine: false });
}
const steady = (from, to, secs = 2) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, secs]);

{ // a steady run through bars 1-8, then stop
  const r = run([...steady(0, 7), [-1, 2]]);
  check("every bar played once", [...r.plays.values()], [1, 1, 1, 1, 1, 1, 1, 1]);
  check("tempo of the bars played through", r.longest.filter((b) => b.tempo).map((b) => Math.round(b.tempo)), [120, 120, 120, 120, 120, 120, 120]);
  check("no hesitations in a steady run", r.hesitations.size, 0);
}
{ // stops in bar 4 and goes back to bar 2, twice; bar 8 takes twice as long
  const r = run([...steady(0, 2), [3, 1, { to: 0.5 }], [-1, 1], ...steady(1, 2), [3, 1, { to: 0.5 }], [-1, 1], ...steady(1, 6), [7, 4], ...steady(8, 10)]);
  check("bars 2 and 3 played three times", [r.plays.get(1), r.plays.get(2)], [3, 3]);
  check("hesitations at bar 4 (went back twice) and bar 8 (slow)", [...r.hesitations.entries()].sort((a, b) => a[0] - b[0]), [[3, 2], [7, 1]]);
}
{ // a pause inside bar 5
  const r = run([...steady(0, 3), [4, 1, { to: 0.5 }], [4, 1.2, { from: 0.5, to: 0.5, sound: false }], [4, 1, { from: 0.5 }], ...steady(5, 8)]);
  check("a pause inside a bar is a hesitation", [...r.hesitations.keys()], [4]);
}
{ // looping bars 3-5 three times (going back to the start each time), the last one faster
  const r = run([...steady(2, 4), [-1, 1], ...steady(2, 4), [-1, 1], ...steady(2, 4, 1.6), [-1, 1]], [2, 4]);
  check("three repetitions of the loop", r.loopReps.length, 3);
  check("tempo of each repetition", r.loopReps.map((x) => 5 * Math.round(x.tempo / 5)), [120, 120, 150]);
  check("going back to the loop's start isn't a hesitation", r.hesitations.size, 0);
}
{ // the busiest passage
  const plays = new Map([[0, 1], [1, 1], [2, 4], [3, 4], [4, 3], [5, 1], [8, 2], [9, 2]]);
  check("busiest passages", busiestPassages(plays, 12), [{ from: 2, to: 4, count: 4 }, { from: 8, to: 9, count: 2 }]);
}
process.exit(fails ? 1 : 0);
