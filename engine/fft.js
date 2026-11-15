// Fast Fourier transform: splits a slice of sound into its frequencies.
// Radix-2, in place, for sizes that are a power of two.

export class FFT {
  constructor(size) {
    const levels = Math.round(Math.log2(size));
    if (2 ** levels !== size) throw new Error("FFT size must be a power of two");
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1);
      this.rev[i] = r;
    }
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  // input: `size` real samples (already windowed). Writes |X[k]|² for k = 0 … size/2 into `out`.
  power(input, out) {
    const { size, re, im, rev, cos, sin } = this;
    for (let i = 0; i < size; i++) {
      re[rev[i]] = input[i];
      im[rev[i]] = 0;
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >>> 1;
      const step = size / len;
      for (let start = 0; start < size; start += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = start + j, b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= size / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
    return out;
  }
}
