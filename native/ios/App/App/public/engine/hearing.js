// What the note display shows, built from the engine's frames (see features.js):
// bar heights for how strongly each note name sounds, highlights for notes just struck,
// and a short list of the notes it hears right now.

export const HEARING_SETTINGS = {
  struckDecay: 0.8, // how quickly a "just struck" highlight fades (per frame, 50 per second)
  struckMin: 0.2, // how much attack it takes to count as struck
  struckLevel: 0.5, // ... and how strongly the note must be sounding at the same time
  heldLevel: 0.75, // notes sounding this strongly are listed too, even if struck a while ago
  combine: true, // list struck notes and strongly held notes together (false: held notes only as a fallback)
  maxNotes: 5,
};

export class Hearing {
  constructor(settings = HEARING_SETTINGS) {
    this.cfg = settings;
    this.level = new Float32Array(12);
    this.struck = new Float32Array(12);
  }

  update(frame) {
    const { level, struck, cfg } = this;
    const d = frame.display;
    for (let q = 0; q < 12; q++) {
      level[q] = frame.sounding ? d.level[q] : level[q] * 0.8;
      struck[q] = struck[q] * cfg.struckDecay + (frame.sounding ? d.strike[q] : 0);
    }
    let heard = [];
    for (let q = 0; q < 12; q++) if (struck[q] > cfg.struckMin && level[q] > cfg.struckLevel) heard.push(q);
    if ((cfg.combine || !heard.length) && frame.sounding) {
      for (let q = 0; q < 12; q++) if (level[q] > cfg.heldLevel && !heard.includes(q)) heard.push(q);
    }
    if (heard.length > cfg.maxNotes) heard = heard.sort((a, b) => struck[b] + level[b] - struck[a] - level[a]).slice(0, cfg.maxNotes);
    heard.sort((a, b) => a - b);
    return { level, struck, heard, quiet: !frame.sounding };
  }
}
