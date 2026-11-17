# ScoreAtlas Reader (for the Mac)

Turns PDFs of sheet music into the MusicXML files ScoreAtlas follows, with no Terminal and no exporting by hand.
Drop PDFs onto **ScoreAtlas Reader** on your Desktop; a few minutes later each PDF and its `.mxl` file are side by
side in the **ScoreAtlas** folder in iCloud Drive, ready for the iPad.

## Setting it up (once)

1. Install **Audiveris** (free) from https://github.com/Audiveris/audiveris/releases: the `.dmg` for macOS, dragged
   into Applications. Open it once so macOS knows it.
2. Download https://godisgood-code.github.io/ScoreAtlas/mac/ScoreAtlas-Reader.zip and double-click it to unzip.
3. Double-click **Install ScoreAtlas Reader.command**. The first time, macOS may say it can't check the developer:
   right-click the file, choose **Open**, then **Open** again.
4. A window shows what it did and ends with "Done". There's now **ScoreAtlas Reader** on your Desktop.

## Every day

1. Drag one or more PDFs onto **ScoreAtlas Reader** (or double-click it and choose them).
2. Wait for the notice "Ready in the ScoreAtlas folder" (Audiveris takes a minute or a few per piece).
3. On the iPad: ScoreAtlas → tap the piece's name (Library) → **Add music** → **Browse** → **iCloud Drive** →
   **ScoreAtlas** → tap **Select**, pick the PDF and its `.mxl`, then **Open**. ScoreAtlas pairs them by name.

If Audiveris can't read a scan, try a cleaner scan, or use **Teach** in ScoreAtlas instead. What Audiveris printed is
in `~/Library/Logs/ScoreAtlas Reader.log`.

To remove it: drag **ScoreAtlas Reader** from the Desktop to the Trash, and the folder
`~/Library/Application Support/ScoreAtlas Reader`.
