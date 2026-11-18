"""The sample piece's sheet music: samples/warm-ups.musicxml, the four pages made by make_sample.py (one MusicXML each)
joined into one file, each page starting with <print new-page="yes"/> so its measures land on the right PDF page, and
each line of music (system) with <print new-system="yes"/>, taken from Verovio's engraving (pageN.svg), so the bar
highlight finds the right lines.
   python3 tools/make_sample.py tests/output/scores/warmups_pages   (or make_test_scores.py, which runs it)
   python3 tools/make_sample_xml.py tests/output/scores/warmups_pages
Bar numbers start again on each page, as printed."""
import os, re, sys
import xml.etree.ElementTree as ET

src = sys.argv[1] if len(sys.argv) > 1 else "tests/output/scores/warmups_pages"
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root_dir, "samples", "warm-ups.musicxml")

first = ET.parse(os.path.join(src, "page1.musicxml"))
score = first.getroot()
for tag in ("work", "movement-title"):
    for e in score.findall(tag): score.remove(e)
title = ET.Element("movement-title"); title.text = "Warm-ups"
score.insert(0, title)
parts = score.findall("part")
for sp, name in zip(score.find("part-list").findall("score-part"), ("Piano (right hand)", "Piano (left hand)")):
    pn = sp.find("part-name")
    if pn is None: pn = ET.SubElement(sp, "part-name")
    pn.text = name
def system_starts(p):
    """indexes of the measures that begin a new line on page p (after the first)"""
    svg = open(os.path.join(src, f"page{p}.svg")).read()
    counts = [len(re.findall(r'class="measure"', x)) for x in re.split(r'class="system"', svg)[1:]]
    starts, n = [], 0
    for c in counts[:-1]:
        n += c
        starts.append(n)
    return starts

def mark_systems(measures, p):
    for i in system_starts(p):
        measures[i].insert(0, ET.Element("print", {"new-system": "yes"}))

mark_systems(parts[0].findall("measure"), 1)
for p in range(2, 5):
    page = ET.parse(os.path.join(src, f"page{p}.musicxml")).getroot()
    for k, part in enumerate(page.findall("part")):
        measures = part.findall("measure")
        if k == 0:
            pr = ET.Element("print", {"new-page": "yes"})
            measures[0].insert(0, pr)
            mark_systems(measures, p)
        for m in measures: parts[k].append(m)
ET.indent(first, "  ")
with open(out, "wb") as f:
    f.write(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n')
    first.write(f, encoding="utf-8", xml_declaration=False)
print(out, os.path.getsize(out), "bytes")
