# Page Turner

Sheet music on the iPad that turns its own pages by listening to you play.

**Try it:** https://godisgood-code.github.io/page-turner/ (open it in Safari on an iPad)

## What works now (Test 3)

- Open a PDF (scans work) and read it one page at a time. The app reopens your last PDF next time.
- Turn pages with a Bluetooth page-turn pedal, by tapping (right side forward, left side back), or by swiping.
- **Teach:** play a piece once from the beginning, turning pages yourself. The app remembers how it sounds and
  where you turned.
- **Follow:** play it again and the app turns the pages for you.
- A microphone check that shows which notes the app hears.

Everything stays on your iPad.

## What's next

1. **Practice:** cope with starting mid-piece, stopping, repeating bars and jumping back.
2. **Reading the music:** follow the notes in the score itself, so new pieces work without teaching.

## Running it on a computer

Serve the folder with any static web server, for example `python3 -m http.server`, then open http://localhost:8000.
See `CLAUDE.md` for the tests.

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), included in `vendor/pdfjs/`.
