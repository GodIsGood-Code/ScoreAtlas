// Trouble spots: the passages worth practicing slowly, from the practice history kept after each session
// ({ date, plays, hesitations: [[measure, count]], tempo: [[measure, tempo]], notes: { byMeasure: [[measure, wrong, total]] } }).
// Each bar gets points for hesitating there (recent sessions count more), wrong or missed notes found by "Check my
// notes", and being much slower than the bars around it. The best-scoring bars, with a bar either side, become
// passages of up to four bars, worst first.

export const TROUBLE_SETTINGS = {
  sessions: 8, // the latest sessions looked at
  fade: 0.8, // each older session counts this much less
  maxBars: 4,
  spots: 5,
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// count: how many measures the piece has; returns [{ from, to, score, reasons: { hesitations, wrong, slow }, tempo }]
// (measure indices; tempo: the typical tempo the pianist plays those bars at, quarter notes a minute, if known)
export function troubleSpots(sessions, count, cfg = TROUBLE_SETTINGS) {
  const recent = [...sessions].sort((a, b) => b.date - a.date).slice(0, cfg.sessions);
  const score = new Float64Array(count), hes = new Float64Array(count), wrong = new Float64Array(count), slow = new Float64Array(count);
  const tempos = Array.from({ length: count }, () => []);
  recent.forEach((s, age) => {
    const w = cfg.fade ** age;
    for (const [m, c] of s.hesitations || []) if (m >= 0 && m < count) { hes[m] += c; score[m] += 2 * c * w; }
    for (const [m, bad, total] of (s.notes && s.notes.byMeasure) || []) {
      if (m < 0 || m >= count || !bad) continue;
      wrong[m] += bad;
      score[m] += 3 * w * Math.min(1, bad / Math.max(1, total)) + 0.5 * w * bad;
    }
    const run = (s.tempo || []).filter(([, t]) => t);
    run.forEach(([m, t], i) => {
      if (m < 0 || m >= count) return;
      tempos[m].push(t);
      const around = run.slice(Math.max(0, i - 3), i + 4).filter((_, k) => k !== Math.min(3, i)).map(([, x]) => x);
      const typical = median(around);
      if (typical && t < 0.75 * typical) { slow[m]++; score[m] += 1.5 * w; }
    });
  });
  // passages around the worst bars
  const spots = [];
  const used = new Uint8Array(count);
  const order = [...score.keys()].filter((m) => score[m] > 0.5).sort((a, b) => score[b] - score[a]);
  for (const m of order) {
    if (spots.length >= cfg.spots) break;
    if (used[m]) continue;
    let from = Math.max(0, m - 1), to = Math.min(count - 1, m + 1);
    // take in a troubled neighbor just past the edge, up to the longest passage
    while (to - from + 1 < cfg.maxBars && to + 1 < count && score[to + 1] > 0.5 && !used[to + 1]) to++;
    while (to - from + 1 < cfg.maxBars && from > 0 && score[from - 1] > 0.5 && !used[from - 1]) from--;
    let overlap = false;
    for (let k = from; k <= to; k++) if (used[k] && score[k] > 0.5) overlap = true;
    if (overlap) continue;
    for (let k = from; k <= to; k++) used[k] = 1;
    const sum = (arr) => arr.slice(from, to + 1).reduce((a, b) => a + b, 0);
    const t = median(tempos.slice(from, to + 1).flat());
    spots.push({ from, to, score: sum(score), reasons: { hesitations: sum(hes), wrong: sum(wrong), slow: sum(slow) }, tempo: t ? Math.round(t) : null });
  }
  return spots.sort((a, b) => b.score - a.score);
}

// "hesitated 3 times · 4 wrong notes · slower than the bars around"
export function troubleText(spot) {
  const r = spot.reasons, out = [];
  if (r.hesitations) out.push(`hesitated ${r.hesitations} time${r.hesitations === 1 ? "" : "s"}`);
  if (r.wrong) out.push(`${r.wrong} wrong or missed note${r.wrong === 1 ? "" : "s"}`);
  if (r.slow) out.push("slower than the bars around");
  return out.join(" · ");
}
