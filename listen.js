// Listening: turns the microphone signal into a 12-number "chroma" profile,
// meaning how strongly each pitch class (C, C#, D ... B) is sounding right now, in any octave.
// The page-turning engine will follow a performance by comparing sequences of these
// profiles with a reference (a recording first, the notes of the score later).

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

const MIN_HZ = 55;   // A1
const MAX_HZ = 4200; // about C8

// For each FFT bin in the piano range: which pitch class it belongs to, and how much it
// counts (1 when it sits on a note's frequency, 0 halfway between two notes).
export function buildChromaMap(sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;
  const bins = [], classes = [], weights = [];
  const first = Math.max(1, Math.ceil(MIN_HZ / binHz));
  const last = Math.min(fftSize / 2 - 1, Math.floor(MAX_HZ / binHz));
  for (let k = first; k <= last; k++) {
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    const nearest = Math.round(midi);
    const w = 1 - 2 * Math.abs(midi - nearest);
    if (w <= 0) continue;
    bins.push(k);
    classes.push(((nearest % 12) + 12) % 12);
    weights.push(w * w);
  }
  return { bins: Int32Array.from(bins), classes: Uint8Array.from(classes), weights: Float32Array.from(weights) };
}

// dbSpectrum: decibel magnitudes per FFT bin (what AnalyserNode.getFloatFrequencyData gives).
export function chromaFromSpectrum(dbSpectrum, map, out = new Float32Array(12), scratch = new Float32Array(map.bins.length)) {
  const { bins, classes, weights } = map;
  out.fill(0);
  let sum = 0;
  for (let i = 0; i < bins.length; i++) {
    const m = Math.pow(10, dbSpectrum[bins[i]] / 20);
    scratch[i] = m;
    sum += m;
  }
  // Ignore the background hiss: only energy clearly above the average counts
  const floor = (sum / bins.length) * 1.5;
  for (let i = 0; i < bins.length; i++) {
    const m = scratch[i] - floor;
    if (m > 0) out[classes[i]] += m * weights[i];
  }
  return out;
}

export class Listener {
  constructor({ onFrame, framesPerSecond = 20 } = {}) {
    this.onFrame = onFrame;
    this.interval = 1000 / framesPerSecond;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error("This page can't reach the microphone.");
      err.name = "NotSupportedError";
      throw err;
    }
    // Create the audio engine during the tap itself, or the iPad keeps it silent
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.ctx.resume().catch(() => {});
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Voice-call processing would treat sustained piano notes as noise, so turn it off
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      throw err;
    }
    await this.ctx.resume().catch(() => {});
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    this.analyser = analyser;
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.wave = analyser.getFloatTimeDomainData ? new Float32Array(analyser.fftSize) : new Uint8Array(analyser.fftSize);
    this.map = buildChromaMap(this.ctx.sampleRate, analyser.fftSize);
    this.scratch = new Float32Array(this.map.bins.length);
    this.chroma = new Float32Array(12);
    this.timer = setInterval(() => this.tick(), this.interval);
  }

  tick() {
    const a = this.analyser;
    if (!a) return;
    a.getFloatFrequencyData(this.freq);
    let sq = 0;
    if (this.wave instanceof Float32Array) {
      a.getFloatTimeDomainData(this.wave);
      for (let i = 0; i < this.wave.length; i++) sq += this.wave[i] * this.wave[i];
    } else {
      a.getByteTimeDomainData(this.wave);
      for (let i = 0; i < this.wave.length; i++) { const v = (this.wave[i] - 128) / 128; sq += v * v; }
    }
    const rms = Math.sqrt(sq / this.wave.length);
    const levelDb = rms > 0 ? 20 * Math.log10(rms) : -120;
    chromaFromSpectrum(this.freq, this.map, this.chroma, this.scratch);
    if (this.onFrame) this.onFrame({ levelDb, chroma: this.chroma, time: this.ctx.currentTime });
  }

  stop() {
    clearInterval(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.analyser = null;
    this.stream = null;
    this.ctx = null;
  }
}
