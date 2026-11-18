# ScoreAtlas: App Store listing for 1.0 (final, ready to paste)

Everything App Store Connect asks for, written and checked against Apple's length limits (checked again for 1.0:
subtitle 29/30, promotional text 165/170, description under 4,000, keywords 94/100). The screenshots are in
`release/screenshots/` (see the end). Change anything you like.

## Basics

| Field | Text | Limit |
|---|---|---|
| App name | ScoreAtlas | 30 |
| Subtitle | Sheet music that turns itself | 30 (29 used) |
| Primary category | Music | |
| Secondary category | Education | |
| Price | Free | |
| Age rating | 4+ (answer "None" to every content question) | |
| Copyright | © 2026 Ethan Chen | |
| Contact email (for Apple and the support page) | heart.of.Eitanium@gmail.com | |
| Support URL | https://godisgood-code.github.io/ScoreAtlas/support.html | |
| Marketing URL (optional) | https://godisgood-code.github.io/ScoreAtlas/ | |
| Privacy Policy URL | https://godisgood-code.github.io/ScoreAtlas/privacy.html | |

## Promotional text (170 characters; can be changed any time without a new review)

Play, and ScoreAtlas turns the page. It listens to your piano, follows along in your sheet music, and shows you how your practice went. Free, private, works offline.

## Description (4,000 characters)

ScoreAtlas shows your sheet music on iPad and turns the pages for you by listening to you play.

Put your iPad on the music stand, open a piece and tap Follow. As you play, ScoreAtlas follows along in the music, highlights the bar you're playing and turns the page just before you need it, a little ahead, the way your eyes read ahead of your hands. No foot pedal or tapping needed (though your Bluetooth page-turn pedal works too).

FOLLOWS YOUR PLAYING, NOT A METRONOME
• Speed up, slow down, pause, take a breath: ScoreAtlas keeps up.
• Practice the way you really practice: start anywhere, repeat a passage, go back a few bars, skip ahead. It finds you again in about a second.
• Repeats, first and second endings, D.C., D.S., coda and Fine are followed in the order you play them.
• Playing something that isn't in the piece, like warming up, doesn't move the page.

TWO WAYS TO LEARN A PIECE
• Add the piece's sheet music as a MusicXML file (from MuseScore, or read from your own scan with the free Audiveris app), and ScoreAtlas follows it straight away, even pieces with a choir or orchestra part, listening only for the parts you play.
• Or teach it: play the piece once (or just a section) while turning pages yourself, and ScoreAtlas remembers where to turn.

PRACTICE TOOLS
• Practice history: after a session, see which bars you practiced most, where you hesitated, and your tempo bar by bar.
• Loop a passage: tap the first and last bar, and ScoreAtlas counts each repetition and shows its tempo.
• Trouble spots: the bars you stumble on, looped one at a time with the metronome, a little faster each clean time.
• Hands separately: practice the left or right hand alone, and ScoreAtlas follows just that hand.
• Hear the music: the sheet music played from any page, at any speed, with the bar highlighted.
• Listen back: hear your session again with the highlight and pages following along, and keep the good takes.
• Check my notes (beta): ScoreAtlas listens to your session for missed and wrong notes and marks those bars on the music. The practice journal shows your progress over the days.
• A metronome with any time signature, subdivisions, tap tempo and a tempo ladder.

EVERYTHING A MUSIC STAND NEEDS
• Library: every PDF you open is kept, with a picture of its first page. Scans and phone photos of music work.
• Setlists: line up pieces for a service, lesson or concert; at the end of a piece, the next one opens.
• Apple Pencil: pens in any color and size, highlighters, text notes, fingerings and over 40 stamps for dynamics, accents, ornaments, fermatas, breath and pedal marks. Drag any marking to a new place, and pinch to zoom in to write small. Markings stay with the piece.
• Edit pages: take out blank pages, reorder, turn sideways scans, or add pages from another PDF.
• Share a setlist with its music, or a marked-up PDF with your teacher.
• Two pages side by side when your iPad is sideways, and half-page turns: the next page's top half appears while you finish this one.
• Pinch to zoom into the music, dark pages for dim stages, and margins trimmed so the notes are bigger.
• Lock for performing: only the pedal turns pages, so a stray touch can't.
• Works offline at the venue, with no account and no Wi-Fi needed.

PRIVATE BY DESIGN
Your music, recordings and markings never leave your iPad. ScoreAtlas uses the microphone only to follow your playing, on the device, while Follow or Teach is on. No account, no ads, no tracking.

Made by a pianist, for pianists.

## Keywords (100 characters; commas, no spaces needed)

sheet music,page turner,piano,score,pdf,practice,follow,metronome,music stand,setlist,annotate

(94 characters.)

## What's New (version 1.0)

First release. Play, and ScoreAtlas turns the page. Start with the Warm-ups sample in your library: tap Follow and play.

## Microphone permission text (goes in the app's Info.plist as NSMicrophoneUsageDescription)

ScoreAtlas listens to your playing so it can follow along in the music and turn the pages for you. The sound stays on your iPad.

## App Privacy questionnaire ("nutrition label")

- Do you or your third-party partners collect data from this app? **No.** Result shown on the store: **Data Not Collected.**
- Why that's accurate: the app has no account, no analytics, no ads and no server. Sheet music, lessons, markings,
  practice history and recordings are stored only on the iPad (in the app's own storage). Microphone sound is analyzed
  on the device and only kept in memory for "Listen back" and "Check my notes" until the next session (the note
  recognition model is part of the app and runs on the iPad), unless the pianist taps Keep this take, which saves it
  on the iPad only. Nothing is sent anywhere unless the pianist shares a file themselves.

## Notes for Apple's reviewer (App Review Information)

ScoreAtlas follows a pianist's playing through the microphone and turns the pages of the sheet music.
The sample piece "Warm-ups" opens on first launch with its sheet music already added: tap Follow and play its scales
on a piano (or play a recording of them near the iPad): the bar being played is highlighted and the pages turn by
themselves. Without a piano: tap Piece, then Teach, play or hum along for a few seconds while tapping the right side
of the page to turn, then tap Done. Tap Follow and play or hum the same thing again: the page turns by itself. Everything runs on the device; no account or sign-in is needed.

## Screenshots (made, in `release/screenshots/`)

iPad 13-inch size (2064 × 2752 portrait, 2752 × 2064 landscape), which App Store Connect also uses for the smaller
iPads. Only the app's own sample music is shown. Upload them in this order; the captions are suggestions if you later
want text over them.

1. `1-following.png`: following, the bar being played highlighted ("Play. It turns the page.")
2. `2-practice-history.png`: practice history with the tempo graph and bars tinted by practice ("See how your practice went")
3. `3-markings.png`: Pencil markings: fingering, dynamics, a pedal mark, a circle, a text note ("Mark it like paper")
4. `4-two-pages-landscape.png`: two pages side by side, iPad sideways ("Your whole music stand")
5. `5-practice-menu.png`: the Practice menu ("Practice tools built in")
6. `6-trouble-spots.png`: trouble spots from recent sessions ("Practice what needs it")
7. `7-loop-metronome.png`: a trouble spot looped with the metronome and tempo ladder ("A little faster each clean time")
8. `8-dark.png`: dark appearance with dark pages ("Easy on the eyes")

Made by `tools/make_screenshots.cjs`; run it again after UI changes.
