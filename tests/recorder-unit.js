// The session recorder: right length, on the engine's clock, and the sound kept (a 440 Hz tone stays 440 Hz).
//   node tests/recorder-unit.js
import { Recorder } from "../engine/recorder.js";

let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };
for (const rate of [48000, 44100]) {
  const rec = new Recorder({ maxSeconds: 60 });
  const n = rate * 2;
  for (let s = 0; s < n; s += 1024) {
    const block = new Float32Array(Math.min(1024, n - s));
    for (let i = 0; i < block.length; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (s + i)) / rate);
    rec.push(block, rate, 3 + s / rate);
  }
  const x = rec.samples();
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  check(`${rate} Hz: two seconds become 32,000 samples`, Math.abs(x.length - 32000) <= 2, String(x.length));
  check(`${rate} Hz: starts on the engine's clock`, rec.startTime === 3);
  check(`${rate} Hz: a 440 Hz tone stays 440 Hz`, Math.abs(crossings / 2 - 440) <= 2, `${crossings / 2} Hz`);
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  check(`${rate} Hz: loudness kept`, peak > 0.45 && peak < 0.51, peak.toFixed(3));
}
{
  const rec = new Recorder({ maxSeconds: 1 });
  for (let s = 0; s < 48000 * 3; s += 1024) rec.push(new Float32Array(1024).fill(0.1), 48000, s / 48000);
  check("stops at its limit", rec.length === 16000 && rec.full, String(rec.length));
}
process.exit(fails ? 1 : 0);
