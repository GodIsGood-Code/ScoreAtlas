#!/bin/bash
# Installs "ScoreAtlas Reader" on this Mac: a small app on the Desktop. Drop PDFs of sheet music onto it (or open it
# and pick them): it reads each one with Audiveris and puts the PDF and its sheet music (.mxl) side by side in the
# "ScoreAtlas" folder in iCloud Drive. On the iPad: ScoreAtlas → Library → Add music → that folder → select both.
#
# Needs Audiveris (the free sheet-music reader) installed in Applications. Run this once by double-clicking it
# (the first time, macOS may ask: right-click → Open → Open).
set -u

say() { printf '%s\n' "$*"; }
say ""
say "  ScoreAtlas Reader: installing"
say ""

# 1) Audiveris
AUD=""
for c in "/Applications/Audiveris.app/Contents/MacOS/Audiveris" "$HOME/Applications/Audiveris.app/Contents/MacOS/Audiveris"; do
  if [ -x "$c" ]; then AUD="$c"; break; fi
done
if [ -z "$AUD" ]; then
  FOUND=$(mdfind "kMDItemCFBundleIdentifier == '*audiveris*'c" 2>/dev/null | head -n 1)
  if [ -n "$FOUND" ] && [ -x "$FOUND/Contents/MacOS/Audiveris" ]; then AUD="$FOUND/Contents/MacOS/Audiveris"; fi
fi
if [ -z "$AUD" ]; then
  say "  Audiveris wasn't found in Applications."
  say "  Install it first (free): https://github.com/Audiveris/audiveris/releases"
  say "  then double-click this installer again."
  open "https://github.com/Audiveris/audiveris/releases" 2>/dev/null
  read -r -p "  Press Return to close. " _
  exit 1
fi
say "  Audiveris: $AUD"

# 2) where the music goes: iCloud Drive/ScoreAtlas (or Documents/ScoreAtlas without iCloud Drive)
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
if [ -d "$ICLOUD" ]; then OUT="$ICLOUD/ScoreAtlas"; else OUT="$HOME/Documents/ScoreAtlas"; fi
mkdir -p "$OUT"
say "  Music goes to: $OUT"

# 3) the reader script
SUP="$HOME/Library/Application Support/ScoreAtlas Reader"
mkdir -p "$SUP"
cat > "$SUP/read.sh" <<READER
#!/bin/bash
# Reads each PDF given with Audiveris; the PDF and its .mxl end up in the ScoreAtlas folder.
AUD="$AUD"
OUT="$OUT"
LOG="\$HOME/Library/Logs/ScoreAtlas Reader.log"
notify() { /usr/bin/osascript -e "display notification \"\$2\" with title \"ScoreAtlas Reader\" subtitle \"\$1\"" >/dev/null 2>&1; }
done_ok=0; failed=0
for pdf in "\$@"; do
  case "\$pdf" in *.pdf|*.PDF) ;; *) continue ;; esac
  name=\$(basename "\$pdf"); stem="\${name%.*}"
  notify "\$stem" "Reading the music… (a few minutes)"
  work=\$(mktemp -d "\${TMPDIR:-/tmp}/scoreatlas.XXXXXX")
  echo "=== \$(date) \$pdf" >> "\$LOG"
  "\$AUD" -batch -export -output "\$work" -- "\$pdf" >> "\$LOG" 2>&1
  found=0
  for mxl in "\$work"/*.mxl "\$work"/*/*.mxl; do
    [ -f "\$mxl" ] || continue
    cp "\$mxl" "\$OUT/" && found=1
  done
  if [ "\$found" = 1 ]; then
    [ "\$(cd "\$(dirname "\$pdf")" && pwd)" = "\$OUT" ] || cp "\$pdf" "\$OUT/\$name"
    done_ok=\$((done_ok + 1))
    notify "\$stem" "Ready in the ScoreAtlas folder"
  else
    failed=\$((failed + 1))
    notify "\$stem" "Audiveris couldn't read this one. Try a cleaner scan, or Teach it in ScoreAtlas."
  fi
  case "\$work" in "\${TMPDIR:-/tmp}"/scoreatlas.*) /bin/rm -r -- "\$work" ;; esac
done
if [ \$((done_ok + failed)) -gt 0 ]; then open "\$OUT"; fi
READER
chmod +x "$SUP/read.sh"

# 4) the app on the Desktop (an AppleScript "droplet": drop PDFs on it, or open it to pick them)
APP="$HOME/Desktop/ScoreAtlas Reader.app"
SCRIPT=$(mktemp "${TMPDIR:-/tmp}/scoreatlas-app.XXXXXX")
cat > "$SCRIPT" <<'APPLESCRIPT'
on run
	set picked to choose file with prompt "Choose PDFs of sheet music for ScoreAtlas:" of type {"com.adobe.pdf"} with multiple selections allowed
	readThem(picked)
end run
on open dropped
	readThem(dropped)
end open
on readThem(files)
	set args to ""
	repeat with f in files
		set args to args & " " & quoted form of POSIX path of f
	end repeat
	set reader to quoted form of ((POSIX path of (path to application support folder from user domain)) & "ScoreAtlas Reader/read.sh")
	do shell script reader & args & " > /dev/null 2>&1 &"
	display notification "Reading " & (count of files) & " PDF(s). You'll get a notice when each is ready." with title "ScoreAtlas Reader"
end readThem
APPLESCRIPT
[ -e "$APP" ] && mv "$APP" "${APP%.app} (old).app" 2>/dev/null
if /usr/bin/osacompile -o "$APP" "$SCRIPT"; then
  say "  Made: $APP"
else
  say "  Couldn't make the app (osacompile failed)."
fi
case "$SCRIPT" in "${TMPDIR:-/tmp}"/scoreatlas-app.*) /bin/rm -f -- "$SCRIPT" ;; esac

say ""
say "  Done. Drop PDFs onto \"ScoreAtlas Reader\" on your Desktop."
say "  Each is ready (PDF + .mxl) in the ScoreAtlas folder when a notice says so."
say "  On the iPad: ScoreAtlas → Library → Add music → iCloud Drive → ScoreAtlas → select both files."
say ""
read -r -p "  Press Return to close. " _
