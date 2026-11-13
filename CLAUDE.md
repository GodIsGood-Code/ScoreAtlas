# Page Turner

A web app, iPad first, that shows sheet music and turns pages automatically by listening to the piano.
The owner is a pianist with little coding experience. Claude writes the code and explains things in plain
language; the owner tests on their iPad and reports back.

## Status

- **Test 2 (current):** PDF viewer (PDF.js), page turns from a Bluetooth pedal (it acts as a keyboard), taps and
  swipes, and a listening check (microphone → 12-note chroma bars).
- Live at https://godisgood-code.github.io/page-turner/ through GitHub Pages, deployed from `main`, root folder.
- Test 1 was the same viewer without the microphone, published as a claude.ai artifact (artifacts can't use the mic).

## Plan agreed with the owner

1. **Basics:** PDF display, pedal and tap turns, mic check. Done in Test 2; waiting for iPad feedback.
2. **Teach it once:** the owner plays a piece once, turning pages by pedal. The app stores the audio features and
   the turn times. Later playthroughs are aligned live against that reference (online DTW on chroma) and pages
   turn at the same musical spots. Repeats come for free because the reference follows the playing order.
3. **Practice robustness:** stops, restarts, repeated bars, jumps back, "lost" detection, manual override.
4. **Reading the sheet music:** convert scans to MusicXML with an existing OMR tool (Audiveris, PlayScore 2,
   Soundslice and similar), build the reference from the notes, and reuse the same alignment engine. Handle repeats,
   D.S. and codas. The owner definitely wants this step.
5. **Release prep:** polish, offline use, App Store packaging (for example Capacitor), a look at competing apps.

Key design idea: the tracking engine compares live chroma with a *reference sequence*. The reference comes from a
recording in step 2 and from the score in step 4, so the engine carries over.

## Owner's setup

- iPad with Safari. Sheet music is mostly scans and PDFs.
- Bluetooth page-turn pedal with forward and back pedals. Which keys it sends is not confirmed yet (the app's
  "Keys received" line shows it).

## Code

- No build step: plain ES modules served as static files.
  - `index.html`, `styles.css`, `app.js` (viewer, pedal, taps, test card), `listen.js` (microphone → chroma).
  - `vendor/pdfjs/`: pdfjs-dist 4.10.38, *legacy* build so older iPadOS Safari works. Apache-2.0.
  - `samples/warm-ups.pdf`: the sample score, made by `tools/make_sample.py` (music21 + Verovio) and
    `tools/make_sample_pdf.js` (Playwright print to PDF).
- `.nojekyll` makes GitHub Pages serve files as they are.

## Testing

- `NODE_PATH="$(npm root -g)" node tests/run-tests.js` runs Playwright end-to-end checks, including a fake
  microphone playing a C major chord (the app must hear "C · E · G").
- Claude can't hear the owner's piano. For the listening engine, ask the owner for recordings of the same piece
  played two or three times (Voice Memos is fine) plus its PDF, and tune offline.

## Working with the owner

- Use plain language and give step-by-step instructions for anything they must do on GitHub or the iPad.
- Changes go live when they reach `main`.
- The repository is public: never commit the owner's sheet music or recordings.
