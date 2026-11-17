// Runs on the browser's audio thread: passes microphone samples to the page in blocks of 1024,
// so the page sees every sample exactly once, even when it is briefly busy drawing a page.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this.block.length - this.filled);
        this.block.set(channel.subarray(i, i + n), this.filled);
        this.filled += n;
        i += n;
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(1024);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pt-capture", Capture);
