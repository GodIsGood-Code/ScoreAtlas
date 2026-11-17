# ScoreAtlas for the App Store (the iPad app)

This folder turns the ScoreAtlas web app into a real iPad app with [Capacitor](https://capacitorjs.com) 8. The app is
the same web app (copied into `ios/App/App/public/`) in a full-screen web view, plus a little native code
(`ios/App/App/SceneDelegate.swift`) for what only an app can do: open files sent to ScoreAtlas from Files, AirDrop or
Mail, and keep the screen on. The microphone works as on the website; iOS asks for permission the first time, with the
text in `Info.plist` (`NSMicrophoneUsageDescription`).

Everything is already built and kept in git, so a Mac needs only **Xcode**: no Node.js, no Terminal.

## Running it on your iPad (the owner's steps)

**Once:**

1. Get the project onto the Mac. The easiest way is **GitHub Desktop** (free, desktop.github.com): sign in, then
   **File → Clone repository → GodIsGood-code/ScoreAtlas** (the folder may be called `page-turner` or `ScoreAtlas`).
   Later, to get updates, open GitHub Desktop and click **Fetch origin**, then **Pull origin**.
2. On the iPad: **Settings → Privacy & Security → Developer Mode → On** (the iPad restarts; confirm when asked). This
   option appears after the iPad has been connected to Xcode once (step 5), so come back to it if you don't see it.
3. In Xcode: **Xcode → Settings → Accounts → +** → Apple ID, and sign in (your developer account once you have it; a
   plain Apple ID works too, but then the app stops opening after 7 days until you run it from Xcode again).

**Each time:**

4. In Finder, open the project folder, then `native` → `ios` → `App` and double-click **App.xcodeproj**. The first
   time, Xcode downloads Capacitor (a minute; you'll see "Fetching" at the top).
5. Connect the iPad with its cable. Trust the computer on the iPad if it asks.
6. In Xcode, click **App** in the left list (blue icon) → **Signing & Capabilities** → **Team**: pick your name. If it
   says the bundle identifier is taken, change `io.github.godisgoodcode.scoreatlas` to something of your own, such as
   `com.yourname.scoreatlas`.
7. At the top of the Xcode window, choose your iPad as the device (next to "App"), then press the **▶ Run** button.
   ScoreAtlas appears on the iPad. The first time, the iPad may say the developer isn't trusted: **Settings → General
   → VPN & Device Management → your Apple ID → Trust**.

The App Store app keeps its own library, separate from the website's. To bring your pieces over: on the website,
**Settings → Save a backup**, then in the app **Library → Add music** and pick the backup file (or AirDrop it to the
iPad and choose ScoreAtlas).

## Sending it to the App Store (needs the developer account)

1. In Xcode: device menu → **Any iOS Device (arm64)**, then **Product → Archive**.
2. When it finishes, the Organizer opens: **Distribute App → App Store Connect → Upload**.
3. On appstoreconnect.apple.com: make the app (name ScoreAtlas, bundle ID as in step 6), paste the texts from
   `release/app-store.md`, add screenshots, and pick the uploaded build. TestFlight (in App Store Connect) lets you and
   a few friends try it before you submit it for review.

## For Claude: updating the app

The web app is the source; this folder only wraps it. After changing the web app:

```
cd native && npm install && npm run build
```

`npm run build` copies the files the website keeps offline (`../sw.js`'s list, plus licenses) into `www/`
(`copy-web.mjs`) and runs `npx cap sync ios`, which puts them in `ios/App/App/public/`. Commit `ios/App/App/public/`
with the change. `node tests/native-sim.cjs` (from the repository root) runs the copied app with stand-ins for
Capacitor. App icon and launch screen: `python3 tools/make_icons.py`. Version: `MARKETING_VERSION` (1.0) and
`CURRENT_PROJECT_VERSION` (raise it for each upload) in `ios/App/App.xcodeproj/project.pbxproj`, or in Xcode under
General.

What's set up: iPad only, all orientations, iOS 15 or later; `Info.plist` has the microphone text, opens PDF,
MusicXML (.mxl, .musicxml) and `.scoreatlas` files (copied in, not edited in place), and declares no non-exempt
encryption (no export compliance question). The fonts are built into the web app (`vendor/fonts/`), so the app makes
no network requests at all.
