# Builds a 4-page sample score (piano warm-ups) as MusicXML, then renders each page to SVG with Verovio.
# Usage: python3 tools/make_sample.py OUT_DIR, then node tools/make_sample_pdf.js OUT_DIR
import sys, json
from music21 import stream, note, chord, meter, key, clef, layout, scale, pitch, interval, metadata, duration

OUT = sys.argv[1]

def tonic_octave(t):  # keep two-octave runs readable on the staff
    return 4 if t[0] in "CDEF" and t not in ("F#",) else 3

def new_score(title):
    s = stream.Score()
    s.insert(0, metadata.Metadata(title=title))
    rh, lh = stream.Part(), stream.Part()
    rh.append(clef.TrebleClef()); lh.append(clef.BassClef())
    for p in (rh, lh):
        p.append(meter.TimeSignature("4/4"))
    s.insert(0, rh); s.insert(0, lh)
    s.insert(0, layout.StaffGroup([rh, lh], symbol="brace", barTogether=True))
    return s, rh, lh

def add(part, items):
    for it in items:
        part.append(it)

def scale_run(tonic, octv):
    sc = scale.MajorScale(tonic)
    lo = pitch.Pitch(f"{tonic}{octv}")
    hi = pitch.Pitch(f"{tonic}{octv+2}")
    up = sc.getPitches(lo, hi)              # 15 pitches
    down = list(reversed(up))[1:-1]         # 13 pitches
    ns = [note.Note(p, quarterLength=0.5) for p in up + down]
    ns.append(note.Note(lo, quarterLength=2))
    return ns                                # exactly 4 bars of 4/4

def arpeggio(tonic, octv):
    sc = scale.MajorScale(tonic)
    lo = pitch.Pitch(f"{tonic}{octv}")
    degs = [sc.pitchFromDegree(d) for d in (1, 3, 5)]
    ps = []
    for o in range(2):
        for d in degs:
            p = pitch.Pitch(d.name); p.octave = octv + o
            if p < lo: p.octave += 1
            if ps and p <= ps[-1]: p.octave += 1
            ps.append(p)
    top = pitch.Pitch(f"{tonic}{octv+2}")
    up = ps + [top]                          # 7 pitches
    down = list(reversed(ps))[:-1]           # 5 pitches
    ns = [note.Note(p, quarterLength=0.5) for p in up + down]
    ns.append(note.Note(lo, quarterLength=2))
    return ns                                # exactly 2 bars

def octave_down(ns):
    out = []
    for n in ns:
        m = note.Note(n.pitch.transpose("-P8"), quarterLength=n.quarterLength)
        out.append(m)
    return out

pages = []

# Pages 1-2: scales, hands together
for title, keys_ in (("Scales in sharp keys", ["C", "G", "D", "A"]), ("Scales in flat keys", ["F", "B-", "E-", "A-"])):
    s, rh, lh = new_score(title)
    for t in keys_:
        o = tonic_octave(t)
        ks = key.Key(t)
        rh.append(key.KeySignature(ks.sharps)); lh.append(key.KeySignature(ks.sharps))
        r = scale_run(t, o)
        add(rh, r); add(lh, octave_down(r))
    pages.append((title, "Two octaves, hands together", s))

# Page 3: broken chords
s, rh, lh = new_score("Broken chords")
for t in ["C", "G", "D", "A", "E", "F", "B-", "E-"]:
    o = tonic_octave(t)
    ks = key.Key(t)
    rh.append(key.KeySignature(ks.sharps)); lh.append(key.KeySignature(ks.sharps))
    a = arpeggio(t, o)
    add(rh, a); add(lh, octave_down(a))
pages.append(("Broken chords", "Root position, two octaves", s))

# Page 4: cadences I-IV-V-I, transposed around C
s, rh, lh = new_score("Cadences")
base_rh = [["C4", "E4", "G4"], ["C4", "F4", "A4"], ["B3", "D4", "G4"], ["C4", "E4", "G4"]]
base_lh = ["C3", "F2", "G2", "C3"]
for t, ivl in [("C", "P1"), ("G", "-P4"), ("D", "M2"), ("A", "-m3"), ("E", "M3"), ("F", "P4"), ("B-", "-M2"), ("E-", "m3")]:
    ks = key.Key(t)
    rh.append(key.KeySignature(ks.sharps)); lh.append(key.KeySignature(ks.sharps))
    iv = interval.Interval(ivl)
    for c, b in zip(base_rh, base_lh):
        rh.append(chord.Chord([pitch.Pitch(p).transpose(iv) for p in c], quarterLength=2))
        lh.append(note.Note(pitch.Pitch(b).transpose(iv), quarterLength=2))
pages.append(("Cadences", "I – IV – V – I in eight keys", s))

import verovio
tk = verovio.toolkit()
info = []
for i, (title, sub, sc) in enumerate(pages, 1):
    for p in sc.parts:
        p.makeMeasures(inPlace=True)
        p.makeAccidentals(inPlace=True, overrideStatus=True)
    xml_path = f"{OUT}/page{i}.musicxml"
    sc.write("musicxml", fp=xml_path)
    tk.setOptions({"pageWidth": 2159, "pageHeight": 2400, "pageMarginTop": 40, "pageMarginBottom": 40,
                   "pageMarginLeft": 60, "pageMarginRight": 60, "scale": 60, "adjustPageHeight": True,
                   "header": "none", "footer": "none", "breaks": "auto", "spacingSystem": 14,
                   "svgViewBox": True})
    tk.loadFile(xml_path)
    n = tk.getPageCount()
    svg = tk.renderToSVG(1)
    open(f"{OUT}/page{i}.svg", "w").write(svg)
    info.append({"title": title, "sub": sub, "pages": n})
print(json.dumps(info, indent=1))
