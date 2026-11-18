# Getting ScoreAtlas onto the App Store

Everything written so far for the release, and what's left. The app will launch free.

## Ready

- `app-store.md`: name, subtitle, description, promotional text, keywords, category, age rating, what's new, the
  microphone permission text, the App Privacy answers ("Data Not Collected"), notes for Apple's reviewer and a
  list of the screenshots. All within Apple's length limits. Final for 1.0.
- Screenshots: `screenshots/` (8, iPad 13-inch size), made by `tools/make_screenshots.cjs` from the sample music.
- Privacy policy: `privacy.html`, live at https://godisgood-code.github.io/ScoreAtlas/privacy.html
- Support page: `support.html`, live at https://godisgood-code.github.io/ScoreAtlas/support.html
- In the app: a first-launch tour, Settings (page-turn timing, highlight, tap to turn, appearance, open-source
  licenses) and Help; no test labels or version tag in the top bar; Check my notes marked Beta.
- Accessibility: `tests/a11y.cjs` (axe-core, WCAG 2.1 A and AA) passes on every main screen, light and dark.
- Speed: `tests/speed.cjs` with the CPU slowed 4x and 6x (a stand-in for older iPads): listening keeps up, page turns
  under 0.15 s, first launch with the sample ready in about 8–13 s.
- App icons: `icons/`, including `icon-1024.png` for the App Store (no transparency), drawn by `tools/make_icons.py`,
  which also fills the iPad app's icon and launch screen.

## Still to do

1. **Apple Developer account** (the owner is arranging it): $99 a year at developer.apple.com, in the name that
   should appear as the seller.
2. **Try the packaged app on the iPad** (`native/README.md`: GitHub Desktop, open `native/ios/App/App.xcodeproj`,
   pick the team, Run). Check: the microphone permission prompt, the Bluetooth pedal, Apple Pencil, pinch to zoom,
   opening PDFs and MusicXML from Files and AirDrop, Check my notes (speed on the iPad's graphics chip), Hear the
   music, Edit pages, and that the library survives restarts.
3. **Set the version to 1.0** just before uploading: in `native/ios/App/App/Info.plist`, CFBundleShortVersionString
   `1.0` and a higher CFBundleVersion; Settings → About in `index.html` says 1.0 too. (Claude does this.)
4. **Fill in App Store Connect**: create the app (bundle ID `io.github.godisgoodcode.scoreatlas`, or a new one set in
   Xcode first), paste the texts from `app-store.md`, upload the 8 screenshots from `screenshots/`, answer the privacy
   ("Data Not Collected") and age (4+) questions, set the price to Free, upload the build from Xcode (Product →
   Archive → Distribute App), and submit for review (usually a day or two).
5. **Optional: TestFlight** first, to let a friend or teacher try the build before the public release.
6. **The Mac helper** (`mac/`, served at `/mac/ScoreAtlas-Reader.zip`) stays on the website; Apple's review doesn't
   involve it. It is unsigned, so the support page explains the right-click → Open step.

## Done since the groundwork

- Backup and restore (Settings → Backup), and sharing a setlist with its music (versions 0.4.2 and 0.5.1).
- Wrong-note detection (0.5), trouble spots, hands separately, hear the music, page tools, stamps and text notes
  (0.5.1); pinch to zoom and kept takes (0.5.2).
- 1.0 polish (0.5.4.2): What's new and the version tag removed, Beta label, licenses in Settings, accessibility
  fixes, the sample's sheet music fixed (its bar boxes were wrong), speed check, final texts and screenshots.
