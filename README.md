# ScoreAtlas

Sheet music on the iPad that turns its own pages by listening to you play.

**Try it:** https://godisgood-code.github.io/ScoreAtlas/ (open it in Safari on an iPad)

## What works now (Test 12)

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
- **Practice report:** after following with sheet music, see the bars you practised most, where you hesitated, and
  your tempo bar by bar. **Loop** a passage and the app counts the repetitions and shows the tempo of each. **Listen back** to a session
  with the highlight and pages following along.
- **Library and setlists:** every PDF you open is kept; play a setlist and the pedal goes from piece to piece.
- **Apple Pencil:** write fingerings and markings on the music (pen, highlighter, fingering numbers, eraser, undo).
- **Display:** two pages side by side when the iPad is sideways, half-page turns, and a lock for performing.
- **Offline:** works without Wi-Fi once loaded; add it to the Home Screen for an app icon.
- A microphone check that shows which notes the app hears.

Everything stays on your iPad.

## What's next

Wrong-note detection, then getting ready for release (App Store packaging).

## Running it on a computer

Serve the folder with any static web server, for example `python3 -m http.server`, then open http://localhost:8000.
See `CLAUDE.md` for the tests.

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), included in `vendor/pdfjs/`.
