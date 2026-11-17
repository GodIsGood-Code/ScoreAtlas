// A metronome: a visible beat, and a click if wanted (the click is soft and short, but the microphone hears it, so it
// may confuse following a little; the visible beat never does). Used on its own, and for the tempo ladder: practise a
// loop slower, and the tempo steps up after each clean repetition.

export class Metronome {
  constructor({ onBeat = () => {} } = {}) {
    this.bpm = 80;
    this.beats = 4;
    this.sound = false;
    this.running = false;
    this.onBeat = onBeat;
    this.ctx = null;
    this.timer = 0;
  }

  setTempo(bpm) { this.bpm = Math.max(30, Math.min(260, Math.round(bpm))); }

  // Call from a tap (the iPad only allows sound to start from one)
  start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx) this.ctx = new Ctx();
    this.ctx.resume().catch(() => {});
    this.running = true;
    this.beat = 0;
    this.next = this.ctx.currentTime + 0.12;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  schedule() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 0.12) {
      const at = this.next, beat = this.beat, accent = beat === 0;
      if (this.sound) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = accent ? 1760 : 1320;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, at + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.05);
      }
      setTimeout(() => { if (this.running) this.onBeat(beat, accent); }, Math.max(0, (at - ctx.currentTime) * 1000));
      this.next += 60 / this.bpm;
      this.beat = (beat + 1) % this.beats;
    }
  }
}

// The tempo ladder: after each clean repetition of the loop (no hesitation, and at least about the ladder's tempo),
// the tempo goes up by `step`, until `goal`
export class TempoLadder {
  constructor({ start = 70, step = 4, goal = 120 } = {}) { Object.assign(this, { start, step, goal, tempo: start, seen: 0, clean: 0 }); }
  reset(start) { this.tempo = start ?? this.start; this.seen = 0; this.clean = 0; }
  // reps: the loop's repetitions so far ({ t0, t1, tempo }); hesitated(rep): whether there was a hesitation in it.
  // Returns "up" (moved up), "goal" (reached the goal), "again" (not clean) or null (nothing new).
  update(reps, hesitated) {
    if (reps.length <= this.seen) return null;
    const rep = reps[reps.length - 1];
    this.seen = reps.length;
    if (hesitated(rep) || rep.tempo < 0.93 * this.tempo) return "again";
    this.clean++;
    if (this.tempo >= this.goal) return "goal";
    this.tempo = Math.min(this.goal, this.tempo + this.step);
    return this.tempo >= this.goal ? "goal" : "up";
  }
}
