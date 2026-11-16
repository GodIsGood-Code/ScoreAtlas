# Page Turner

Sheet music on the iPad that turns its own pages by listening to you play.

**Try it:** https://godisgood-code.github.io/page-turner/ (open it in Safari on an iPad)

## What works now (Test 5)

- Open a PDF (scans work) and read it one page at a time. The app reopens your last PDF next time.
- Turn pages with a Bluetooth page-turn pedal, by tapping (right side forward, left side back), or by swiping.
- **Teach:** play a piece, or any section of it, turning pages yourself. The app remembers how it sounds and where
  you turned. Teach more sections whenever you like; they add up, and re-teaching a section replaces it.
- **Follow:** play it again and the app turns the pages for you. Start anywhere: it finds where you are and keeps
  up when you stop, repeat a few bars, go back or skip ahead.
- A microphone check that shows which notes the app hears.

Everything stays on your iPad.

## What's next

1. **Reading the music:** follow the notes in the score itself, so new pieces work without teaching.

## Running it on a computer

Serve the folder with any static web server, for example `python3 -m http.server`, then open http://localhost:8000.
See `CLAUDE.md` for the tests.

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), included in `vendor/pdfjs/`.
