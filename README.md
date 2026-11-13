# Page Turner

Sheet music on the iPad that turns its own pages by listening to you play.

**Try it:** https://godisgood-code.github.io/page-turner/ (open it in Safari on an iPad)

## What works now (Test 2)

- Open a PDF (scans work) and read it one page at a time.
- Turn pages with a Bluetooth page-turn pedal, by tapping (right side forward, left side back), or by swiping.
- Listening check: tap **Listen** and the app shows which notes it hears.

## What's next

1. **Teach it once:** play a piece once while turning pages yourself. After that, the app turns them for you.
2. **Practice:** cope with stopping, repeating bars and jumping back.
3. **Reading the music:** follow the notes in the score itself, so new pieces work without teaching.

## Running it on a computer

Serve the folder with any static web server, for example `python3 -m http.server`, then open http://localhost:8000.

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), included in `vendor/pdfjs/`.
