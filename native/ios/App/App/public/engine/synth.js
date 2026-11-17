// A plain piano-like synthesizer, used to "play" the notes of a score so the follower can learn the piece
// without being taught. It doesn't need to sound beautiful: it only needs the right notes, with overtones and
// a decay like a piano, so the listening engine hears the same kind of thing as from a real piano.

export const SYNTH_SETTINGS = {
  ring: 0.6, // seconds a note keeps sounding (fading) after its written length
  rolloff: 1, // overtone h has 1/h^rolloff of the fundamental's strength
  partials: 10,
  topBoost: 1, // the highest note starting at a moment (usually the melody) is this much louder
  decay: 2.2, // seconds for a middle-C fundamental to fade by about two thirds
};

// notes: [{ midi, t0, t1 }] in seconds. Returns mono samples at `sampleRate`.
export function synthesize(notes, sampleRate = 22050, cfg = SYNTH_SETTINGS) {
  // the melody: the highest note among those starting together
  const top = new Set();
  const byStart = new Map();
  for (const n of notes) {
    const k = Math.round(n.t0 * 50);
    if (!byStart.has(k) || byStart.get(k).midi < n.midi) byStart.set(k, n);
  }
  for (const n of byStart.values()) top.add(n);
  const end = notes.reduce((m, n) => Math.max(m, n.t1), 0) + 1.5;
  const out = new Float32Array(Math.ceil(end * sampleRate));
  const nyquist = sampleRate / 2;
  for (const note of notes) {
    const f0 = 440 * 2 ** ((note.midi - 69) / 12);
    const start = Math.max(0, Math.round(note.t0 * sampleRate));
    // held for the written length, then fades like a piano with some pedal
    const held = Math.max(0.08, note.t1 - note.t0);
    const ringTime = Math.min(held + cfg.ring, 6);
    const len = Math.min(out.length - start, Math.round(ringTime * sampleRate));
    const releaseAt = Math.round(held * sampleRate);
    const lowNote = Math.min(2, Math.sqrt(262 / f0));
    const gain = top.has(note) ? cfg.topBoost : 1;
    for (let h = 1; h <= cfg.partials; h++) {
      const f = f0 * h * Math.sqrt(1 + 0.0004 * h * h); // piano strings are slightly stretched
      if (f >= nyquist * 0.9) break;
      const amp = (gain * 0.22) / h ** cfg.rolloff;
      const tau = (cfg.decay * lowNote) / (1 + 0.45 * (h - 1)); // higher overtones fade faster
      const decay = Math.exp(-1 / (tau * sampleRate));
      const release = Math.exp(-1 / (0.25 * sampleRate));
      const w = (2 * Math.PI * f) / sampleRate;
      const cw = Math.cos(w), sw = Math.sin(w);
      let c = 1, s = 0, a = amp;
      const attack = Math.round(0.004 * sampleRate);
      for (let i = 0; i < len; i++) {
        const env = i < attack ? i / attack : 1;
        out[start + i] += a * env * s;
        const c2 = c * cw - s * sw;
        s = s * cw + c * sw;
        c = c2;
        a *= i < releaseAt ? decay : release;
      }
    }
  }
  return out;
}
