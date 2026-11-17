// Microphone input: streams the iPad's microphone into the feature extractor (engine/features.js),
// which hands back 50 frames of musical features per second.
import { FeatureExtractor } from "./engine/features.js";

export class Microphone {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.onSamples = null; // (samples, sampleRate, time of the first one on the engine's clock): for recording
    this.ctx = null;
  }

  get running() {
    return this.ctx !== null;
  }

  // Call straight from a tap: the iPad only lets audio start in response to one.
  async start() {
    if (this.ctx) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error("This page can't reach the microphone.");
      err.name = "NotSupportedError";
      throw err;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;
    ctx.resume().catch(() => {});
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Voice-call processing would treat sustained piano notes as noise, so turn it off
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(this.stream);
      // sound already on its way when the microphone stops is ignored
      const extractor = new FeatureExtractor(ctx.sampleRate, (frame) => { if (this.ctx === ctx) this.onFrame(frame); });
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the graph running without playing anything
      sink.connect(ctx.destination);
      let node = null;
      if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        try {
          await ctx.audioWorklet.addModule(new URL("./audio/capture-worklet.js", import.meta.url));
          node = new AudioWorkletNode(ctx, "pt-capture", {
            numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit",
          });
          node.port.onmessage = (e) => this.feed(extractor, e.data);
        } catch (err) {
          console.warn("Audio worklet unavailable, using the older audio path:", err && err.message);
          node = null;
        }
      }
      if (!node) {
        // Older iPads: the previous way of reading audio
        node = ctx.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = (e) => this.feed(extractor, e.inputBuffer.getChannelData(0));
      }
      source.connect(node);
      node.connect(sink);
      Object.assign(this, { source, node, sink, extractor });
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  feed(extractor, samples) {
    if (this.onSamples) this.onSamples(samples, extractor.sampleRate, extractor.samples / extractor.sampleRate);
    extractor.push(samples);
  }

  stop() {
    try {
      if (this.source) this.source.disconnect();
      if (this.node) {
        if (this.node.port) this.node.port.onmessage = null;
        this.node.onaudioprocess = null;
        this.node.disconnect();
      }
    } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = this.stream = this.source = this.node = this.sink = this.extractor = null;
  }
}
