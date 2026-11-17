// Finds where the measures are on a page of sheet music, from the page image, for the measure highlight.
// The sheet-music file says how many systems each page has and how many measures each system has; the image
// says where they are: staves are groups of five long horizontal lines, barlines are vertical lines that cross
// every staff of a system (note stems only cross part of one staff).
//
// findMeasures(gray, width, height, systemsMeasureCounts) -> [{ x0, y0, x1, y1 }] per measure on the page,
// as fractions of the page size, in reading order; or null if the page doesn't look as expected.

const DARK = 200; // a pixel counts as ink below this brightness (thin lines are often gray once scanned)

// Long horizontal lines: peaks of ink per row (a thin line falling between two pixel rows leaves each of them
// half gray; noteheads or beams touching a line make it wider, not taller). Returns [{ y, ink }].
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
    if (rows[y] < rows[y - 1] || rows[y] < rows[y + 1]) continue;
    const a = rows[y - 1], b = rows[y], c = rows[y + 1];
    if (b + Math.max(a, c) < limit) continue; // a thin line may be shared between two rows of pixels
    const center = y + (c - a) / (2 * Math.max(1e-6, 2 * b - a - c)) * 0.5;
    const line = { y: center, ink: b + Math.max(a, c) };
    if (lines.length && center - lines[lines.length - 1].y < 2) {
      if (line.ink > lines[lines.length - 1].ink) lines[lines.length - 1] = line; // keep the stronger of two close peaks
      continue;
    }
    lines.push(line);
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
        const found = [];
        for (let k = 0; k <= 4; k++) {
          const j = k === at ? i : near(top + k * sp, 0.22 * sp);
          if (j < 0) { missing++; continue; }
          ink += lines[j].ink;
          found[k] = ys[j];
        }
        if (missing > 1) continue;
        // the spacing was tried in whole pixels: where the outer lines were found, use where they really are
        const t = found[0] !== undefined ? found[0] : top, b = found[4] !== undefined ? found[4] : top + 4 * sp;
        candidates.push({ top: t, bottom: b, space: (b - t) / 4, score: ink * (missing ? 0.7 : 1) });
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
    .filter((k) => k.space >= 0.75 * kept[0].space && k.space <= 1.33 * kept[0].space) // staves on a page are of a size
    .map((k) => ({ top: k.top, bottom: k.bottom, space: k.space, score: k.score, strong: k.score >= 0.35 * strong,
      lines: [0, 1, 2, 3, 4].map((q) => k.top + q * k.space) }));
}

// Where a staff's lines start and end
function extent(gray, w, staff) {
  const lefts = [], rights = [];
  for (const yl of staff.lines) {
    // a band of three rows, since on a crooked scan a staff line wanders up or down a pixel across the page
    const o = Math.round(yl) * w, up = Math.max(0, o - w), down = Math.min(gray.length - w, o + w);
    let x0 = -1, x1 = -1, run = 0;
    for (let x = 0; x < w; x++) {
      if (gray[o + x] < DARK || gray[up + x] < DARK || gray[down + x] < DARK) { run++; if (run === 20 && x0 < 0) x0 = x - 19; if (run >= 20) x1 = x; }
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
  // Where a staff line really is around column x: a scanned page bends a little, so a line can sit a couple of
  // pixels above or below its average height
  const lineAt = (y, x) => {
    let best = -1, by = Math.round(y);
    for (let dy = -3; dy <= 3; dy++) {
      const r = Math.round(y) + dy;
      if (r < 0 || r >= gray.length / w) continue;
      let ink = 0;
      for (let xx = Math.max(0, x - 12); xx <= Math.min(w - 1, x + 12); xx++) ink += 255 - gray[r * w + xx];
      if (ink > best) { best = ink; by = r; }
    }
    return by;
  };
  const cover = (x, s) => {
    if (x < 0 || x + 1 >= w) return 0;
    // a scanned barline is often two pixels wide with a gray edge: ink in this column or the next one counts
    const dark = (y) => gray[y * w + x] < DARK || gray[y * w + x + 1] < DARK;
    let d = 0, n = 0;
    const m0 = Math.round(s.top + s.space), m1 = Math.round(s.bottom - s.space);
    for (let y = m0; y <= m1; y++) { n++; if (dark(y)) d++; }
    if (d / n < 0.92) return d / n; // the middle of the staff isn't solid: no need to look closer
    d = 0; n = 0;
    for (let y = lineAt(s.top, x); y <= lineAt(s.bottom, x); y++) { n++; if (dark(y)) d++; }
    return n ? d / n : 0;
  };
  // A scan is often a little crooked, so a barline may drift sideways by a pixel or two from one staff to the next
  const drift = 2;
  for (let x = Math.max(0, sys.left - 2); x <= Math.min(w - 1, sys.right + 2); x++) {
    let minCover = cover(x, st[0]);
    if (minCover < 0.92) continue;
    const xs = [x];
    for (let k = 1; k < st.length && minCover >= 0.92; k++) {
      const from = xs[k - 1];
      let best = -1, bx = from;
      for (let d = -drift; d <= drift; d++) {
        const c = cover(from + d, st[k]);
        if (c > best || (c === best && Math.abs(d) < Math.abs(bx - from))) { best = c; bx = from + d; }
      }
      xs.push(bx);
      minCover = Math.min(minCover, best);
    }
    if (minCover < 0.92) continue;
    let gap = 1;
    if (st.length > 1) {
      let dark = 0, n = 0;
      for (let k = 0; k + 1 < st.length; k++) {
        const y0 = Math.round(st[k].bottom) + 1, y1 = Math.round(st[k + 1].top);
        for (let y = y0; y < y1; y++) {
          n++;
          const gx = Math.round(xs[k] + ((xs[k + 1] - xs[k]) * (y - y0)) / Math.max(1, y1 - y0));
          if (gray[y * w + gx] < DARK || gray[y * w + Math.min(w - 1, gx + 1)] < DARK) dark++;
        }
      }
      gap = n ? dark / n : 1;
    }
    cols.push({ x, score: minCover + gap });
  }
  // join neighboring columns, and double bars or repeat signs (lines close together), into one barline
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
  picked.cost = b;
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

// When only the number of measures on the page is known (pages given by bar numbers, from the pianist's edition):
// find the systems from the staves' spacing, then keep the strongest barlines until the count is right.
export function findMeasuresByCount(gray, w, h, total) {
  // real staves are several line-spaces apart: drop a weaker "staff" squeezed against a stronger one
  const found = staves(staffLines(gray, w, h));
  const all = [];
  for (const st of found) {
    if (all.some((k) => st.top < k.bottom + 3 * k.space && st.bottom > k.top - 3 * k.space)) continue;
    const e = extent(gray, w, st);
    if (!(e.right - e.left >= 0.12 * w)) continue; // five short even lines (a big title, say) aren't a staff
    all.push(st);
  }
  all.sort((a, b) => a.top - b.top);
  if (!all.length || total <= 0) return null;
  // staves per system: staves of a system are clearly closer together than staves of different systems
  const gaps = all.slice(1).map((st, i) => st.top - all[i].bottom);
  let per = 1;
  for (const p of [2, 3, 4]) {
    if (all.length % p || all.length / p < 2) continue;
    const within = gaps.filter((_, i) => (i + 1) % p !== 0), between = gaps.filter((_, i) => (i + 1) % p === 0);
    if (Math.max(...within) < 0.8 * Math.min(...between)) { per = p; break; }
  }
  if (all.length === 2 && gaps[0] < 8 * all[0].space) per = 2; // a single piano system on the page
  const systems = [];
  for (let i = 0; i < all.length; i += per) {
    const st = all.slice(i, i + per);
    const ext = st.map((x) => extent(gray, w, x));
    systems.push({ staves: st, left: Math.min(...ext.map((e) => e.left)), right: Math.max(...ext.map((e) => e.right)) });
  }
  if (total < systems.length) return null;
  // How many measures in each system? Measures are of similar width, so a system's share of the page's measures
  // roughly follows its width; within that, pick the split whose barlines are clearest and most evenly spaced
  const widths = systems.map((x) => x.right - x.left);
  const sum = widths.reduce((x, y) => x + y, 0);
  const inner = systems.map((sys) => {
    const sp = sys.staves[0].space;
    return barlines(gray, w, sys).filter((b) => b.x0 > sys.left + 4 * sp && b.x1 < sys.right - 4 * sp);
  });
  const costOf = systems.map((sys, k) => {
    const raw = (widths[k] / sum) * total;
    return (c) => {
      const chosen = chooseBarlines(inner[k], c - 1, sys.left, sys.right);
      const fit = chosen ? (chosen.cost || 0) : 2 * (c - 1); // missing barlines cost more than weak ones
      return fit + 0.6 * Math.abs(c - raw);
    };
  });
  // dynamic programming over systems: best[k][n] = lowest cost giving n measures to the first k systems
  let best = new Map([[0, { cost: 0, counts: [] }]]);
  systems.forEach((sys, k) => {
    const next = new Map();
    const left = systems.length - k - 1;
    for (const [n, v] of best) {
      for (let c = 1; n + c + left <= total; c++) {
        const cost = v.cost + costOf[k](c);
        const m = n + c;
        if (!next.has(m) || next.get(m).cost > cost) next.set(m, { cost, counts: [...v.counts, c] });
      }
    }
    best = next;
  });
  if (!best.has(total)) return null;
  const counts = best.get(total).counts;
  const boxes = [];
  systems.forEach((sys, k) => {
    const chosen = chooseBarlines(inner[k], counts[k] - 1, sys.left, sys.right);
    let xs;
    if (chosen) xs = chosen.map((c) => (c.x0 + c.x1) / 2);
    else xs = Array.from({ length: counts[k] - 1 }, (_, i) => sys.left + ((sys.right - sys.left) * (i + 1)) / counts[k]);
    const edges = [sys.left, ...xs, sys.right];
    const st = sys.staves, pad = 1.5 * st[0].space;
    const y0 = Math.max(0, st[0].top - pad), y1 = Math.min(h, st[st.length - 1].bottom + pad);
    for (let i = 0; i + 1 < edges.length; i++) boxes.push({ x0: edges[i] / w, y0: y0 / h, x1: edges[i + 1] / w, y1: y1 / h, exact: !!chosen });
  });
  return boxes;
}
