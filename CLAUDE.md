# Page Turner

A web app, iPad first, that shows sheet music and turns pages automatically by listening to the piano.
The owner is a pianist with little coding experience. Claude writes the code and explains things in plain
language; the owner tests on their iPad and reports back.

## Status

- **Test 3 (current):** Teach and Follow. Teach: play the piece once, turning pages by pedal; the app stores the
  sound's features and the turn moments on the device. Follow: play it again and the app turns pages itself.
  Also a faster note display (about 55 ms instead of about 115 ms) and background-noise learning.
- Live at https://godisgood-code.github.io/page-turner/ through GitHub Pages, deployed from `main`, root folder.
- The owner approved publishing tested updates straight to `main` (no need to ask each time).
- Test 2 feedback from the owner: single notes without pedal were read well; pedaled chords with uneven voicing
  were not; the display felt slightly delayed. Test 1 was a claude.ai artifact (artifacts can't use the mic).

## Plan agreed with the owner

1. **Basics:** PDF display, pedal and tap turns, mic check. Done.
2. **Teach it once:** built in Test 3; waiting for iPad feedback. First goal: turning pages with no human help.
3. **Practice robustness:** starting mid-piece, stops and restarts, repeated bars, jumps back, "lost" detection.
   Today the follower assumes a start from the beginning and only moves forward (it holds still during pauses).
4. **Reading the sheet music:** convert scans to MusicXML with an existing OMR tool (Audiveris, PlayScore 2,
   Soundslice and similar), build the reference from the notes, and reuse the same follower. Handle repeats,
   D.S. and codas. The owner definitely wants this step.
5. **Release prep:** polish, offline use, App Store packaging (for example Capacitor), a look at competing apps.

The owner has more features in mind after automatic page turning works.

## Owner's setup

- iPad with Safari. Sheet music is mostly scans and PDFs.
- Bluetooth page-turn pedal with forward and back pedals. Which keys it sends is not confirmed yet (the app's
  "Pedal keys received" line shows it).

## Code

- No build step: plain ES modules served as static files. `package.json` only marks `.js` files as modules for Node.
- `engine/` has no browser APIs, so it runs in Node for offline tests:
  - `fft.js`: radix-2 FFT.
  - `features.js`: microphone samples → 50 frames per second: chroma (12 note names, loudness-compressed), onset
    chroma (notes just struck), `sounding` (music versus the room's learned background), display data.
  - `follower.js`: `makeLesson` (from teaching frames and page turns; long silences squeezed out) and `Follower`
    (online DTW: each live frame advances the lesson by 0–3 frames; turns 0.3 s before the taught moment).
  - `hearing.js`: the "Hearing" note display.
- `audio/capture-worklet.js` (audio thread) → `listen.js` (`Microphone`) → `FeatureExtractor`.
- `store.js`: IndexedDB on the device: lessons keyed by PDF fingerprint plus page count, and the last opened PDF.
- `app.js`: viewer, pedal, taps, Teach and Follow, test card. `window.pageTurner` exposes the audio clock and a
  log of page turns for tests and troubleshooting.
- `vendor/pdfjs/`: pdfjs-dist 4.10.38, *legacy* build so older iPadOS Safari works. Apache-2.0.
- `samples/warm-ups.pdf`: the sample score, made by `tools/make_sample.py` and `tools/make_sample_pdf.cjs`.

## Testing

- `NODE_PATH="$(npm root -g)" node tests/run-tests.cjs`: quick browser checks (viewer, pedal, taps, mic check with a
  fake microphone playing a C major chord, reopening the last PDF).
- Synthetic piano performances (need `apt-get install fluidsynth fluid-soundfont-gm` and `pip install pretty_midi`):
  - `python3 tools/synth_performances.py tests/output/perf` then `node tests/engine-eval.js tests/output/perf`:
    follower accuracy on 8 cases (faster, slower, 1.6x faster, mistakes, a pause, noise, heavy voicing, no pedal).
    Currently 24/24 turns on time; position error about 0.03 to 0.13 s on average.
  - `node tests/display-eval.js tests/output/perf voicing ref no_pedal`: note display versus the notes played.
    Chroma-based display accuracy has a ceiling (about 80% of notes caught, about 60% of shown notes correct);
    reliable note-by-note recognition would need a trained model (for example Spotify's Basic Pitch).
  - `python3 tools/synth_performances.py tests/output/short --short` then
    `NODE_PATH="$(npm root -g)" node tests/teach-follow.cjs`: real-browser Teach then Follow with a fake
    microphone (about 1.5 minutes).
- Claude can't hear the owner's piano. Ask for their observations; for tuning, recordings of the same piece played
  two or three times (Voice Memos is fine) plus its PDF.

## Working with the owner

- Use plain language and give step-by-step instructions for anything they must do on GitHub or the iPad.
- The repository is public: never commit the owner's sheet music or recordings.
