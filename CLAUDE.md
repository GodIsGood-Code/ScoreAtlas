# ScoreAtlas

The app is called **ScoreAtlas** (named by the owner; the GitHub project was renamed from page-turner, the local
folder may still be `page-turner`). A web app, iPad first, that shows sheet music and turns pages automatically by listening to the piano.
The owner is a pianist with little coding experience. Claude writes the code and explains things in plain
language; the owner tests on their iPad and reports back.

## Versions (the owner's scheme, replacing "Test N")

0.1 was the very first version. Each release adds, by its biggest change: **0.1** for a big change (like Teach, or
following straight from the sheet music), **0.0.1** for a smaller addition (like the metronome), **0.0.0.1** for bug fixes
and UI remaps. The App Store launch is **1.0**. Shown in Settings → About (the top bar's tag and "What's new" were removed for 1.0); the iPad
app's version is set in `native/ios/App/App/Info.plist` (`CFBundleShortVersionString`, and `CFBundleVersion`, the build
number: raise it for every upload; App Store versions allow at most three numbers, so a fix-only 0.x.y.z release keeps
the iPad app at 0.x.y with a higher build number). Never edit `project.pbxproj` for versions: Xcode writes the owner's
Team into it, and their local copy then conflicts with our changes when they pull (happened at 0.5.4.1). History, by release: Test 1 (artifact) 0.1 · Test 2
0.1.1 · Test 3 (Teach and Follow) 0.2 · Test 4 (practice mode) 0.2.1 · Test 5 (sections) 0.2.2 · Test 6 (fixes)
0.2.2.1 · Test 7 (sheet music) 0.3 · Test 8 0.3.1 · Test 9 0.3.2 and its fixes 0.3.2.1 · Test 10 0.3.3 · Test 11
(library, Pencil, display, offline) 0.4 · Test 12 (design pass) 0.4.0.1 · Test 13 0.4.1 · Test 14 0.4.2 · Test 15
(wrong-note detection) 0.5 · Test 16 0.5.1 · Test 17 0.5.2 · 0.5.3 · 0.5.4 · 0.5.4.1 · **0.5.4.2** (current). The "Test N" entries below are those releases.

## Status

- **0.5.4.2:** the owner's launch polish list (free for the foreseeable future; no competitor comparison wanted).
  Top-bar version tag and "What's new" removed; a **Beta** pill on Check my notes (`.beta`); **open-source licenses**
  in Settings → About (`details.licenses`; Capacitor line `app-only`). **Accessibility**: `tests/a11y.cjs` (axe-core
  4.10.3 from `npm pack`, path in `AXE`) on ten screens in light and dark, all pass: the library card is now a
  `div.lib-piece[data-piece=NAME]` holding a `button.lib-open` (picture and name) beside Rename/Remove (tests select
  `.lib-piece[data-piece="…"]`), the color wheels' label moved to the inputs and their chosen state is `data-on`.
  **Speed** (`tests/speed.cjs`, Chromium CPU throttled 1/4/6x): listening keeps up at 6x (1.00), page turns 75–140 ms,
  following busy under 1% of the time, first launch with the sample ready 2.6/8.4/12.7 s, Hear the music starts in
  1–5 s, adding PDF+sheet music 1.2–6.2 s; nothing needed fixing. **Bug found by the screenshots**: the sample's
  MusicXML had no `<print new-system>`, so all of a page's bars were boxed as one line (wrong highlight, loops,
  tints): `make_sample_xml.py` now adds line breaks from Verovio's SVG systems, addScore finds the lines from the
  picture (`findMeasuresByCount`) when a file never starts a new system, and `fixSample()` re-adds the corrected
  sheet music when an old copy of the sample is opened. **Store**: `release/app-store.md` final for 1.0 (description
  3504 characters), `release/screenshots/` (8, 2064×2752 and one 2752×2064, made by `tools/make_screenshots.cjs`
  from the sample only), checklist updated; privacy page mentions kept takes. iPad app CFBundleVersion 3.
- **0.5.4.1:** owner: in Move mode the Pencil drew and markings wouldn't move. Cause: GitHub Pages serves files with
  `max-age=600`, so right after a publish the browser can mix new files (index.html/app.js with the Move tool) with an
  old cached marks.js (no "move": unknown tools draw like the pen); reproduced by serving 0.5.3's marks.js with the
  new app. Fixes: sw.js fetches the app's own files with `cache: "no-cache"` (revalidate; cache `page-turner-v5`);
  marks.js exports `MARKS_BUILD` (2), read through a namespace import in app.js (a missing named import would stop the
  app), and a mismatch clears the kept caches and reloads once (`pt-reloaded` in sessionStorage). Bump `MARKS_BUILD`
  (and app.js's check) when app.js starts relying on something new in marks.js. iPad app: CURRENT_PROJECT_VERSION 2.
- **0.5.4:** the owner's tweak request: move markings after placing them, and pinch while marking (they zoom in to
  write small). **Move** tool in Mark (`data-tool="move"`, first in the row): `hitAt` finds the topmost marking within
  16 px (`bounds` for text/stamps/notes, points for strokes), dragging shifts it (`shift`) with a dashed brass outline
  (`drawWith(page, null, picked)`), undo entry `{ moved, from }`; on an empty spot it lets the stand handle the touch
  (one-finger pan when zoomed; a tap never turns the page while Mark is on). **Pinch in Mark mode**: the stand's
  capture handler counts only non-Pencil pointers; a second finger starts a pinch with any tool and
  `marks.cancelActive()` drops the stroke/tap/drag the first finger began (erasing so far stays undoable); marks are
  disabled while `pinch`. Stamps, finger numbers and text are placed on pointerup (a tap: under 14 px of movement), not
  pointerdown. test17.cjs covers it (pinch draws nothing, a stamp dragged 120×60 px, Undo, no page turns).
- **0.5.3:** the owner's picks from Claude's clutter review. **Practice → History**: the report panel (`#report`) became
  "Practice history" with tabs (`#historyTabs`, `historyTab`, `setHistoryTab`, `openHistory`): Last session (the
  report; heat tints and note badges show only on this tab), Kept takes (`showTakes` renders into `#takesBody`) and
  Journal (`showJournal`); Stop opens it on Last session; the journal and takes panels and the menu's report /
  listen back / takes / journal items are gone (Listen back sits in the panel's head). **Microphone check** moved from
  the Piece panel to Help → "Check the microphone and the pedal" (`#micCheck`; drawn only while open; a microphone
  problem opens it, with app-specific wording in the iPad app). **Stamps**: the owner wanted more, not fewer: 41
  (`STAMPS`: ppp…fff, fp, sf, sfz, rf, hairpins, cresc./dim./rit./accel./a tempo/una corda/tre corde in italic words,
  accent, marcato, staccato, tenuto, fermata, tr, mordent, turn, arpeggio, 8va/8vb, breath, caesura, Ped., release,
  segno, coda, circle, check, glasses); the stamp row scrolls sideways inside the toolbar (`.markbar` no longer
  wraps: in a wrapping column flex each line grew to its content). **Sample with sheet music**:
  `samples/warm-ups.musicxml` (`tools/make_sample_xml.py` joins make_sample.py's four pages with `<print new-page>`,
  parts named Piano right/left hand); on first launch `addSample` puts the sample in the library and adds its sheet
  music (`pt-sample-added`; skipped under `navigator.webdriver` unless `pt-test-sample` is set; native-sim checks it);
  followed from `warmups_play.wav`, each page turns about 1.3 s ahead. Reviewer notes updated.
- **Test 17:** the two features the owner picked from Claude's short list, and **App Store packaging** (owner has
  Xcode). **Pinch to zoom** (`zoom` { z, x, y, res } in app.js): two pointers on the stand zoom around their midpoint
  (`zoomTo`, CSS transform on `.sheet`, 1–4x), one pointer pans while zoomed (taps still turn pages; a drag isn't a
  swipe), clamped so the music covers the screen (`clampZoom`), Ctrl+wheel on a computer; 300 ms after the fingers
  stop the pages are drawn again at 1.5/2/3/4x resolution (`zoom.res` in `layoutKey` and the render scale); a turn
  keeps the zoom and shows the new page from its top; "Whole page" chip (`#zoomChip`); not in Mark mode or locked;
  a new piece starts unzoomed. **Kept takes**: Keep this take (report, or the replay bar's `#rpKeep`) saves the last
  session as `<key>|take|<id>` { name, date, rate, duration, startTime, samples: Int16 16 kHz (about 2 MB a minute),
  track: bar every 0.1 s (`barTrack`), turns, firstPage, hand } with an index `<key>|takes`; Practice → Kept takes
  (`showTakes`): play (replay now takes any recording: `startReplay(at, R)`, `replay.R`, `R.track` for the
  highlight, `#rpTitle`), rename, share as WAV, delete; removed with the piece, moved by Edit pages, in backups.
  **Fonts** built in (`vendor/fonts/`, Fontsource woff2, OFL) instead of Google Fonts; privacy page updated.
  **iPad app** (`native/`, Capacitor 8.6.0, Swift Package Manager): `npm run build` = `copy-web.mjs` (sw.js's file
  list + licenses → `www/`) + `npx cap sync ios`; `ios/App/App/public/`, `capacitor.config.json` and `config.xml` are
  committed so the owner's Mac needs only Xcode (Capacitor itself comes from GitHub through SPM). App ID
  `io.github.godisgoodcode.scoreatlas` (owner may change it), iPad only (`TARGETED_DEVICE_FAMILY = 2`), iOS 15+.
  `SceneDelegate.swift`: `ScoreAtlasViewController` (a `CAPBridgeViewController`) with a `scoreAtlas` message handler
  ({ ready } → hands over waiting files; { keepAwake } → `isIdleTimerDisabled`); files opened with ScoreAtlas (cold
  start or later) are copied to tmp/Opened and passed to `window.scoreAtlasOpen(fileURL, name)`, which fetches them
  through `Capacitor.convertFileSrc` and calls `addFiles`. Info.plist: microphone text, PDF / MusicXML / .scoreatlas
  document types (imported UTIs com.recordare.musicxml[.compressed], exported io.github.godisgoodcode.scoreatlas.bundle),
  `LSSupportsOpeningDocumentsInPlace` false, `ITSAppUsesNonExemptEncryption` false, arm64. Web side: `NATIVE`,
  `native(msg)`, `.native` on `<html>` (`.web-only` / `.app-only` help lines), links to privacy/support/the Mac
  helper are absolute (they open in Safari). Icon redrawn at 1024 and the launch screen by `tools/make_icons.py`.
  `native/README.md`: the owner's steps (GitHub Desktop, open App.xcodeproj, Team, Run; Developer Mode; archive and
  upload) and how to update. Not built here (no Xcode in the container): the Swift was checked against Capacitor 8's
  sources; the owner's first run is the real test.
- **Test 16:** the owner's Test 15 feedback (liked everything; following tracked well on run-throughs and better in
  practice, but still went to the wrong place at times while they played something on the page; asked for a pen-size
  slider, a color wheel, typed metronome tempo and more beat types; couldn't verify Check my notes, so Claude was to
  verify it from their recording) plus features 1–6 and 8 of the suggestions, the easier sheet-music import, a Mac
  helper, and a UI remap ("the absolute best possible"). **UI:** top bar Library · page · Mark · **Practice** (menu:
  Hands Both/Left/Right, Loop a passage, Trouble spots, Hear the music, Metronome; Last session's report, Listen back,
  Practice journal) · View (display, lock, Settings/Help) · Follow · Piece (page turning, **Pages → Edit pages**,
  Share, microphone). Under 1060 px the tools' labels sit under their icons (`.btn.tool` column). A brass dot on
  Practice while a loop, one hand or the music is on. **Mark toolbar**: tools row (Pen, Highlight, Text, Stamps, 1–5,
  Eraser; Undo, Clear page, Done) and an options row (3 inks + `<input type=color>` wheel; highlighter colors + wheel;
  fingers; stamps drawn on canvases; size slider 0.3–3), kept in `pt-pen`. Stamps (`STAMPS`, `drawStamp`: pp…ff, sfz,
  hairpins, accent, staccato, tenuto, fermata, breath, caesura, Ped., release, circle, check, glasses) as
  `{ t: "stamp", k, x, y, c, z }`; text notes `{ t: "note", s, ... }` typed in `#noteInput`. **Metronome card**: typed
  tempo (`#metroTempo`), slider 20–300, tap tempo, beats 1–12 over 2/4/8 (compound x/8 grouped in threes), 1–4 clicks
  a beat, tempo name, beat dots, draggable; `pt-metro`; the ladder compares in the metronome's own beats.
  **Hands** (`keepHand` in score.js; notes now carry `staff`): one-hand reference built by `handLesson` (cached per
  piece and hand), used by Follow, Hear the music and Check my notes; session summaries keep `hand`. **Hear the music**
  (`startHear`): the score (one hand if chosen) synthesized from the first bar on the page showing, up to 4 minutes,
  speed 40–150% (re-synthesized from the playing bar), highlight and pages follow; mode `hear`. **Trouble spots**
  (`engine/trouble.js`): bars scored from the last 8 sessions (hesitations, Check my notes results kept as
  `notes.byMeasure`, bars under 0.75x the tempo around), passages of up to 4 bars; tapping one sets the loop, opens the
  metronome at 70% of the pianist's tempo there with the ladder up to it, and moves to the next spot at the goal.
  **Mistake history**: Check my notes results saved in the session summary (`keepNoteCheck`); the journal's "Notes over
  time" (`noteHistory`: per-100 rate chart, bars still tripping, bars fixed). **Not in my music** (report) adds notes to
  `<key>|ignore`, skipped by `checkNotes`. **Edit pages** (`pages.js`, pdf-lib 1.17.1 in `vendor/pdf-lib/`): thumbnails,
  move, turn, take out (blank pages found by ink), add pages from PDFs; Save replaces the piece (new key: markings
  remapped with rotation by `remapMarks`, bookmarks, practice history, setlists moved, old piece removed, sheet music
  re-added with its options; taught sections dropped), or Save as a copy. **Add music** (Library; `importer.js`
  `pairFiles`): several files at once; PDFs paired with .mxl by name (`baseName` drops `.mvt1`, `(1)`, punctuation),
  sheet music for a kept piece of that name, a lone PDF + lone .mxl together, `.scoreatlas` bundles restored.
  **Share a setlist**: `makeBackup({ keys, setlist })` (those pieces' PDFs, lessons, markings; no practice or
  settings), opened with Add music. **Mac helper** (`mac/`): `Install ScoreAtlas Reader.command` finds Audiveris,
  writes `~/Library/Application Support/ScoreAtlas Reader/read.sh` (Audiveris `-batch -export`, copies the PDF and its
  .mxl into iCloud Drive/ScoreAtlas, notifications, log in ~/Library/Logs) and compiles a droplet app on the Desktop
  with `osacompile`; `mac/ScoreAtlas-Reader.zip` keeps the executable bit; tested here with stand-in Mac tools.
  **Following** (their recording, 6.8 min of practice): the reference built from sheet music had no quiet before
  bar 1 while the live query began with quiet, so starting at bar 1 matched badly and Follow jumped to identical bars
  25–27 on page 3: `search()` now drops quiet before the playing (when 0.8 s+ of it remains); the page on screen when
  Follow starts holds like a flipped page (`anchor` from the constructor's `page`; the clock runs only while
  playing), and the periodic check goes back to the anchor's copy when it fits within `pageAmbiguity` of where the
  follower is (on rec3 with flips 93% → 95%, rec4 95%; synthetic suites unchanged); once the music has been heard
  on the anchor's page (`seen`), a jump elsewhere drops the anchor (the pianist moved on; teach-follow's restart). **Check my notes verified** on
  that recording: an independent onset-energy check from the audio (FFT at the written pitch's harmonics) shows
  flagged-missed notes have little new energy (median 0.6 versus 2.3 for notes judged played; about 88% look truly
  absent); the false flags came from wrong bar times (follower on another copy, squeezed bars): runs of playing with
  over 40% of notes not found are now left out (`runUnsure`): 204 → 127 missed of 1249; 13 notes flagged every time
  (likely OMR additions or notes the owner leaves out) → Not in my music. Release checklist updated
  (`release/README.md`), store description (3278 characters) and support page mention the new features and the helper.
- **Test 15:** the owner's Test 13/14 feedback ("really like all the features", UI good; followed well on
  run-throughs but had trouble finding them in practice: even after flipping to the page, it skipped to a section that
  was only similar), plus **wrong-note detection** (roadmap step 14). US spelling everywhere ("Practice", the owner
  lives in the U.S.). **Pen sizes** in Mark (thin, medium, thick: `marks.size` scales pen, highlighter and fingering
  numbers). **Page anchor** (follower): the page the pianist turned to holds for 30 s (`anchorTime`, renewed while
  they play on over natural turns); a lookup or the periodic check may leave it only with a strong match at most 0.6x
  the cost of the best place on that page or the pages beside it (`anchorRatio`, `anchorBest`, `leavesAnchor`;
  otherwise a lookup takes the anchor's best place if it is good, or waits); score sections' `alikeMargin` 0.03. On
  their recording with flips simulated at each restart: right page 86% → 93% (without flips 76% → 83%); synthetic
  suites unchanged. **Check my notes** (practice report, with sheet music): `pitch.js` runs Spotify's Basic Pitch
  (`vendor/basic-pitch/`, Apache-2.0, patched to free its tensors) on TensorFlow.js 3.21.0 (`vendor/tfjs/`, WebGL,
  else CPU), loaded on first use, over the session's recording (the stretches played with sheet music, the last 12
  minutes) in 30 s pieces; `engine/notecheck.js` compares the notes heard with the written ones timed from the
  report's bar entry times (see Code). Results in the report (worst bars, "missed E5 · played F5 for E5") and red
  badges on those bars while it's open; `pageTurner.notecheck`. `tools/basic_pitch_node.mjs` runs the same model in
  Node; `tests/notecheck-eval.js` scores it on the synthetic `mistakes` performance.
- **Test 14:** features the owner picked (1, 3–7 of the suggestions): **backup and restore** (`share.js`:
  `makeBackup` zips both IndexedDB stores (typed arrays as binary entries) plus settings into a `.scoreatlas` file;
  `restoreBackup` puts them back, merging setlists; Settings → Backup), **practice journal** (`journal.js`: minutes a
  day for two weeks, bars getting faster, still-tricky bars, recent sessions; Piece → Practice journal), **metronome
  and tempo ladder** (`metronome.js`: visible beat, optional click (the mic hears it); with a loop, each clean
  repetition at ≥ 93% of the ladder tempo steps it up toward a goal; View → Metronome), **go to** a page, a bar
  (with sheet music) or a bookmark (`<key>|bookmarks`; tap the page number), **trim margins** (ink bounds per page
  from a small render, PDF.js viewport offset; `canvas.crop`; boxes and markings go through `shownX/shownY` and the
  markings layer's crop) and **dark pages** (CSS invert on `.page`), **share with a teacher** (a PDF with markings
  drawn in, built by `buildPdf` from JPEG pages; the last recording as WAV; through the share sheet or a download).
  `tests/extras.cjs` and `tests/extras-unit.js`. The owner's name and email are on the privacy/support pages at
  their request.
- **Test 13:** release groundwork. `release/` holds the App Store listing (`app-store.md`: name, subtitle,
  description, promotional text, keywords, category, age rating, microphone permission text, App Privacy answers
  "Data Not Collected", reviewer notes, screenshot plan; lengths checked) and a release checklist (`release/README.md`).
  `privacy.html` and `support.html` (styled by `doc.css`) are the policy and support URLs on the live site; contact
  is the owner's name and email, which the owner asked to publish (Ethan Chen, heart.of.Eitanium@gmail.com), plus the GitHub issues page. The app will launch free (owner). In the app: **Settings**
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
  with sheet music keeps a `PracticeLog`; Stop opens a practice report (bars practiced most, where they hesitated:
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
  staves, two-pixel-wide gray barlines, the staff's real top and bottom line found at each column, outer lines at
  their real positions, title text no longer taken for a staff) — all 10 pages exact now, was about half; practice:
  when copies of the music exist only on far pages, the earliest is picked instead of none, picks stay with the
  copy already chosen, and lookups agreeing for 1.2 s (`farAgree`) move to another page without a flip.
  `tests/real-eval.js` follows a real recording with offline-aligned truth (run-through plus practice sessions cut
  from it, with and without page flips); the owner's files are never committed.
- **Test 8:** fixes from the owner's Test 7 feedback plus two features they asked for. Feedback: "works
  pretty decent", but with passages that recur through the piece it jumped to other copies; turns sometimes came late
  enough that they had to pause; the highlight lagged and jumped back and forth; they couldn't try practice moves
  because the run-through had trouble. Fixes: common-sense rules (while the tracker matches well it never jumps; a
  lookup that lands on another page needs a strong match, or a page flip, or a just-after-pause neighbor page; after a
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
  - `trouble.js`: `troubleSpots(sessions, count)` and `troubleText` (see Test 16).
  - `notecheck.js`: wrong-note detection. `expectedNotes(bars, measures)` times the written notes from the bar entry
    times; `checkNotes(expected, heard)`: written and heard chords lined up by dynamic programming (`alignTimes`, so
    rubato inside a bar doesn't count as missing), then a written note is fine if heard at its pitch within 0.15 s (or
    10% of the bar), an octave off, as a quick repeat (within 0.3 s) of the same note still sounding, or in the notes
    heard less strictly (`soft`, onset 0.25) within 0.08 s when not an overtone of a louder note below nor spill-over
    from a note a semitone or two away (which would hide a wrong note); "wrong" when
    a loud note (model amplitude ≥ 0.35) within 4 semitones was heard instead that isn't written nearby, an overtone
    or an echo; bars with over 60% missing are left out ("unsure", timing rather than playing); notes below C2 are
    not checked. `PITCH_SETTINGS` (the model's thresholds: onset 0.4, frame 0.3; soft 0.25/0.25) are shared with
    `pitch.js` and the Node tool. The model hears nearly every note played, but adds overtones and echoes, and misses
    very soft notes. `pitch.js` pads each 32 s piece with silence on WebGL: TensorFlow.js fails to build a shader
    ("getT1: no matching overloaded function") for some lengths (26–27 s in headless Chromium); it tries 32, 33, 34 s,
    then the CPU. Test 16: `checkNotes(expected, heard, cfg, soft, ignore)`; runs of playing (played index going on,
    gaps under 2.5 s) with over 40% not found become "unsure".
- `audio/capture-worklet.js` (audio thread) → `listen.js` (`Microphone`) → `FeatureExtractor`.
- `store.js`: IndexedDB on the device: lessons keyed by PDF fingerprint plus page count (also `<key>|marks`,
  `<key>|practice`), the last opened PDF, the library and setlists.
- `library.js`: the library panel (pieces and setlists; Share). `marks.js`: Pencil markings (stamps, text notes).
  `sw.js`: offline (cache `page-turner-v2`). `pages.js`: Edit pages. `importer.js`: pairing added files.
  `metronome.js`: `Metronome` (beats, unit, subdiv, tap) and `TempoLadder`. `journal.js`: journal and `noteHistory`.
- `mac/`: the ScoreAtlas Reader helper for the owner's Mac (see Test 16).
- `native/`: the iPad app (Capacitor 8; see Test 17 and `native/README.md`). Rebuild it (`cd native && npm install &&
  npm run build`) and commit `native/ios/App/App/public/` whenever the web app changes before an App Store upload.
- `vendor/fonts/`: the app's typefaces (Atkinson Hyperlegible 400/700, Fraunces 600, IBM Plex Mono 500). OFL.
- `vendor/pdf-lib/`: pdf-lib 1.17.1 (ESM, minified; edits PDFs losslessly). MIT.
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
  - `NODE_PATH="$(npm root -g)" node tests/test17.cjs`: pinch to zoom (synthetic two-finger pointers: 3x, sharper
    redraw, one-finger pan without a turn, a turn keeps the zoom from the top, Whole page) and kept takes (keep after a
    session with the fake microphone, rename, play after a reload with the highlight, share as WAV, delete).
  - `AXE=…/axe.min.js NODE_PATH="$(npm root -g)" node tests/a11y.cjs`: accessibility (WCAG 2.1 AA) on the main screens.
  - `NODE_PATH="$(npm root -g)" node tests/speed.cjs 1,4,6`: timings with the CPU slowed (older iPads).
  - `NODE_PATH="$(npm root -g)" node tests/native-sim.cjs`: `native/www` served with stand-ins for Capacitor and the
    message handler: opens, says ready and keep awake, fonts built in, a handed-over file opens, web-only help hidden,
    no missing files, no requests outside the app.
  - `node tests/test16-unit.js`: trouble spots, pairing files, one hand, markings moved with pages, the metronome's
    accents and tap tempo, notes over time.
  - `NODE_PATH="$(npm root -g)" node tests/test16.cjs`: real browser, about a minute: Practice tools off without sheet
    music, PDF + .mxl added together, left hand, Hear the music (and a new speed), trouble spots from a seeded
    history (loop, metronome, ladder), notes over time in the journal, Edit pages (a stamp moves with its page, sheet
    music matched again, library replaced) and sharing a setlist (a .scoreatlas download).
  - `node tests/notecheck-unit.js`: the note check on made-up notes (dropped, wrong, octave, rubato, soft notes,
    overtones, spill-over beside a wrong note, unheard bars, merged repeats).
  - Wrong-note detection: `npm install @tensorflow/tfjs@3.21.0` somewhere outside the repository, then
    `NODE_PATH=THERE/node_modules node tools/basic_pitch_node.mjs tests/output/perf/mistakes.wav --raw` (about 2x
    real time; `--raw` keeps the model's output so `--from-raw --onset X --frame Y` tries other thresholds in seconds),
    then `node tests/notecheck-eval.js mistakes [--follow] [--list] [--no-soft]` (truth from the performance's own
    notes; `--follow` takes bar times from following, as the app does). Currently 90% of the 29 mistakes found (89%
    following), 0–0.3% of correct notes flagged; `ref` 0%, `voicing` (soft accompaniment) 3.6%. On the owner's
    Encourage One Another (first 70 s of a run-through, 442 notes): 24 missed and 2 wrong flagged (was 54 before the
    chord alignment and soft notes), some probably repeated notes not restruck and notes the OMR misread (an F♯5 in
    bars 25–27 never heard anywhere).
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
