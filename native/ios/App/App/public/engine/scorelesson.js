// Builds a lesson section from sheet music instead of a taught playthrough: the score's notes are played by
// the synthesizer, in the order the measures are played (repeats, D.C. and so on), and the page turns come
// from where the score's pages end. The section also remembers which measure each moment belongs to,
// for the measure highlight.

import { FeatureExtractor, FRAME_RATE } from "./features.js";
import { makeLesson } from "./follower.js";
import { playOrder, timeline } from "./score.js";
import { synthesize } from "./synth.js";

export const SCORE_SETTINGS = {
  sampleRate: 22050,
  leadBeats: 1, // turn the page this many beats before the new page starts (on top of the follower's own lead)
};

export function scoreSection(score, settings = SCORE_SETTINGS) {
  const order = playOrder(score);
  if (!order.length) throw new Error("The sheet music has no measures.");
  const { starts, notes, tempoAt } = timeline(score, order);
  if (!notes.length) throw new Error("No notes were found in the sheet music.");
  const audio = synthesize(notes, settings.sampleRate);
  const frames = [];
  const fx = new FeatureExtractor(settings.sampleRate, (f) => frames.push(f));
  // Quiet first, so the extractor learns the room, and a faint hiss throughout like any real
  // recording (pure digital silence would make the extractor take the music itself for the room's background)
  const offset = 1.5; // well past the extractor's half second of learning the room (its first frame comes 0.1 s in)
  const lead = Math.round(offset * settings.sampleRate);
  const all = new Float32Array(lead + audio.length);
  all.set(audio, lead);
  let seed = 12345;
  for (let i = 0; i < all.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    all[i] += ((seed / 4294967296) - 0.5) * 0.0006;
  }
  for (let i = 0; i < all.length; i += 2048) fx.push(all.subarray(i, i + 2048));

  const frameAt = (t) => {
    const k = frames.findIndex((f) => f.time - offset >= t);
    return k < 0 ? frames.length - 1 : k;
  };
  const pageOf = (k) => score.measures[order[k]].page;
  const turns = [];
  for (let k = 1; k < order.length; k++) {
    if (pageOf(k) === pageOf(k - 1)) continue;
    const lead = (settings.leadBeats * 60) / tempoAt(k);
    turns.push({ frame: frameAt(Math.max(starts[k - 1], starts[k] - lead)), page: pageOf(k) });
  }
  // which played measure each frame belongs to (the frame describes the sound up to its time)
  const playedAt = new Int16Array(frames.length);
  let k = 0;
  frames.forEach((f, i) => {
    const t = f.time - offset - 0.04;
    while (k + 1 < order.length && starts[k + 1] <= t) k++;
    playedAt[i] = k;
  });
  const section = makeLesson(frames, turns, { startPage: pageOf(0), fromScore: true, taughtAt: Date.now() });
  section.measure = new Int16Array(section.length);
  section.played = new Int16Array(section.length); // the played-order index (repeats counted twice)
  for (let j = 0; j < section.length; j++) {
    section.played[j] = playedAt[section.source[j]];
    section.measure[j] = order[section.played[j]];
  }
  delete section.source;
  return section;
}
