// A metronome: a visible beat, and a click if wanted (the click is soft and short, but the microphone hears it, so it
// may confuse following a little; the visible beat never does). Any time signature (beats in a bar over the note value
// that gets the beat), and the beat split in 2, 3 or 4 with softer clicks. Used on its own, and for the tempo ladder:
// practice a loop slower, and the tempo steps up after each clean repetition.

export const TEMPO_NAMES = [[40, "Grave"], [60, "Largo"], [66, "Larghetto"], [76, "Adagio"], [108, "Andante"], [120, "Moderato"], [156, "Allegro"], [176, "Vivace"], [200, "Presto"], [999, "Prestissimo"]];
export const tempoName = (bpm) => TEMPO_NAMES.find(([top]) => bpm < top)[1];

export class Metronome {
  constructor({ onBeat = () => {} } = {}) {
    this.bpm = 80;
    this.beats = 4; // beats in a bar (the time signature's top number)
    this.unit = 4; // the note value that gets the beat (its bottom number)
    this.subdiv = 1; // clicks per beat: 1, 2 (eighths), 3 (triplets), 4 (sixteenths)
    this.sound = false;
    this.running = false;
    this.onBeat = onBeat;
    this.ctx = null;
    this.timer = 0;
    this.taps = [];
  }

  setTempo(bpm) { this.bpm = Math.max(20, Math.min(300, Math.round(bpm))); }

  // How strong each beat of the bar is: 0 the first, 1 the start of a group (6/8, 9/8, 12/8 go in threes), 2 the others
  level(beat) {
    if (beat === 0) return 0;
    if (this.unit === 8 && this.beats % 3 === 0 && this.beats > 3) return beat % 3 === 0 ? 1 : 2;
    return 2;
  }

  // Tap the beat a few times: the tempo of the taps (returns the new tempo once there are two taps close enough)
  tap(now = performance.now()) {
    this.taps = this.taps.filter((t) => now - t < 2500).concat(now);
    if (this.taps.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < this.taps.length; i++) gaps.push(this.taps[i] - this.taps[i - 1]);
    const avg = gaps.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, gaps.length);
    this.setTempo(60000 / avg);
    return this.bpm;
  }

  // Call from a tap (the iPad only allows sound to start from one)
  start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx) this.ctx = new Ctx();
    this.ctx.resume().catch(() => {});
    this.running = true;
    this.beat = 0;
    this.sub = 0;
    this.next = this.ctx.currentTime + 0.12;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  click(at, strength) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = [1760, 1480, 1320, 990][strength];
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime([0.35, 0.28, 0.22, 0.1][strength], at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.05);
  }

  schedule() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 0.12) {
      const at = this.next, beat = this.beat, sub = this.sub;
      const strength = sub ? 3 : this.level(beat);
      if (this.sound) this.click(at, strength);
      if (!sub) setTimeout(() => { if (this.running) this.onBeat(beat, strength === 0, strength); }, Math.max(0, (at - ctx.currentTime) * 1000));
      const n = Math.max(1, this.subdiv);
      this.next += 60 / this.bpm / n;
      this.sub = (sub + 1) % n;
      if (!this.sub) this.beat = (beat + 1) % this.beats;
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
