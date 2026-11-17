// The practice journal: a piece's practice across days, from the session summaries kept after each Follow session
// ({ date, seconds, plays, hesitations, tempo: [[measure, tempo]], loop, loopReps }).
// Minutes a day for the last two weeks, bars getting faster, bars still tricky, and the sessions.

const DAY = 86400000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const minutes = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);

// The parts of the journal, for the page to show
export function journal(sessions, now = Date.now()) {
  const today = startOfDay(now);
  const days = Array.from({ length: 14 }, (_, i) => ({ day: today - (13 - i) * DAY, seconds: 0 }));
  for (const s of sessions) {
    const d = days.find((x) => startOfDay(s.date) === x.day);
    if (d) d.seconds += s.seconds;
  }
  const week = sessions.filter((s) => s.date >= today - 6 * DAY);
  const weekDays = new Set(week.map((s) => startOfDay(s.date))).size;
  // tempo per bar: the first and the latest session it was measured in
  const first = new Map(), last = new Map();
  for (const s of [...sessions].sort((a, b) => a.date - b.date)) {
    for (const [m, t] of s.tempo || []) {
      if (!t) continue;
      if (!first.has(m)) first.set(m, { t, date: s.date });
      last.set(m, { t, date: s.date });
    }
  }
  const better = [...last].filter(([m, l]) => first.get(m).date < l.date)
    .map(([m, l]) => ({ measure: m, from: first.get(m).t, to: l.t, gain: l.t - first.get(m).t }))
    .filter((x) => x.gain > 3).sort((a, b) => b.gain - a.gain).slice(0, 4);
  // hesitations in the last five sessions
  const recent = [...sessions].sort((a, b) => b.date - a.date).slice(0, 5);
  const hes = new Map();
  for (const s of recent) for (const [m, c] of s.hesitations || []) hes.set(m, (hes.get(m) || 0) + c);
  const tricky = [...hes].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([measure, count]) => ({ measure, count }));
  return { days, weekSeconds: week.reduce((n, s) => n + s.seconds, 0), weekDays, total: sessions.length, better, tricky, recent };
}

export function renderJournal(el, sessions, barName) {
  el.textContent = "";
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  if (!sessions.length) {
    el.append(make("p", "note", "Nothing yet. Practice this piece with Follow (with its sheet music added) and tap Stop; each session is added here."));
    return;
  }
  const j = journal(sessions);
  el.append(make("p", "report-sum", `This week: ${j.weekSeconds ? minutes(j.weekSeconds) : "no practice yet"}${j.weekDays ? ` on ${j.weekDays} day${j.weekDays === 1 ? "" : "s"}` : ""} · ${j.total} session${j.total === 1 ? "" : "s"} in all`));
  el.append(make("h3", null, "Minutes a day, last two weeks"));
  el.append(dayChart(j.days, make));
  if (j.better.length) {
    el.append(make("h3", null, "Getting faster"));
    const ul = make("ul", "report-list");
    for (const b of j.better) ul.append(make("li", null, `Bar ${barName(b.measure)}: ♩ ${Math.round(b.from)} → ♩ ${Math.round(b.to)}`));
    el.append(ul);
  }
  if (j.tricky.length) {
    el.append(make("h3", null, "Still tricky (last five sessions)"));
    const ul = make("ul", "report-list");
    for (const t of j.tricky) ul.append(make("li", null, `Bar ${barName(t.measure)}: ${t.count} hesitation${t.count === 1 ? "" : "s"}`));
    el.append(ul);
  }
  el.append(make("h3", null, "Recent sessions"));
  const ul = make("ul", "report-list journal-sessions");
  for (const s of j.recent) {
    const bars = (s.plays || []).length, h = (s.hesitations || []).reduce((n, [, c]) => n + c, 0);
    const when = new Date(s.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    ul.append(make("li", null, `${when} · ${minutes(s.seconds)} · ${bars} bars${h ? ` · ${h} hesitation${h === 1 ? "" : "s"}` : ""}${s.loopReps && s.loopReps.length ? ` · loop ×${s.loopReps.length}` : ""}`));
  }
  el.append(ul);
}

// Bars for the minutes practiced each day; tap a bar for its day and minutes
function dayChart(days, make) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 340, H = 120, L = 28, R = 4, T = 8, B = 20;
  const wrap = make("div", "tempo-chart");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  const mins = days.map((d) => d.seconds / 60);
  const top = Math.max(10, Math.ceil(Math.max(...mins) / 10) * 10);
  svg.setAttribute("aria-label", `Minutes practiced each day for two weeks, up to ${Math.round(Math.max(...mins))} minutes`);
  const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
  const y = (v) => T + ((top - v) * (H - T - B)) / top;
  for (const v of [0, top / 2, top]) {
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
    add("text", { x: L - 5, y: y(v) + 4, class: "axis", "text-anchor": "end" }, String(Math.round(v)));
  }
  const slot = (W - L - R) / days.length, bw = Math.max(4, slot - 4);
  const tip = make("div", "chart-tip");
  tip.hidden = true;
  days.forEach((d, i) => {
    const x = L + i * slot + (slot - bw) / 2, v = mins[i];
    const label = new Date(d.day).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    if (v > 0) {
      const h = Math.max(2, y(0) - y(v)), r = Math.min(4, bw / 2, h);
      // rounded top, square at the baseline
      add("path", { d: `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + bw - r} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r} V${y(0)} Z`, class: "day-bar" });
    }
    if (i % 2 === 1 || i === days.length - 1) add("text", { x: x + bw / 2, y: H - 5, class: "axis", "text-anchor": "middle" }, String(new Date(d.day).getDate()));
    const hit = add("rect", { x: L + i * slot, y: T, width: slot, height: H - T - B, fill: "transparent" });
    const show = () => { tip.textContent = `${label}: ${Math.round(v)} min`; tip.hidden = false; tip.style.left = `${((x + bw / 2) / W) * 100}%`; };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerdown", show);
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  wrap.append(svg, tip);
  return wrap;
}
