# Getting ScoreAtlas onto the App Store

Everything written so far for the release, and what's left. The app will launch free.

## Ready

- `app-store.md`: name, subtitle, description, promotional text, keywords, category, age rating, what's new, the
  microphone permission text, the App Privacy answers ("Data Not Collected"), notes for Apple's reviewer and a
  screenshot plan. All within Apple's length limits.
- Privacy policy: `privacy.html`, live at https://godisgood-code.github.io/ScoreAtlas/privacy.html
- Support page: `support.html`, live at https://godisgood-code.github.io/ScoreAtlas/support.html
- In the app: a first-launch tour, Settings (page-turn timing, highlight, tap to turn, appearance) and Help.
- App icons: `icons/`, including `icon-1024.png` for the App Store (no transparency), drawn by `tools/make_icons.py`,
  which also fills the iPad app's icon and launch screen.

## Still to do

1. **Apple Developer account** (the owner is arranging it): $99 a year at developer.apple.com, in the name that
   should appear as the seller.
2. **Package the web app as an iPad app**: done (Test 17), in `native/` (Capacitor 8; see `native/README.md` for the
   owner's steps: GitHub Desktop, open `native/ios/App/App.xcodeproj`, pick the team, Run). Still to check on the iPad
   in the packaged app: the microphone permission prompt, the Bluetooth pedal, Apple Pencil, pinch to zoom, opening
   PDFs and MusicXML from Files and AirDrop, Check my notes (speed), and that the library survives restarts.
3. **Final wording**: remove "Test" labels and the "What's new in Test …" section; the tour and Help stay.
4. **Screenshots** (see `app-store.md`), taken on the iPad or the Xcode simulator.
5. **Fill in App Store Connect**: create the app, paste the texts, upload screenshots, answer the privacy and age
   questions, upload the build from Xcode, and submit for review (usually a day or two).
6. **Licenses** to list in the app's About or Settings (all allow commercial use): PDF.js and pdf-lib (Apache-2.0 /
   MIT), TensorFlow.js and Basic Pitch (Apache-2.0), fflate (MIT). Their license files are in `vendor/`.
7. **The Mac helper** (`mac/`, served at `/mac/ScoreAtlas-Reader.zip`) stays on the website; Apple's review doesn't
   involve it. It is unsigned, so the support page explains the right-click → Open step. Signing it would need the
   developer account's "Developer ID" (optional).
8. **A last test pass** on the owner's iPad with the final build: Follow, Check my notes (speed of the note model on
   the iPad's graphics chip), Hear the music, Edit pages, Add music from iCloud Drive, a shared setlist opened on a
   second device if available.

## Done since the groundwork

- Backup and restore (Settings → Backup), and sharing a setlist with its music (Test 14, Test 16).
- Wrong-note detection (Test 15), trouble spots, hands separately, hear the music, page tools, stamps and text notes
  (Test 16).
