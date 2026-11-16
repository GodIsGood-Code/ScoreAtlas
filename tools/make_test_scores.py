#!/usr/bin/env python3
"""Makes sheet music with known answers for testing page turning from a score (no teaching).

Usage: python3 tools/make_test_scores.py OUT_DIR
Needs music21, verovio, pretty_midi, fluidsynth (see synth_performances.py), and Node with Playwright (for PDFs).

Writes:
  aba_repeat.musicxml/.pdf  the A A B A test piece written as ||: A :|| B A on 3 pages (A, B, A)
  aba_dc.musicxml/.pdf      the same written as ||: A (Fine) :|| B (D.C. al Fine) on 2 pages
  warmups.musicxml          the sample score (samples/warm-ups.pdf) as one file with its 4 pages
  warmups_play.wav/.json    a performance of the sample score, with the times its pages start
The A A B A performances themselves come from synth_performances.py (faster, slower, ...).
"""
import json
import os
import subprocess
import sys

import numpy as np
import pretty_midi
import verovio
from music21 import bar, clef, converter, key, layout, meter, note, repeat, stream

sys.path.insert(0, os.path.dirname(__file__))
import synth_performances as sp  # noqa: E402

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))


def written_piece(form):
    """music21 score of the test piece. form "repeat": pages A (repeated), B, A. form "dc": A (repeated, Fine), B (D.C.)."""
    events, _, total = sp.build_score(False)
    sections = {"A": 0, "B": 64, "A2": 96}  # first beat of each written section in the A A B A performance
    plan = ["A", "B", "A2"] if form == "repeat" else ["A", "B"]
    rh, lh = stream.PartStaff(), stream.PartStaff()
    for p, c in ((rh, clef.TrebleClef()), (lh, clef.BassClef())):
        p.append(c)
    n = 0
    for s_i, name in enumerate(plan):
        base = sections[name]
        for b in range(8):
            mr, ml = stream.Measure(number=n + 1), stream.Measure(number=n + 1)
            if n == 0:
                for m in (mr, ml):
                    m.append(key.KeySignature(0))
                    m.append(meter.TimeSignature("4/4"))
            if b == 0 and n > 0:
                for m in (mr, ml):
                    m.insert(0, layout.PageLayout(isNew=True))
            elif b == 4:
                for m in (mr, ml):
                    m.insert(0, layout.SystemLayout(isNew=True))
            lo, hi = base + 4 * b, base + 4 * b + 4
            for (sb, db, pitch, role) in sorted(events):
                if not (lo <= sb < hi) or db == 4:  # leave out the final held chord
                    continue
                target = mr if role == "mel" else ml
                nt = note.Note(pitch, quarterLength=min(db, hi - sb))
                target.insert(sb - lo, nt)
            if name == "A" and b == 0:
                for m in (mr, ml):
                    m.leftBarline = bar.Repeat(direction="start")
            if name == "A" and b == 7:
                for m in (mr, ml):
                    m.rightBarline = bar.Repeat(direction="end")
                if form == "dc":
                    mr.insert(3, repeat.Fine())
            if name == "B" and b == 7 and form == "dc":
                mr.insert(3, repeat.DaCapoAlFine())
            rh.append(mr)
            ml.makeRests(fillGaps=True, inPlace=True)
            mr.makeRests(fillGaps=True, inPlace=True)
            lh.append(ml)
            n += 1
    sc = stream.Score()
    sc.insert(0, rh)
    sc.insert(0, lh)
    sc.insert(0, layout.StaffGroup([rh, lh], symbol="brace", barTogether=True))
    return sc


def render_pdf(xml_path, pdf_path):
    tk = verovio.toolkit()
    tk.setOptions({"breaks": "encoded", "pageWidth": 2159, "pageHeight": 2794, "scale": 45, "adjustPageHeight": False,
                   "header": "none", "footer": "none"})
    tk.loadFile(xml_path)
    svgdir = pdf_path + ".svg"
    os.makedirs(svgdir, exist_ok=True)
    for p in range(1, tk.getPageCount() + 1):
        with open(os.path.join(svgdir, f"page{p}.svg"), "w") as f:
            f.write(tk.renderToSVG(p))
    subprocess.run(["node", os.path.join(HERE, "svg_pages_to_pdf.cjs"), svgdir, pdf_path], check=True,
                   env={**os.environ, "NODE_PATH": subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()})
    return tk.getPageCount()


for form in ("repeat", "dc"):
    sc = written_piece(form)
    xml = os.path.join(OUT, f"aba_{form}.musicxml")
    sc.write("musicxml", fp=xml)
    pages = render_pdf(xml, os.path.join(OUT, f"aba_{form}.pdf"))
    print(f"made aba_{form}: {pages} pages")

# The sample score: its four pages as one score, and a performance of it
pages_dir = os.path.join(OUT, "warmups_pages")
os.makedirs(pages_dir, exist_ok=True)
subprocess.run([sys.executable, os.path.join(HERE, "make_sample.py"), pages_dir], check=True, stdout=subprocess.DEVNULL)
whole = stream.Score()
parts = [stream.PartStaff(), stream.PartStaff()]
offset_q = 0.0
page_starts = []
pm = pretty_midi.PrettyMIDI()
inst = pretty_midi.Instrument(program=0)
bpm = 100
rng = np.random.default_rng(5)
t_page = sp.LEAD_IN
for p in range(1, 5):
    sc = converter.parse(os.path.join(pages_dir, f"page{p}.musicxml"))
    page_starts.append(round(t_page, 3))
    length_q = sc.parts[0].highestTime
    for pi, part in enumerate(sc.parts):
        for n in part.flatten().notes:
            for pitch in (n.pitches if n.isChord else [n.pitch]):
                start = t_page + float(n.offset) * 60 / bpm + rng.normal(0, 0.01)
                end = t_page + float(n.offset + n.quarterLength) * 60 / bpm
                vel = int(np.clip((80 if pi == 0 else 62) + rng.normal(0, 6), 1, 127))
                inst.notes.append(pretty_midi.Note(velocity=vel, pitch=pitch.midi, start=max(0, start), end=end + 0.02))
    # pedal changed every bar
    for b in range(int(length_q // 4)):
        t0 = t_page + (4 * b + 0.05) * 60 / bpm
        t1 = t_page + (4 * b + 3.95) * 60 / bpm
        inst.control_changes += [pretty_midi.ControlChange(64, 127, t0), pretty_midi.ControlChange(64, 0, t1)]
    t_page += length_q * 60 / bpm
render_dir = OUT
sp.render(inst, render_dir, "warmups_play", t_page + sp.TAIL, -46, 0.2, 0.0, 5)
with open(os.path.join(OUT, "warmups_play.json"), "w") as f:
    json.dump({"pageStarts": page_starts, "end": round(t_page, 3), "tempo": bpm}, f)
print("made warmups_play:", page_starts)
