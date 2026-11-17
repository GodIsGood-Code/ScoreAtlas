// Records what the microphone hears during a Follow session, for replaying it with the measure highlight.
// Kept at 16,000 samples a second as 16-bit numbers (about 2 MB a minute: half an hour is plenty), on the same clock
// as the listening engine's frames, so the replay lines up exactly with where the follower was.

export class Recorder {
  constructor({ rate = 16000, maxSeconds = 30 * 60 } = {}) {
    this.rate = rate;
    this.max = Math.round(rate * maxSeconds);
    this.chunks = [];
    this.length = 0;
    this.startTime = null; // the engine's clock (seconds) at the first recorded sample
    this.phase = 0; // where the next output sample falls, in input samples from the start of the next block
    this.prev = [0, 0]; // the last two input samples (for smoothing across blocks)
    this.full = false;
  }

  get duration() { return this.length / this.rate; }

  // block: microphone samples at inputRate; time: the engine's clock at the block's first sample
  push(block, inputRate, time) {
    if (this.full || !block.length) return;
    if (this.startTime === null) this.startTime = time;
    const step = inputRate / this.rate;
    // a light smoothing (three-sample average) before taking every step-th sample keeps it from sounding harsh
    const at = (i) => (i >= 0 ? block[i] : this.prev[2 + i]);
    const smooth = (i) => (step > 1.5 ? (at(i - 1) + at(i) + (i + 1 < block.length ? at(i + 1) : at(i))) / 3 : at(i));
    const out = [];
    let x = this.phase;
    while (x < block.length - 1) {
      const i = Math.floor(x), f = x - i;
      const v = smooth(i) * (1 - f) + smooth(i + 1) * f;
      out.push(Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
      x += step;
    }
    this.phase = x - block.length;
    this.prev = [block.length > 1 ? block[block.length - 2] : this.prev[1], block[block.length - 1]];
    let chunk = Int16Array.from(out);
    if (this.length + chunk.length >= this.max) { chunk = chunk.subarray(0, this.max - this.length); this.full = true; }
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  // All of it as numbers between -1 and 1
  samples() {
    const out = new Float32Array(this.length);
    let at = 0;
    for (const c of this.chunks) { for (let i = 0; i < c.length; i++) out[at + i] = c[i] / 32768; at += c.length; }
    return out;
  }
}
