# ScoreAtlas

The app is called **ScoreAtlas** (named by the owner; the GitHub project was renamed from page-turner, the local
folder may still be `page-turner`). A web app, iPad first, that shows sheet music and turns pages automatically by listening to the piano.
The owner is a pianist with little coding experience. Claude writes the code and explains things in plain
language; the owner tests on their iPad and reports back.

## Status

- **Test 13 (current):** release groundwork. `release/` holds the App Store listing (`app-store.md`: name, subtitle,
  description, promotional text, keywords, category, age rating, microphone permission text, App Privacy answers
  "Data Not Collected", reviewer notes, screenshot plan; lengths checked) and a release checklist (`release/README.md`).
  `privacy.html` and `support.html` (styled by `doc.css`) are the policy and support URLs on the live site; contact
  is the GitHub issues page (no personal email published). The app will launch free (owner). In the app: **Settings**
  (View menu or the Piece panel): turn pages earlier/later (`turnShift`, −1 to +1 s, applied through
  `followSettings()` to `anticipation`/`scoreLead` at the next Follow), bar highlight, tap/swipe to turn, keep the
  screen on, appearance Automatic/Light/Dark (`data-theme` on `<html>`, dark tokens also under
  `:root[data-theme="dark"]`); kept in localStorage `pt-settings`. **Help** panel (guide plus troubleshooting).
  **Welcome tour** (6 steps) on first launch (`pt-welcomed`; skipped when `navigator.webdriver`, i.e. in tests;
  `pageTurner.showTour()`), again from Settings or Help.
- **Test 12:** a design pass at the owner's request ("make it look and feel as good as possible", full
  liberty) plus the name ScoreAtlas. Warm paper-and-ink palette with one brass accent (tokens on `:root`, dark mode
  redefined), Fraunces for titles, inline SVG icons (a `<symbol>` sprite in index.html). Top bar: the piece's name is
  the Library button; a page pill in the middle; Mark, View, Loop with labels (icons only under 760 px), Follow as the
  main pill button (brass and a pulsing microphone while listening), Piece. Without sheet music or teaching, Follow
  opens the Piece panel and explains (`data-ready="false"`) instead of being disabled. The Piece panel (`#card`)
  holds page turning (lesson info, Add sheet music, Teach, Forget, Sheet music options as a fold-out), practice
  (report, listen back), the microphone check and "What's new". Teach closes the panel; a Done button sits in the
  "Teaching…" bar (`#teachDone`). One panel at a time (`closePanels`), the library dims the music (`#scrim`), Esc
  closes things. The Pencil marks only while Mark is on (owner's request: no accidental marks); the page gets a brass
  outline in marking mode. Live address after the rename: https://godisgood-code.github.io/ScoreAtlas/.
- **Test 11:** Phase C everyday essentials (roadmap steps 10–13), built at the owner's request without
  waiting for Test 10 feedback (they'll send it with a recording). **Library** (`library.js`, storage in `store.js`:
  `piece|<key>` bytes, `meta|<key>` { name, pages, added, opened, thumb }, `setlists`): every PDF opened is kept (also
  the one left open from before); open, rename, remove (also its lesson, markings, practice history); "Add a PDF";
  replaces the Open PDF button. **Setlists**: make, add pieces, reorder, play; the pedal past a piece's last page opens
  the next (back before page 1: the previous, at its end), Follow carries on (the pedal press allows the microphone);
  a chip in the top bar (app and file name hidden meanwhile). **Pencil** (`marks.js`): the Pencil draws any time;
  ✎ opens the Mark toolbar (black/red/blue pen with pressure, highlighter, fingering 1–5, eraser removing whole
  strokes, Undo, Clear page) and lets a finger draw; touches within 0.6 s of the Pencil are ignored (palm); strokes in
  page fractions, saved as `<key>|marks`. **View** menu: two pages side by side when sideways (pairs 1–2, 3–4; turns
  by two), half-page turns (the next page's top over this page's bottom, split at the blank gap between systems
  nearest the middle; forward goes half then full; while following, half when the highlight reaches the bottom half,
  or halfway through the page's stretch of a taught lesson), and Lock for performing (taps and Pencil do nothing,
  controls hidden, the pedal still works, hold the lock button ~1 s to unlock). Pages are drawn as `.page` units
  (PDF canvas + markings canvas); `shown` lists what is on screen and which part of each page, and highlights,
  loops and practice tints are placed through `entryFor`. Controls over the music no longer count as page taps
  (a tap on the Mark toolbar used to turn the page). **Offline** (`sw.js`): keeps the app's files (network first
  with a 4 s fallback to the kept copy, so updates show at once online; vendor files and fonts kept as they are);
  `manifest.webmanifest` and icons for Add to Home Screen; a "works without Wi-Fi" line in the card.
- **Test 10:** record and replay (roadmap step 9) and a "music starts on page" option. Follow records the
  microphone (`engine/recorder.js`: 16 kHz, 16-bit, on the engine's clock, up to 30 minutes, in memory only); after
  Stop, "▶ Listen back" (practice report or steps card) plays the last session with the highlight (from the
  PracticeLog's positions) and the pages (from the highlight, else the session's turn log) following; −5 s / +5 s,
  a slider, Done; ▶ next to bars in the report plays that moment (a second early). Sheet music options: "The music
  starts on page" (`firstPage`: `shiftPages` for the file's own pages, `withPageStarts(score, starts, first)` with
  bar numbers) so one movement of a multi-movement PDF can be added at a time (only one sheet music per PDF).
- **Test 9 feedback and fixes (published before Test 10):** the owner: "went pretty well"; turns and following much
  better; a little trouble from the bottom of page 5 to the top of page 6; refrains still occasionally jumped to a
  copy on another page although the page showing had one; flipped practice skips went decently; loops worked; report
  "somewhat accurate"; asked for a movable report panel. Their recording: the page 6 turn came during bar 55, they
  held bar 56 for 4.4 s and the follower was then lost 3.5 s (bars 49–60 repeat the same 4 piano bars). Fixes: a
  sheet-music turn never comes before the old page's last bar has begun (`earliest` per turn, 0.2 s into that bar);
  just after losing the pianist, the last 0.8 s is matched against the 5 s after where they were (`nearLost`, two
  agreeing checks) — lost 0.5 s there now; a copy on the page showing (or the next) wins within 1.3x of the best
  (`pageAmbiguity`); the report panel and the steps card can be dragged by their title (place kept).
- **Test 9:** practice tools (roadmap steps 6–8) plus fixes from the owner's Test 8 run. Practice: Follow
  with sheet music keeps a `PracticeLog`; Stop opens a practice report (bars practised most, where they hesitated:
  slowed down, paused, or stopped and went back; tempo bar by bar for the longest run as a graph with a tap tooltip
  and a table; bars on the page tinted by how often they were played); a summary of each session is kept on the iPad
  (`<piece key>|practice` in the lessons store, last 50). Loop: the Loop button, then tap the first and last bar;
  Follow counts repetitions with each one's tempo (shown in the top bar and the report) and, when the pianist stops
  after the loop's last bar, shows the loop's first page again (as a flip hint). The fixes from the Test 8 run (Encourage One Another, a piano accompaniment with a
  two-part choir, scanned with Genius Scan; Audiveris split the choir into 12 parts with garbled names, which made
  "Parts I play" confusing; with only Piano ticked it followed much better; turns felt late; page 2 and 8 trouble;
  slow to find them after skipping in practice). Their recording showed the run-through tracked to within about
  0.1 s, but they lingered on the last bar of pages waiting for the turn (eyes read ahead of the hands). Fixes:
  piano parts ticked by default (`suggestParts`: named piano or 2+ staves, if they hold half the notes) and tiny
  misread parts grouped as one line, with note counts; sheet-music turns 0.5 s earlier (`scoreLead`) and the turn
  lead scaled by the pianist's pace (`pace()`); layout works on crooked phone scans (barlines may drift 2 px between
  staves, two-pixel-wide grey barlines, the staff's real top and bottom line found at each column, outer lines at
  their real positions, title text no longer taken for a staff) — all 10 pages exact now, was about half; practice:
  when copies of the music exist only on far pages, the earliest is picked instead of none, picks stay with the
  copy already chosen, and lookups agreeing for 1.2 s (`farAgree`) move to another page without a flip.
  `tests/real-eval.js` follows a real recording with offline-aligned truth (run-through plus practice sessions cut
  from it, with and without page flips); the owner's files are never committed.
- **Test 8:** fixes from the owner's Test 7 feedback plus two features they asked for. Feedback: "works
  pretty decent", but with passages that recur through the piece it jumped to other copies; turns sometimes came late
  enough that they had to pause; the highlight lagged and jumped back and forth; they couldn't try practice moves
  because the run-through had trouble. Fixes: common-sense rules (while the tracker matches well it never jumps; a
  lookup that lands on another page needs a strong match, or a page flip, or a just-after-pause neighbour page; after a
  pause or when lost, prefer the copy right ahead of where they were), sheet-music turns a full beat early, a quiet
  1.5 s lead-in so bar 1 isn't lost to the room-noise warm-up, page turns wait while the tracking races ahead of the
  pianist's pace (`racing`), and a smoothed highlight (`engine/marker.js`). Features: **bar numbers per page** (sheet
  music from anywhere, e.g. MuseScore, with the owner's own PDF: they type the first bar of each page from page 2; the
  measures are found on the PDF by counting barlines) and **parts I play** (only those parts are in the reference;
  passages where the pianist rests are squeezed out like silences). Both are under "Sheet music options" in the card,
  stored with the sheet music (`scoreFile`, `options`, `partList` on the section), and Apply rebuilds the section.
  The owner is working on Schumann's Piano Concerto (Henle two-piano edition); Audiveris couldn't finish reading it,
  so MuseScore MusicXML plus bar numbers plus the solo part is the suggested route (or Teach).
- **Test 7:** sheet music, no teaching (roadmap steps 4 and 5). "Add sheet music" takes the piece's MusicXML
  (.mxl from Audiveris on the owner's Mac; the owner chose Audiveris), finds its measures on the PDF's pages, synthesizes
  a reference performance in the played order (repeats, endings, D.C./D.S., coda, Fine) and adds it as a section;
  Follow then turns pages without teaching and highlights the measure being played. Taught sections still work and win
  where they fit better. Also fixes from extra turn-critical tests (see Test 6 feedback below).
- **Test 6:** Test 5 plus steadier following. Owner's feedback: sections joined seamlessly, it found them, random
  playing rarely fooled it; twice a turn came late or not at all; asked for more tests to iron out bugs. Turn-critical
  tests found a late turn when resuming right before a turn (pause hold released too slowly); turns are now confirmed
  by either the search check or the tracker's own match versus a random moment (`trackRatio`), which also releases
  the pause hold after 0.3 s of good tracking. The owner's Test 4 feedback: found them in about a second
  after a skip, corrected wrong pages quickly, no early/late/missed turns, but random playing sometimes changed the
  page; they asked for fewer false matches and faster finding. Test 6 checks matches against how well a typical
  place fits (see below), confirms each page turn, notices being lost, and looks up after 0.8 s instead of 1.2 s.
  The owner also asked for bigger checkpoints: do several roadmap steps before each test.
- **Test 5:** teach in sections. Teach starts from the page on screen; each Teach adds a section to the
  piece's lesson (`{ version: 2, sections }`), a new section that fully covers an older one replaces it, and a Forget
  button clears the piece. Follow tracks within one section and searches all of them; at a section's end it looks
  for the pianist again (in the next section, if taught). Lessons from Tests 3 and 4 load as one section.
- **Test 4:** practice mode. Follow starts from the page on screen and finds the pianist anywhere in the
  piece; it keeps up with stops, repeats, jumps back (turning back a page when needed) and skips ahead, and holds
  still while the pianist plays something that isn't in the piece. A page flip by the pianist is a hint.
- **Test 3:** Teach and Follow. The owner tested it on their piano: every page turned by itself at the taught
  moments, no wrong turns, never stuck. The pedal keys work (the "Pedal keys received" line showed them correctly).
- Live at https://godisgood-code.github.io/ScoreAtlas/ through GitHub Pages (repository GodIsGood-code/ScoreAtlas)
  (in cloud sessions, push to the old URL github.com/GodIsGood-code/page-turner: GitHub forwards it, while the new name
  was refused by the session's access), deployed from `main`, root folder.
- The owner approved publishing tested updates straight to `main` (no need to ask each time).
- Test 2 feedback from the owner: single notes without pedal were read well; pedaled chords with uneven voicing
  were not; the display felt slightly delayed. Test 1 was a claude.ai artifact (artifacts can't use the mic).

## Roadmap agreed with the owner

Steps are numbered across phases, in order. Work through them in that order unless the owner says otherwise.

### Done so far

1. **Basics:** PDF display, pedal and tap turns, microphone check.
2. **Teach it once:** automatic page turns after one taught playthrough. Confirmed on the owner's piano (Test 3).
3. **Practice mode (Test 4):** start anywhere, stops, repeats, jumps. Waiting for the owner's feedback.
   **Teaching in sections (Test 5)** was added at the owner's request: teach any section from any page.
   Waiting for feedback.
   Known limit: when the same music appears in two places (a written-out repeat on another page) and the pianist
   jumps between them without flipping the page, the follower may guess the copy on the page that's showing; it
   corrects itself a couple of seconds later, and a page flip by the pianist settles it at once.

### Phase A: Reading the sheet music (the foundation) — built in Test 7, fixed and extended in Test 8

4. **Page turning without teaching.** Turn scans into notes with a reader that also records where each measure sits
   on the page (for example an OMR tool with measure positions, such as Audiveris), build the follower's reference
   from the notes, and handle repeats, D.S. and codas. Teach stays available as a backup for scans the reader
   struggles with.
5. **Measure highlighting.** Highlight the measure being played, live. Comes cheaply once step 4 gives measure
   positions.

### Phase B: Practice tools — steps 6–8 built in Test 9 (owner: worked well), step 9 in Test 10

6. **Practice insights:** which bars were repeated most, and where the pianist hesitated.
7. **Loop a passage:** mark some bars; the app counts repetitions and shows the tempo of each one.
8. **Tempo graph:** tempo bar by bar after a run-through.
9. **Record and replay:** play back a practice run with the measure highlight following along.

### Phase C: Everyday essentials and getting ready to release — steps 10–13 built in Test 11; release groundwork in Test 13

10. **Library and setlists.**
11. **Annotations with Apple Pencil:** fingerings and markings.
12. **Display options:** two pages side by side in landscape, half-page turns, and a performance lock against
    accidental taps.
13. **Offline mode:** works without Wi-Fi at a venue.
14. **Wrong-note detection:** mark the notes that were missed. Needs a trained note-recognition model (for example
    Spotify's Basic Pitch) plus the score from step 4. Moved here at the owner's request (one of the last Phase C
    features).
15. **Release prep:** polish, App Store packaging (for example Capacitor), a look at competing apps, pricing.

### Phase D: Accompaniment (last)

16. **Accompaniment that follows the pianist:** duet partner, orchestra, or whatever the piece needs. Main problems
    to solve: predicting the pianist's next beat (not just reacting to it), the iPad's audio delay, the microphone
    hearing the app's own sound, and good-sounding instruments.

## Owner's setup

- iPad with Safari. Sheet music is mostly scans and PDFs.
- Bluetooth page-turn pedal with forward and back pedals; it works with the app.

## Code

- No build step: plain ES modules served as static files. `package.json` only marks `.js` files as modules for Node.
- `engine/` has no browser APIs, so it runs in Node for offline tests:
  - `fft.js`: radix-2 FFT.
  - `features.js`: microphone samples → 50 frames per second: chroma (12 note names, loudness-compressed), onset
    chroma (notes just struck), `sounding` (music versus the room's learned background), display data.
  - `practice.js`: `PracticeLog` records every live frame (features, follower position when sure, jump count);
    `report()` cuts it into runs (a follower jump elsewhere or moving back over 2 s starts a new one; small
    self-corrections don't), re-aligns each run offline within 1.5 s of the follower's path for exact bar entry times,
    then gives plays per measure, hesitations (pause ≥ 0.8 s inside a bar, a bar 1.6x slower per beat than the bars
    around, or the next run starting at or before the bar a run stopped in, except at the loop's end), bar tempos
    (quarter notes a minute), the longest run and loop repetitions. `report({ refine: false })` skips the re-alignment
    (used live for the loop counter). `busiestPassages`.
  - `recorder.js`: `Recorder` keeps the session's sound (3-sample smoothing, linear resampling to 16 kHz Int16).
  - `marker.js`: `MeasureMarker` smooths the highlight in played order: one measure forward at once, further forward
    after 0.25 s, back after 0.6 s, at once after a follower jump (`moves`); keeps its measure through 1.5 s unsure.
  - `follower.js`: `makeLesson` (from teaching frames and page turns; long silences squeezed out) and `Follower`:
    tracking by online DTW (each live frame advances the lesson by 0–3 frames; turns 0.3 s before the taught
    moment) plus practice logic: states waiting → searching ↔ following (→ finished); looks up the recent 2.5 s
    in the whole piece at the start, after pauses and when lost, and every 0.5 s while following to catch jumps.
    Equally good places (repeats) are told apart by the page on screen, or the page next to it; music that
    sounds the same in several places never moves the page further than that (it may be an untaught copy).
    Costs: good matches about 0.03–0.06, wrong places 0.1 and up, identical passages differ by about 0.015, so
    jumps need a 0.03 margin and 30% better. Scale-free checks against the search's `background` (median cost over
    the piece): real playing matches at under about 0.2 of it, random playing at over about 0.5. A lookup must be
    under 0.35 of it (under 0.2 acts at once, otherwise two lookups must agree; if the full 2.5 s isn't conclusive,
    the last 0.8 s is tried alone); a page turn needs the recent playing near the turn under 0.4; two checks in a row
    over 0.5 mean the pianist is lost. Common sense (Test 8): while `trackingWell` the periodic check never jumps
    (unless the pianist flipped to another page); a lookup result on another page than the one showing must be
    strong (unless flipped there, or the next page just after a pause); re-finds prefer the copy just ahead of where
    the pianist was; turns wait while `racing` (the last second moved over 1.2x the pace of the 2 s before). After losing them, the closest good place within 3 s of where they were wins. Sections: `sectionsOf`, `addSection` (drops sections the new one
    `covers`: its opening and ending found in the new one at cost ≤ 0.08, in order, about the right length),
    `flatten` (sections end to end; tracking and search never cross a section boundary).
  - `search.js`: subsequence DTW over a coarse copy of the lesson (groups of 4 frames).
  - `xml.js`: small XML parser. `score.js`: reads MusicXML/.mxl (notes carry `part`; `parts` lists names and staves;
    `keepParts`, `withPageStarts` for typed page-start bar numbers, `parsePageStarts`, `barNumbers`) (fflate unzips) into measures (notes in quarters,
    page and system from `<print new-page/new-system>`, repeats, endings, segno/coda, D.C./D.S./Fine from `<sound>` or
    words, including OCR-garbled "al Fine") and `playOrder` (unfolding). Audiveris exports no measure
    widths, and may split a piano into extra parts, so staves per system come from the image.
  - `synth.js`: additive piano-like synth. `scorelesson.js`: score → synthesized audio (22.05 kHz, faint hiss so the
    noise learner works) → features → a section with `fromScore`, `measure` per frame and page turns half a beat
    a beat before each new page (`leadBeats`), after a quiet 1.5 s lead-in; `played` per frame (played-order index)
    and the app stores `order` (played index → measure). Score sections match real playing less closely (fit about 0.35–0.6 of the background versus
    about 0.15 for taught), so they have their own limits (`FOLLOW_SETTINGS.score`).
  - `layout.js`: finds staves (ink peaks, five evenly spaced lines scored by ink), systems (count from the score,
    staves per system by spacing), barlines (solid through every staff, credit for crossing the gap; best-spaced set)
    and returns measure boxes as page fractions. `findMeasuresByCount` (bar-number mode, and the fallback when the
    file's systems don't fit): only the page's measure count is known; staves of a size, systems by gaps, and each
    system's count chosen by dynamic programming over barline clarity plus a share-by-width prior.
  - `hearing.js`: the "Hearing" note display.
- `audio/capture-worklet.js` (audio thread) → `listen.js` (`Microphone`) → `FeatureExtractor`.
- `store.js`: IndexedDB on the device: lessons keyed by PDF fingerprint plus page count (also `<key>|marks`,
  `<key>|practice`), the last opened PDF, the library and setlists.
- `library.js`: the library panel (pieces and setlists). `marks.js`: Pencil markings. `sw.js`: offline.
- `app.js`: viewer, pedal, taps, Teach and Follow, test card. `window.pageTurner` exposes the audio clock and a
  log of page turns for tests and troubleshooting.
- `vendor/pdfjs/`: pdfjs-dist 4.10.38, *legacy* build so older iPadOS Safari works. Apache-2.0.
- `vendor/fflate/`: fflate 0.8.2 (unzips .mxl). MIT.
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
    tests/output/perf`: 18 practice sessions (start mid-piece with and without flipping, repeats, jump back with and
    without a flip, skip ahead, a repeated section, back over a page turn, fast, slow, noisy, and noodling: F-sharp
    pentatonic, plus scales, random notes, chords and a made-up tune in the piece's key, and a warm-up before
    starting). Currently found within 4 s after 44/45 restarts (about 0.8 s typically), 31/32 page breaks on time,
    0 stray page changes; the misses are the known identical-copy case (p_jump_back).
  - `python3 tools/synth_performances.py tests/output/perf --sections` then `node tests/sections-eval.js
    tests/output/perf`: teaching in sections (replacement, three overlapping sections, out of order, an untaught gap,
    practice sessions with sections). Currently all pass (14/14 found, 10/10 turns).
  - `node tests/recorder-unit.js`: the recorder (length, clock, a 440 Hz tone kept, the limit).
  - `node tests/practice-unit.js`: practice insights from made-up sessions (plays, hesitations, tempo, loop).
  - `node tests/real-eval.js SCORE.mxl RECORDING.wav --parts 12 --end 139`: a real recording (convert a Voice Memo
    with ffmpeg to 22.05 kHz mono WAV) that begins with a run-through: truth by offline alignment, the run-through's
    turns (seconds before each new page's first bar), position error and highlight, then practice sessions cut from it
    with and without page flips. Never commit the owner's files. On the owner's Encourage One Another (Test 8 run):
    position error median 0.00 s, highlight 86% right and 99% within a bar, 0 stray changes, practice with flips
    found in about 1 s (bars 1–9 in 4.9 s, an identical copy of bars 25–33).
  - `node tests/score-unit.js`: reading MusicXML and play order (repeats, endings, D.C., D.S. al Coda, ties, voices).
  - `python3 tools/make_test_scores.py tests/output/scores`: the A A B A piece written with repeats (3 pages) and with
    D.C. al Fine (2 pages) as MusicXML and PDF, and a performance of the sample score. Then run Audiveris on the PDFs
    into `tests/output/scores/omr/` and `node tests/score-eval.js` (follow the A A B A performances from the scores and
    from Audiveris's readings, bar numbers 5, 13 on the repeat version, and a duet with an orchestra part and 8 bars
    where the piano rests, followed with the solo part only; currently all pass) and `node tests/layout-eval.js`
    (measures found on every page, also in bar-number mode against counts read off the pages by eye).
  - `python3 tools/synth_performances.py tests/output/perf --rondo`, the rondo in `make_test_scores.py` (A B A C A B A,
    one section per page) and Audiveris on `aba_rondo.pdf`, then `node tests/rondo-eval.js`: refrains on many pages.
    Currently 42/42 turns on time, 0 stray, highlight on the right measure 98% (always within one).
  - Audiveris in this container: `git clone https://github.com/Audiveris/audiveris`, comment out `javax.media:jai-core`
    in `app/build.gradle` (unreachable here, unused), `JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 ./gradlew
    :app:installDist` (apt `openjdk-25-jdk-headless`), and for text (D.C., Fine) `TESSDATA_PREFIX` pointing at
    `eng.traineddata` from tesseract-ocr/tessdata tag 4.1.0. Run: `app/build/install/app/bin/Audiveris -batch -export
    -output OUT file.pdf`.
  - `NODE_PATH="$(npm root -g)" node tests/score-follow.cjs`: real browser, `tests/fixtures/aba_dc.pdf` plus Audiveris's
    `aba_dc.mxl`, no teaching: turns to page 2 and back for the D.C., measure highlight shown, then bar numbers typed,
    applied and kept after a reload; also the practice report (dragging it), listening back (plays, highlight follows,
    seeking to 50 s shows page 2) and picking a loop.
  - `NODE_PATH="$(npm root -g)" node tests/phasec.cjs`: library, setlists (pedal to the next and previous piece),
    Pencil (a synthetic pen, a palm touch ignored, Mark mode, highlighter, Undo, fingering, kept after reload),
    half-page and two-page views, the lock, and offline (service worker, reload offline, open from the library).
  - `python3 tools/synth_performances.py tests/output/short --short` then
    `NODE_PATH="$(npm root -g)" node tests/teach-follow.cjs`: real-browser Teach, Follow and Practice with a fake
    microphone (about 2.5 minutes).
- Claude can't hear the owner's piano. Ask for their observations; for tuning, recordings of the same piece played
  two or three times (Voice Memos is fine) plus its PDF.

## Working with the owner

- Use plain language and give step-by-step instructions for anything they must do on GitHub or the iPad.
- The repository is public: never commit the owner's sheet music or recordings.
