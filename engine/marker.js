// Smooths the measure highlight. The follower's idea of where the pianist is wobbles a little from moment to moment,
// which would make the highlight flicker between neighbouring measures. Working in the order the measures are
// played, the highlight moves forward at once by one measure, further only if that holds for a moment, back only
// if that holds for longer (the pianist really went back), and through a brief uncertain moment it stays put.

export const MARKER_SETTINGS = {
  aheadHold: 0.25, // seconds a jump forward of more than one measure must last before the highlight follows
  backHold: 0.6, // seconds a move backward must last
  keepUnsure: 1.5, // seconds the highlight stays on its measure while the follower is unsure or lost
};

export class MeasureMarker {
  constructor(frameRate = 50, settings = MARKER_SETTINGS) {
    this.rate = frameRate;
    this.cfg = settings;
    this.shown = -1; // played-order index of the highlighted measure
    this.candidate = -1;
    this.since = 0;
    this.unsureFor = 0;
  }

  reset() {
    this.shown = this.candidate = -1;
    this.since = this.unsureFor = 0;
  }

  // played: the played-order index the follower points at, or -1 when it doesn't know; jumped: the follower just
  // moved somewhere new (then the highlight follows at once). Returns the played-order index to highlight, or -1.
  update(played, jumped = false) {
    const { cfg, rate } = this;
    if (played < 0) {
      this.unsureFor++;
      if (this.unsureFor > cfg.keepUnsure * rate) this.shown = -1;
      return this.shown;
    }
    this.unsureFor = 0;
    if (jumped || this.shown < 0) { this.shown = played; this.candidate = -1; return this.shown; }
    if (played === this.shown) { this.candidate = -1; return this.shown; }
    if (played === this.shown + 1) { this.shown = played; this.candidate = -1; return this.shown; }
    // a bigger step forward, or a step back: only once it has held for a moment
    if (played !== this.candidate) { this.candidate = played; this.since = 0; }
    this.since++;
    const hold = played > this.shown ? cfg.aheadHold : cfg.backHold;
    if (this.since >= hold * rate) { this.shown = played; this.candidate = -1; }
    return this.shown;
  }
}
