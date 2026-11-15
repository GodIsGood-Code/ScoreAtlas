// Turns raw microphone samples into musical features, 50 times a second:
//  - chroma: how strongly each of the 12 note names (C, C♯ … B) is sounding, in any octave
//  - onset: which note names were just struck (useful when the sustain pedal blurs everything)
//  - sounding: whether there is music at all, judged against the room's own background noise
// The same code runs in the browser and in Node (for offline tests), so it uses no browser APIs.

import { FFT } from "./fft.js";

export const FRAME_RATE = 50; // frames per second
export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

const MIN_MIDI = 33; // A1, 55 Hz
const MAX_MIDI = 108; // C8, 4186 Hz
const PITCHES = MAX_MIDI - MIN_MIDI + 1;

export const SETTINGS = {
  warmFrames: 25, // the first half second after the microphone starts is used to learn the room
  noiseFollow: 0.05, // while nothing is playing, how quickly the background estimate follows the room
  noiseFall: 0.2, // while music plays, how quickly the estimate may drop to a quieter level
  noiseRiseDbPer10s: 3, // ... and how slowly it may creep up (so held notes aren't mistaken for noise)
  noiseMargin: 2.5, // a frequency must be this many times louder than the background to count
  soundMargin: 2.5, // the whole sound must be this many times louder than the background to be music
  compression: 30, // evens out loud and soft notes within a chord (phrasing, inner voices)
  onsetThreshold: 0.12, // smallest rise that counts as a new note (log10 units, about 1.2 dB)
  onsetDecay: 0.85, // how long a struck note stays "just struck" (per frame)
  peakDecay: 0.995, // the note display compares against recent loudness, forgotten over a few seconds
  displayRangeDb: 25, // the note display shows notes down to this many dB below the loudest
};

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  if (s <= 1e-20) { v.fill(0); return 0; }
  const k = 1 / Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] *= k;
  return Math.sqrt(s);
}

export class FeatureExtractor {
  constructor(sampleRate, onFrame, settings = SETTINGS) {
    this.sampleRate = sampleRate;
    this.onFrame = onFrame;
    this.cfg = settings;
    this.noiseRise = 10 ** (settings.noiseRiseDbPer10s / 10 / (10 * FRAME_RATE));
    this.hop = Math.round(sampleRate / FRAME_RATE);
    this.size = 2 ** Math.round(Math.log2(sampleRate * 0.085)); // 4096 at 44.1 or 48 kHz: about 85 ms
    this.fft = new FFT(this.size);
    this.window = hann(this.size);
    this.ring = new Float32Array(this.size);
    this.pos = 0;
    this.filled = 0;
    this.sinceHop = 0;
    this.samples = 0;
    this.index = 0;
    this.buf = new Float64Array(this.size);
    this.power = new Float64Array(this.size / 2 + 1);

    // Which semitone each frequency bin belongs to, and how much it counts
    const binHz = sampleRate / this.size;
    const bins = [], pitches = [], weights = [];
    for (let k = 1; k <= this.size / 2; k++) {
      const midi = 69 + 12 * Math.log2((k * binHz) / 440);
      const p = Math.round(midi);
      if (p < MIN_MIDI || p > MAX_MIDI) continue;
      const w = 1 - 2 * Math.abs(midi - p);
      if (w <= 0) continue;
      bins.push(k);
      pitches.push(p - MIN_MIDI);
      weights.push(w * w);
    }
    this.bins = Int32Array.from(bins);
    this.pitchOf = Uint8Array.from(pitches);
    this.weights = Float64Array.from(weights);
    this.noise = null;
    this.energy = new Float64Array(PITCHES);
    this.noiseEnergy = new Float64Array(PITCHES);
    this.logEnergy = new Float64Array(PITCHES);
    this.prevLogEnergy = new Float64Array(PITCHES);
    this.onsetNow = new Float64Array(12);
    this.onsetEnv = new Float64Array(12);
    this.prevShown = new Float64Array(PITCHES);
    this.peak = 0;
  }

  // For the note display: per note name, how strongly it sounds (0–1, relative to recent loudness)
  // and how much it was just struck.
  display(E) {
    const prev = this.prevShown;
    let maxE = 0;
    for (let p = 0; p < PITCHES; p++) if (E[p] > maxE) maxE = E[p];
    this.peak = Math.max(maxE, this.peak * this.cfg.peakDecay);
    const level = new Float32Array(12), strike = new Float32Array(12);
    const range = this.cfg.displayRangeDb, ref = this.peak || 1;
    for (let p = 0; p < PITCHES; p++) {
      // Loudness on a decibel scale, like the ear: 1 = as loud as anything lately, 0 = `range` dB quieter
      const v = E[p] > 0 ? Math.max(0, 1 + (10 * Math.log10(E[p] / ref)) / range) : 0;
      const q = (p + MIN_MIDI) % 12;
      if (v > level[q]) level[q] = v;
      const rise = v - prev[p];
      if (rise > strike[q]) strike[q] = rise;
      prev[p] = v;
    }
    return { level, strike };
  }

  // A frame of nothing, for while the microphone is still waking up
  quietFrame(levelDb) {
    return {
      index: this.index++,
      time: this.samples / this.sampleRate,
      levelDb,
      sounding: false,
      chroma: new Float32Array(12),
      onset: new Float32Array(12),
      onsetStrength: 0,
      display: { level: new Float32Array(12), strike: new Float32Array(12) },
    };
  }

  // Feed any number of samples; frames come out through onFrame as they complete.
  push(samples) {
    const { ring, size, hop } = this;
    for (let i = 0; i < samples.length; i++) {
      ring[this.pos] = samples[i];
      this.pos = this.pos + 1 === size ? 0 : this.pos + 1;
      this.samples++;
      if (this.filled < size) this.filled++;
      if (++this.sinceHop >= hop && this.filled === size) {
        this.sinceHop = 0;
        this.onFrame(this.compute());
      }
    }
  }

  compute() {
    const { ring, size, buf, window, power, bins, pitchOf, weights, cfg } = this;
    let sq = 0;
    for (let i = 0, j = this.pos; i < size; i++, j = j + 1 === size ? 0 : j + 1) {
      const s = ring[j];
      sq += s * s;
      buf[i] = s * window[i];
    }
    const levelDb = 10 * Math.log10(sq / size + 1e-12);
    this.fft.power(buf, power);

    // The room's background sound, per frequency. While nothing is playing, the estimate follows the
    // room; while music plays it may only drop, or creep up very slowly, so music never becomes "noise".
    let total = 0;
    for (const k of bins) total += power[k];
    const deadInput = levelDb < -100; // microphones send pure digital silence while starting up
    if (!this.noise) {
      if (deadInput) return this.quietFrame(levelDb);
      this.noise = new Float64Array(power.length);
      this.smooth = new Float64Array(power.length);
      for (const k of bins) {
        this.noise[k] = power[k] + 1e-20;
        this.smooth[k] = power[k];
      }
      this.warm = cfg.warmFrames; // first moments: just learn the room
    }
    const noise = this.noise, smooth = this.smooth, E = this.energy, NE = this.noiseEnergy;
    let floor = 0;
    for (const k of bins) floor += noise[k];
    const warming = this.warm > 0;
    const sounding = !warming && !deadInput && total > cfg.soundMargin * floor;
    E.fill(0);
    NE.fill(0);
    for (let i = 0; i < bins.length; i++) {
      const k = bins[i], p = power[k];
      const s = (smooth[k] = 0.7 * smooth[k] + 0.3 * p);
      let n = noise[k];
      if (deadInput) {
        // leave the estimate alone
      } else if (warming) n += 0.3 * (s - n);
      else if (!sounding) n += cfg.noiseFollow * (s - n);
      else n = s < n ? n + cfg.noiseFall * (s - n) : n * this.noiseRise;
      noise[k] = n;
      NE[pitchOf[i]] += weights[i] * n;
      const c = p - cfg.noiseMargin * n;
      if (c > 0) E[pitchOf[i]] += weights[i] * c;
    }
    if (this.warm > 0) this.warm--;

    // Chroma, with loudness differences evened out so softer voices still count
    const chroma = new Float32Array(12);
    let maxE = 0;
    for (let p = 0; p < PITCHES; p++) if (E[p] > maxE) maxE = E[p];
    if (sounding && maxE > 0) {
      const c = cfg.compression;
      for (let p = 0; p < PITCHES; p++) {
        if (E[p] > 0) chroma[(p + MIN_MIDI) % 12] += Math.log(1 + (c * E[p]) / maxE);
      }
      normalize(chroma);
    }

    // Onsets: how much each note name just got louder, measured against its own background
    const L = this.logEnergy, prev = this.prevLogEnergy, now = this.onsetNow, env = this.onsetEnv;
    now.fill(0);
    let strength = 0;
    for (let p = 0; p < PITCHES; p++) {
      const ne = NE[p] + 1e-20;
      L[p] = Math.log10((E[p] + ne) / ne);
      const rise = L[p] - prev[p] - cfg.onsetThreshold;
      if (rise > 0) {
        now[(p + MIN_MIDI) % 12] += rise;
        strength += rise;
      }
    }
    this.logEnergy = prev;
    this.prevLogEnergy = L;
    const onset = new Float32Array(12);
    for (let q = 0; q < 12; q++) {
      env[q] = Math.max(now[q], env[q] * cfg.onsetDecay);
      onset[q] = env[q];
    }
    normalize(onset);

    return {
      index: this.index++,
      time: this.samples / this.sampleRate,
      levelDb,
      sounding,
      chroma,
      onset,
      onsetStrength: strength,
      display: this.display(E),
    };
  }
}
