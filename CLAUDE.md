# Page Turner

A web app, iPad first, that shows sheet music and turns pages automatically by listening to the piano.
The owner is a pianist with little coding experience. Claude writes the code and explains things in plain
language; the owner tests on their iPad and reports back.

## Status

- **Test 4 (current):** practice mode. Follow starts from the page on screen and finds the pianist anywhere in the
  piece; it keeps up with stops, repeats, jumps back (turning back a page when needed) and skips ahead, and holds
  still while the pianist plays something that isn't in the piece. A page flip by the pianist is a hint.
- **Test 3:** Teach and Follow. The owner tested it on their piano: every page turned by itself at the taught
  moments, no wrong turns, never stuck. The pedal keys work (the "Pedal keys received" line showed them correctly).
- Live at https://godisgood-code.github.io/page-turner/ through GitHub Pages, deployed from `main`, root folder.
- The owner approved publishing tested updates straight to `main` (no need to ask each time).
- Test 2 feedback from the owner: single notes without pedal were read well; pedaled chords with uneven voicing
  were not; the display felt slightly delayed. Test 1 was a claude.ai artifact (artifacts can't use the mic).

## Plan agreed with the owner

1. **Basics:** PDF display, pedal and tap turns, mic check. Done.
2. **Teach it once:** done in Test 3 and confirmed on the owner's piano.
3. **Practice robustness:** built in Test 4; waiting for iPad feedback. Known limit: when the same music appears in
   two places (a written-out repeat on another page) and the pianist jumps between them without flipping the page,
   the follower may guess the copy on the page that's showing; it corrects itself a couple of seconds later, and a
   page flip by the pianist settles it at once.
4. **Reading the sheet music:** convert scans to MusicXML with an existing OMR tool (Audiveris, PlayScore 2,
   Soundslice and similar), build the reference from the notes, and reuse the same follower. Handle repeats,
   D.S. and codas. The owner definitely wants this step.
5. **Release prep:** polish, offline use, App Store packaging (for example Capacitor), a look at competing apps.

The owner has more features in mind after automatic page turning works.

## Owner's setup

- iPad with Safari. Sheet music is mostly scans and PDFs.
- Bluetooth page-turn pedal with forward and back pedals; it works with the app.

## Code

- No build step: plain ES modules served as static files. `package.json` only marks `.js` files as modules for Node.
- `engine/` has no browser APIs, so it runs in Node for offline tests:
  - `fft.js`: radix-2 FFT.
  - `features.js`: microphone samples → 50 frames per second: chroma (12 note names, loudness-compressed), onset
    chroma (notes just struck), `sounding` (music versus the room's learned background), display data.
  - `follower.js`: `makeLesson` (from teaching frames and page turns; long silences squeezed out) and `Follower`:
    tracking by online DTW (each live frame advances the lesson by 0–3 frames; turns 0.3 s before the taught
    moment) plus practice logic: states waiting → searching ↔ following (→ finished); looks up the recent 2.5 s
    in the whole piece at the start, after pauses and when lost, and every 0.5 s while following to catch jumps.
    Equally good places (repeats) are told apart by the page on screen. Costs: good matches about 0.03–0.06,
    identical passages differ by about 0.015, so jumps need a 0.03 margin and 30% better.
  - `search.js`: subsequence DTW over a coarse copy of the lesson (groups of 4 frames).
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
  - `python3 tools/synth_performances.py tests/output/perf --practice` then `node tests/practice-eval.js
    tests/output/perf`: 13 practice sessions (start mid-piece with and without flipping, repeats, jump back with and
    without a flip, noodling, skip ahead, a repeated section, back over a page turn, fast, slow, noisy). Currently
    found within 4 s after 24/25 restarts (about 1.3 s typically), 15/16 page breaks on time, 0 stray page changes;
    the misses are the known identical-copy case (p_jump_back).
  - `python3 tools/synth_performances.py tests/output/short --short` then
    `NODE_PATH="$(npm root -g)" node tests/teach-follow.cjs`: real-browser Teach, Follow and Practice with a fake
    microphone (about 2.5 minutes).
- Claude can't hear the owner's piano. Ask for their observations; for tuning, recordings of the same piece played
  two or three times (Voice Memos is fine) plus its PDF.

## Working with the owner

- Use plain language and give step-by-step instructions for anything they must do on GitHub or the iPad.
- The repository is public: never commit the owner's sheet music or recordings.
