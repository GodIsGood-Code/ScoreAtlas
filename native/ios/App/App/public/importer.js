// Adding several files at once from Library → Add: PDFs, their sheet music (MusicXML: .mxl, .musicxml, .xml) and
// shared setlists or backups (.scoreatlas). Sheet music is matched to a PDF by name ("Clair de lune.pdf" with
// "Clair de lune.mxl", also "Clair de lune.mvt1.mxl" as Audiveris names a movement), to a piece already in the
// library with that name, or else to the piece that is open.

export const kindOf = (name) => {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(mxl|musicxml|xml)$/.test(n)) return "score";
  if (/\.(scoreatlas|zip)$/.test(n)) return "bundle";
  return "other";
};

// "Clair de Lune (1).mvt1.mxl" -> "clair de lune"
export function baseName(name) {
  return name.toLowerCase()
    .replace(/\.(pdf|mxl|musicxml|xml|scoreatlas|zip)$/, "")
    .replace(/\.mvt\d+$/, "")
    .replace(/[-_ ]?\(\d+\)$/, "")
    .replace(/[-_ ]omr$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// files: [{ name }]; libraryNames: names of pieces already kept (without .pdf).
// Returns { pieces: [{ pdf, score }], toLibrary: [{ score, name }] (sheet music for a kept piece),
// loose: [score] (sheet music matching nothing), bundles: [file], other: [file] }
export function pairFiles(files, libraryNames = []) {
  const pdfs = files.filter((f) => kindOf(f.name) === "pdf");
  const scores = files.filter((f) => kindOf(f.name) === "score");
  const pieces = pdfs.map((pdf) => ({ pdf, score: null }));
  const byName = new Map(pieces.map((p) => [baseName(p.pdf.name), p]));
  const kept = new Map(libraryNames.map((n) => [baseName(n), n]));
  const toLibrary = [], loose = [];
  for (const score of scores) {
    const b = baseName(score.name);
    const p = byName.get(b);
    if (p && !p.score) { p.score = score; continue; }
    if (kept.has(b)) { toLibrary.push({ score, name: kept.get(b) }); continue; }
    loose.push(score);
  }
  // one PDF and one sheet music file with different names: they surely go together
  if (pieces.length === 1 && !pieces[0].score && loose.length === 1 && !toLibrary.length) pieces[0].score = loose.shift();
  return {
    pieces, toLibrary, loose,
    bundles: files.filter((f) => kindOf(f.name) === "bundle"),
    other: files.filter((f) => kindOf(f.name) === "other"),
  };
}
