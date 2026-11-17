# ScoreAtlas

Sheet music on the iPad that turns its own pages by listening to you play.

**Try it:** https://godisgood-code.github.io/ScoreAtlas/ (open it in Safari on an iPad)

## What works now (Test 16)

- Open a PDF (scans work) and read it one page at a time. The app reopens your last PDF next time.
- Turn pages with a Bluetooth page-turn pedal, by tapping (right side forward, left side back), or by swiping.
- **Teach:** play a piece, or any section of it, turning pages yourself. The app remembers how it sounds and where
  you turned. Teach more sections whenever you like; they add up, and re-teaching a section replaces it.
- **Follow:** play it again and the app turns the pages for you. Start anywhere: it finds where you are and keeps
  up when you stop, repeat a few bars, go back or skip ahead.
- **Sheet music:** add the piece's MusicXML file (for example from Audiveris, which reads scanned PDFs) and the app
  follows the piece without teaching, repeats and D.C./D.S. included, highlighting the measure you're playing.
  Sheet music from elsewhere (MuseScore, say) works with your own PDF: type the first bar of each page. For a piece
  with orchestra or other players, tick only the part you play.
- **Practice report:** after following with sheet music, see the bars you practiced most, where you hesitated, and
  your tempo bar by bar. **Loop** a passage and the app counts the repetitions and shows the tempo of each. **Listen back** to a session
  with the highlight and pages following along. **Check my notes** listens to a session for missed and wrong notes
  and marks those bars on the music. A **practice journal** shows your practice across days, and a **metronome** with
  a tempo ladder speeds a loop up as you get it clean.
- **Library and setlists:** every PDF you open is kept; play a setlist and the pedal goes from piece to piece.
- **Practice menu:** loop a passage, work through your **trouble spots** (the bars you stumble on, looped with the
  metronome, faster each clean time), practice **hands separately**, **hear the music** from any page at any speed, and
  a **metronome** with any time signature, subdivisions and tap tempo.
- **Apple Pencil:** pens in any color and size, highlighters, text notes, stamps (dynamics, accents, fermata, breath
  and pedal marks), fingering numbers, eraser, undo.
- **Edit pages:** take out blank pages, reorder, turn sideways scans, add pages from another PDF.
- **Add music:** a PDF and its sheet music together, several pieces at once; share a setlist with its music. On a Mac,
  [ScoreAtlas Reader](mac/README.md) turns PDFs into sheet music with Audiveris and puts both in iCloud Drive.
- **Display:** two pages side by side when the iPad is sideways, half-page turns, a lock for performing, trimmed
  margins and dark pages. Tap the page number to go to a page, a bar or a bookmark.
- **Backup and sharing:** everything in one backup file; send your teacher the PDF with your markings or a recording.
- **Offline:** works without Wi-Fi once loaded; add it to the Home Screen for an app icon.
- Settings (page-turn timing, highlight, tap to turn, light or dark), a Help guide and a welcome tour.
- A microphone check that shows which notes the app hears.

Everything stays on your iPad.

## What's next

Getting ready for release (App Store packaging), then an accompaniment that follows you.

## Running it on a computer

Serve the folder with any static web server, for example `python3 -m http.server`, then open http://localhost:8000.
See `CLAUDE.md` for the tests.

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), included in `vendor/pdfjs/`. Notes are
heard with Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Apache-2.0) and
[TensorFlow.js](https://github.com/tensorflow/tfjs) (Apache-2.0), in `vendor/basic-pitch/` and `vendor/tfjs/`.
MusicXML files are unzipped with [fflate](https://github.com/101arrowz/fflate) (MIT). Pages are edited with
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), in `vendor/pdf-lib/`.

Privacy policy: `privacy.html`. Support: `support.html`. App Store listing and release checklist: `release/`.
