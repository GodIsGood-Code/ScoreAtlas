// Hearing the notes in a recording with a note-recognition model: Spotify's Basic Pitch (vendor/basic-pitch, run by
// TensorFlow.js in vendor/tfjs). Both are loaded only when first needed, and work offline once the app is kept.
// The model listens to 22,050 samples a second; long recordings are heard in half-minute pieces.

import { PITCH_SETTINGS } from "./engine/notecheck.js";

let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the note-recognition model."));
    document.head.append(s);
  });
}

async function modelOn(backend) {
  if (!window.tf) await loadScript(new URL("./vendor/tfjs/tf.min.js", import.meta.url).href);
  const tf = window.tf;
  const { BasicPitch } = await import("./vendor/basic-pitch/inference.js");
  const toMidi = await import("./vendor/basic-pitch/toMidi.js");
  if (!(await tf.setBackend(backend))) throw new Error(`${backend} isn't available`);
  await tf.ready();
  const model = await tf.loadGraphModel(new URL("./vendor/basic-pitch/model.json", import.meta.url).href);
  return { bp: new BasicPitch(model), toMidi, model, backend };
}

// The graphics chip (WebGL) is much faster; where it can't run the model, the processor does it, more slowly.
export function loadModel(backend) {
  if (!loading || (backend && loading.backend !== backend)) {
    const want = backend || "webgl";
    const old = loading;
    loading = (async () => {
      if (old) { try { (await old).model.dispose(); } catch { /* it never loaded */ } }
      try { return await modelOn(want); } catch (err) { if (want === "cpu") throw err; return modelOn("cpu"); }
    })();
    loading.backend = want;
    loading.catch(() => { loading = null; });
  }
  return loading;
}

function resample(x, from, to) {
  if (from === to) return x;
  const out = new Float32Array(Math.floor((x.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from) / to, k = Math.floor(p), f = p - k;
    out[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f;
  }
  return out;
}

// samples at `rate`; returns the notes heard, { notes, soft } (soft: heard less strictly, see PITCH_SETTINGS), each
// [{ t (seconds from the start of `samples`), midi, dur, amp }]. onProgress(0..1); stop(): true to give up (null).
export async function hearNotes(samples, rate, { onProgress = () => {}, stop = () => false } = {}) {
  let { bp, toMidi, backend } = await loadModel();
  const SR = 22050, CHUNK = 30, OVER = 1;
  const audio = resample(samples, rate, SR);
  const total = audio.length / SR, notes = [], soft = [];
  for (let start = 0; start < total; start += CHUNK) {
    if (stop()) return null;
    const a = Math.max(0, start - OVER), z = Math.min(total, start + CHUNK + OVER);
    const piece = audio.subarray(Math.round(a * SR), Math.round(z * SR));
    let frames, onsets;
    const run = (input) => {
      frames = [];
      onsets = [];
      return bp.evaluateModel(input, (f, o) => { for (const r of f) frames.push(r); for (const r of o) onsets.push(r); },
        (p) => onProgress(Math.min(1, (start + p * (z - a)) / total)));
    };
    // On the graphics chip, TensorFlow.js can't build the model's programs for some lengths of sound (about 26–27 s
    // here, in tests): pieces are padded with silence to a length that works, and if none does, the processor
    // takes over (slower).
    let done = false;
    for (const secs of backend === "webgl" ? [32, 33, 34] : []) {
      const input = new Float32Array(Math.max(piece.length, secs * SR));
      input.set(piece);
      try { await run(input); done = true; break; } catch { /* try another length */ }
    }
    if (!done) {
      if (backend !== "cpu") ({ bp, toMidi, backend } = await loadModel("cpu"));
      await run(piece);
    }
    const P = PITCH_SETTINGS;
    for (const [list, on, fr] of [[notes, P.onset, P.frame], [soft, P.softOnset, P.softFrame]]) {
      for (const n of toMidi.noteFramesToTime(toMidi.outputToNotesPoly(frames, onsets, on, fr, P.minFrames))) {
        const t = a + n.startTimeSeconds;
        if (t >= start && t < start + CHUNK) list.push({ t, midi: n.pitchMidi, dur: n.durationSeconds, amp: n.amplitude });
      }
    }
  }
  onProgress(1);
  return { notes: notes.sort((x, y) => x.t - y.t), soft: soft.sort((x, y) => x.t - y.t) };
}
