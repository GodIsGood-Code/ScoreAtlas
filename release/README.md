# Getting ScoreAtlas onto the App Store

Everything written so far for the release, and what's left. The app will launch free.

## Ready

- `app-store.md`: name, subtitle, description, promotional text, keywords, category, age rating, what's new, the
  microphone permission text, the App Privacy answers ("Data Not Collected"), notes for Apple's reviewer and a
  screenshot plan. All within Apple's length limits.
- Privacy policy: `privacy.html`, live at https://godisgood-code.github.io/ScoreAtlas/privacy.html
- Support page: `support.html`, live at https://godisgood-code.github.io/ScoreAtlas/support.html
- In the app: a first-launch tour, Settings (page-turn timing, highlight, tap to turn, appearance) and Help.
- App icons: `icons/` (512 px). The App Store needs a 1024 × 1024 version without transparency; make it from the
  same design when packaging.

## Still to do

1. **Apple Developer account** (the owner is arranging it): $99 a year at developer.apple.com, in the name that
   should appear as the seller.
2. **Package the web app as an iPad app** with Capacitor (Claude can set this up). On the owner's Mac:
   install Xcode from the Mac App Store, then the packaging project, open it in Xcode, sign in with the developer
   account, and run it on the iPad. Things to check in the packaged app: the microphone permission prompt, the
   Bluetooth pedal, Apple Pencil, opening PDFs and MusicXML from Files, and that the library survives restarts.
3. **Final wording**: remove "Test" labels and the "What's new in Test …" section; the tour and Help stay.
4. **Screenshots** (see `app-store.md`), taken on the iPad or the Xcode simulator.
5. **Fill in App Store Connect**: create the app, paste the texts, upload screenshots, answer the privacy and age
   questions, upload the build from Xcode, and submit for review (usually a day or two).
6. Optional before 1.0: backups of the library and markings to Files or iCloud (so nothing is lost when changing
   iPads).
