// Finds where the measures are on a page of sheet music, from the page image, for the measure highlight.
// The sheet-music file says how many systems each page has and how many measures each system has; the image
// says where they are: staves are groups of five long horizontal lines, barlines are vertical lines that cross
// every staff of a system (note stems only cross part of one staff).
//
// findMeasures(gray, width, height, systemsMeasureCounts) -> [{ x0, y0, x1, y1 }] per measure on the page,
// as fractions of the page size, in reading order; or null if the page doesn't look as expected.

const DARK = 200; // a pixel counts as ink below this brightness (thin lines are often grey once scanned)

// Long horizontal lines: peaks of ink per row (a thin line falling between two pixel rows leaves each of them
// half grey; noteheads or beams touching a line make it wider, not taller). Returns [{ y, ink }].
function staffLines(gray, w, h) {
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let ink = 0;
    const o = y * w;
    for (let x = 0; x < w; x++) ink += 255 - gray[o + x];
    rows[y] = ink / 255;
  }
  const lines = [];
  const limit = 0.12 * w; // short last systems have short staff lines
  for (let y = 1; y < h - 1; y++) {
    if (rows[y] < limit || rows[y] < rows[y - 1] || rows[y] < rows[y + 1]) continue;
    const a = rows[y - 1], b = rows[y], c = rows[y + 1];
    const centre = y + (c - a) / (2 * Math.max(1e-6, 2 * b - a - c)) * 0.5;
    if (lines.length && centre - lines[lines.length - 1].y < 2) continue;
    lines.push({ y: centre, ink: b + Math.max(a, c) });
  }
  return lines;
}

// Staves: five lines at an even spacing. Every plausible spacing is tried; each candidate staff is scored by the
// ink of its lines (real staff lines run the whole width of the system, ledger lines and beams don't), and the
// strongest candidates that don't overlap are kept. One line may be hidden (by a thick chord, say).
function staves(lines) {
  const ys = lines.map((l) => l.y);
  const spacings = new Set();
  for (let i = 0; i + 1 < ys.length; i++) for (let j = i + 1; j < Math.min(ys.length, i + 3); j++) {
    const d = Math.round(ys[j] - ys[i]);
    if (d >= 4 && d <= 40) spacings.add(d);
  }
  const near = (y, tol) => {
    let best = -1, bd = tol;
    for (let n = 0; n < ys.length; n++) { const d = Math.abs(ys[n] - y); if (d <= bd) { bd = d; best = n; } }
    return best;
  };
  const candidates = [];
  for (const sp of spacings) {
    for (let i = 0; i < ys.length; i++) {
      // line i may be any of the five (the hidden one might be the top line)
      for (let at = 0; at < 2; at++) {
        const top = ys[i] - at * sp;
        let missing = 0, ink = 0;
        for (let k = 0; k <= 4; k++) {
          const j = k === at ? i : near(top + k * sp, 0.22 * sp);
          if (j < 0) { missing++; continue; }
          ink += lines[j].ink;
        }
        if (missing > 1) continue;
        candidates.push({ top, bottom: top + 4 * sp, space: sp, score: ink * (missing ? 0.7 : 1) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of candidates) {
    if (kept.some((k) => c.top <= k.bottom + k.space && c.bottom >= k.top - k.space)) continue;
    kept.push(c);
  }
  if (!kept.length) return [];
  const strong = kept[0].score;
  return kept
    .filter((k) => k.score >= 0.15 * strong) // short systems have short (weak) lines; text can't make five even lines
    .map((k) => ({ top: k.top, bottom: k.bottom, space: k.space, score: k.score, strong: k.score >= 0.35 * strong,
      lines: [0, 1, 2, 3, 4].map((q) => k.top + q * k.space) }));
}

// Where a staff's lines start and end
function extent(gray, w, staff) {
  const lefts = [], rights = [];
  for (const yl of staff.lines) {
    const o = Math.round(yl) * w;
    let x0 = -1, x1 = -1, run = 0;
    for (let x = 0; x < w; x++) {
      if (gray[o + x] < DARK) { run++; if (run === 20 && x0 < 0) x0 = x - 19; if (run >= 20) x1 = x; }
      else run = 0;
    }
    if (x0 >= 0) { lefts.push(x0); rights.push(x1); }
  }
  const mid = (a) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];
  return { left: mid(lefts), right: mid(rights) };
}

// Barline candidates: columns where every staff of the system is solidly dark from its top line to its bottom
// line. In piano music the barline also continues through the gap between the staves, which chord stems and
// time signatures don't, so that earns extra credit.
function barlines(gray, w, sys) {
  const cols = [];
  const st = sys.staves;
  for (let x = Math.max(0, sys.left - 2); x <= Math.min(w - 1, sys.right + 2); x++) {
    let minCover = 1;
    for (const s of st) {
      let dark = 0, n = 0;
      for (let y = Math.round(s.top); y <= Math.round(s.bottom); y++) { n++; if (gray[y * w + x] < DARK) dark++; }
      minCover = Math.min(minCover, dark / n);
      if (minCover < 0.92) break;
    }
    if (minCover < 0.92) continue;
    let gap = 1;
    if (st.length > 1) {
      let dark = 0, n = 0;
      for (let k = 0; k + 1 < st.length; k++) {
        for (let y = Math.round(st[k].bottom) + 1; y < Math.round(st[k + 1].top); y++) { n++; if (gray[y * w + x] < DARK) dark++; }
      }
      gap = n ? dark / n : 1;
    }
    cols.push({ x, score: minCover + gap });
  }
  // join neighbouring columns, and double bars or repeat signs (lines close together), into one barline
  const space = st[0].space;
  const out = [];
  for (const c of cols) {
    const last = out[out.length - 1];
    if (last && c.x - last.x1 <= 1.6 * space) { last.x1 = c.x; last.score = Math.max(last.score, c.score); }
    else out.push({ x0: c.x, x1: c.x, score: c.score });
  }
  return out;
}

// Choose `want` barlines from the candidates: strong ones, spaced like measures (the first measure of a system is
// usually a little wider because of the clef and key signature)
function chooseBarlines(cands, want, left, right) {
  if (want <= 0) return [];
  if (cands.length < want) return null;
  const W = right - left;
  const weights = Array.from({ length: want + 1 }, (_, i) => (i === 0 ? 1.3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const expect = [];
  let acc = 0;
  for (let i = 0; i < want; i++) { acc += weights[i]; expect.push(left + (W * acc) / total); }
  const xs = cands.map((c) => (c.x0 + c.x1) / 2);
  const pen = (k, i) => (4 * Math.abs(xs[i] - expect[k])) / W - cands[i].score; // spacing error versus strength
  // best[k][i]: lowest total choosing barline k at candidate i
  const best = [], from = [];
  for (let k = 0; k < want; k++) {
    best.push(new Float64Array(cands.length).fill(Infinity));
    from.push(new Int32Array(cands.length).fill(-1));
    for (let i = k; i < cands.length; i++) {
      if (k === 0) { best[k][i] = pen(k, i); continue; }
      for (let j = k - 1; j < i; j++) {
        const v = best[k - 1][j] + pen(k, i);
        if (v < best[k][i]) { best[k][i] = v; from[k][i] = j; }
      }
    }
  }
  let i = -1, b = Infinity;
  for (let q = want - 1; q < cands.length; q++) if (best[want - 1][q] < b) { b = best[want - 1][q]; i = q; }
  const picked = [];
  for (let k = want - 1; k >= 0; k--) { picked.unshift(cands[i]); i = from[k][i]; }
  return picked;
}

export function findMeasures(gray, w, h, counts) {
  const all = staves(staffLines(gray, w, h)); // strongest first
  const systemsWanted = counts.length;
  if (!systemsWanted) return null;
  // How many staves per system? Try 4, 3, 2, 1: keep that many of the strongest staves, and accept the grouping
  // if staves of one system are closer together than staves of different systems
  let found = null;
  for (let per = 4; per >= 1 && !found; per--) {
    if (all.length < per * systemsWanted) continue;
    const pick = all.slice(0, per * systemsWanted).sort((a, b) => a.top - b.top);
    let within = 0, between = Infinity;
    for (let i = 0; i + 1 < pick.length; i++) {
      const gap = pick[i + 1].top - pick[i].bottom;
      if ((i + 1) % per === 0) between = Math.min(between, gap);
      else within = Math.max(within, gap);
    }
    if (per === 1 || within < between) found = pick;
  }
  if (!found) return null;
  const per = found.length / systemsWanted;
  findMeasures.lastStaves = found.length;
  const boxes = [];
  for (let s = 0; s < systemsWanted; s++) {
    const st = found.slice(s * per, s * per + per);
    const ext = st.map((x) => extent(gray, w, x));
    const sys = { staves: st, left: Math.min(...ext.map((e) => e.left)), right: Math.max(...ext.map((e) => e.right)) };
    const bars = barlines(gray, w, sys);
    // measure boundaries: barlines inside the system (the one at the very start only marks the system's edge)
    const inner = bars.filter((b) => b.x0 > sys.left + 2 * st[0].space && b.x1 < sys.right - 2 * st[0].space);
    const n = counts[s];
    const chosen = chooseBarlines(inner, n - 1, sys.left, sys.right);
    let edges;
    if (chosen) {
      edges = [sys.left, ...chosen.map((b) => (b.x0 + b.x1) / 2), sys.right];
    } else {
      // too few barlines found: share the width out, the first measure a little wider (clef and key)
      const weights = Array.from({ length: n }, (_, i) => (i === 0 ? 1.3 : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      edges = [sys.left];
      let acc = 0;
      for (const wgt of weights) {
        acc += wgt;
        let x = sys.left + ((sys.right - sys.left) * acc) / total;
        const near = inner.find((b) => Math.abs((b.x0 + b.x1) / 2 - x) < 0.05 * (sys.right - sys.left));
        if (near && acc < total) x = (near.x0 + near.x1) / 2;
        edges.push(x);
      }
    }
    const pad = 1.5 * st[0].space;
    const y0 = Math.max(0, st[0].top - pad), y1 = Math.min(h, st[st.length - 1].bottom + pad);
    for (let i = 0; i < n; i++) boxes.push({ x0: edges[i] / w, y0: y0 / h, x1: edges[i + 1] / w, y1: y1 / h, exact: !!chosen });
  }
  return boxes;
}

// Measures per system on each page, from the score: { page: [count for system 1, system 2, ...] }
export function systemCounts(score) {
  const pages = {};
  for (const m of score.measures) {
    const p = (pages[m.page] ||= []);
    p[m.system - 1] = (p[m.system - 1] || 0) + 1;
  }
  return pages;
}
