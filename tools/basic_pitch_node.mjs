// Runs the app's note-recognition model (vendor/basic-pitch with vendor-free TensorFlow.js from npm) in Node, for tests.
//   (once) cd SOMEWHERE && npm install @tensorflow/tfjs@3.21.0   then   NODE_PATH=SOMEWHERE/node_modules
//   node tools/basic_pitch_node.mjs RECORDING.wav [seconds] [--raw]   writes RECORDING.bp.json:
//     [[start, midi, duration, amplitude]] (thresholds as in pitch.js) and RECORDING.bpsoft.json (the notes heard less
//     strictly); --raw also keeps the model's own output
//     (RECORDING.bpraw.json) so other thresholds can be tried quickly:
//   node tools/basic_pitch_node.mjs RECORDING.wav --from-raw --onset 0.5 --frame 0.3   (no TensorFlow needed)
import fs from "node:fs";
import { createRequire } from "node:module";
import { readWav } from "../tests/engine-eval.js";
import { PITCH_SETTINGS } from "../engine/notecheck.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const file = args[0];
const onset = opt("--onset", PITCH_SETTINGS.onset), frame = opt("--frame", PITCH_SETTINGS.frame);
const softOnset = opt("--soft-onset", PITCH_SETTINGS.softOnset), softFrame = opt("--soft-frame", PITCH_SETTINGS.softFrame);
const { outputToNotesPoly, noteFramesToTime } = await import("../vendor/basic-pitch/toMidi.js");
const rawFile = file.replace(/\.wav$/, ".bpraw.json");
const b64 = (rows) => { const f = new Float32Array(rows.length * 88); rows.forEach((r, i) => f.set(r, i * 88)); return Buffer.from(f.buffer).toString("base64"); };
const unb64 = (s) => { const b = Buffer.from(s, "base64"); const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4); const rows = []; for (let i = 0; i < f.length; i += 88) rows.push(Array.from(f.subarray(i, i + 88))); return rows; };
const notesOf = (a, start, frames, onsets, on = onset, fr = frame) => {
  const out = [];
  for (const x of noteFramesToTime(outputToNotesPoly(frames, onsets, on, fr, PITCH_SETTINGS.minFrames))) {
    const t = a + x.startTimeSeconds;
    if (t >= start && t < start + 30) out.push([t, x.pitchMidi, x.durationSeconds, x.amplitude]);
  }
  return out;
};
const notes = [], soft = [];
const both = (a, start, frames, onsets) => { notes.push(...notesOf(a, start, frames, onsets)); soft.push(...notesOf(a, start, frames, onsets, softOnset, softFrame)); };
if (args.includes("--from-raw")) {
  for (const c of JSON.parse(fs.readFileSync(rawFile, "utf8"))) both(c.a, c.start, unb64(c.frames), unb64(c.onsets));
  console.log(`${notes.length} notes (onset ${onset}, frame ${frame})`);
} else {
  const require = createRequire(import.meta.url);
  globalThis.tf = require("@tensorflow/tfjs");
  const { BasicPitch } = await import("../vendor/basic-pitch/inference.js");
  const dir = new URL("../vendor/basic-pitch/", import.meta.url);
  const topo = JSON.parse(fs.readFileSync(new URL("model.json", dir), "utf8"));
  const weightData = new Uint8Array(fs.readFileSync(new URL("group1-shard1of1.bin", dir))).buffer;
  const model = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: topo.modelTopology, weightSpecs: topo.weightsManifest[0].weights, weightData, format: topo.format }));
  const secs = args[1] && !args[1].startsWith("--") ? Number(args[1]) : 1e9;
  const { sampleRate, samples } = readWav(file);
  const n = Math.min(samples.length, Math.round(secs * sampleRate));
  const audio = new Float32Array(Math.floor((n * 22050) / sampleRate));
  for (let i = 0; i < audio.length; i++) { const x = (i * sampleRate) / 22050, k = Math.floor(x), f = x - k; audio[i] = (samples[k] || 0) * (1 - f) + (samples[k + 1] || 0) * f; }
  // half-minute pieces, as in the app (pitch.js)
  const bp = new BasicPitch(model), total = audio.length / 22050, raw = [];
  const t0 = Date.now();
  for (let start = 0; start < total; start += 30) {
    const a = Math.max(0, start - 1), z = Math.min(total, start + 31);
    const frames = [], onsets = [];
    await bp.evaluateModel(audio.subarray(Math.round(a * 22050), Math.round(z * 22050)), (f, o) => { for (const r of f) frames.push(r); for (const r of o) onsets.push(r); }, () => {});
    both(a, start, frames, onsets);
    if (args.includes("--raw")) raw.push({ a, start, frames: b64(frames), onsets: b64(onsets) });
  }
  if (raw.length) fs.writeFileSync(rawFile, JSON.stringify(raw));
  console.log(`${total.toFixed(0)} s heard in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${notes.length} notes; tensors left in memory: ${tf.memory().numTensors}`);
}
fs.writeFileSync(file.replace(/\.wav$/, ".bp.json"), JSON.stringify(notes.sort((x, y) => x[0] - y[0])));
fs.writeFileSync(file.replace(/\.wav$/, ".bpsoft.json"), JSON.stringify(soft.sort((x, y) => x[0] - y[0])));
