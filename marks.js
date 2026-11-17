// Markings on the music with Apple Pencil or a finger, while "Mark" is on (so nothing is marked by accident): a pen in
// any color and size, a highlighter, text notes, stamps (dynamics, accents, fermata, breath marks, pedal marks),
// fingering numbers, an eraser that removes whole markings, and undo. Markings are kept as points relative to the
// page (0..1 across and down), so they stay in place at any size, in two-page view and in half-page view.
// While the Pencil is writing, touches from the hand resting on the screen are ignored (they don't turn the page).

export const INKS = { black: "#1a1d21", red: "#c62828", blue: "#1f5fc4" };
export const HIGHLIGHTS = { yellow: "#ffd200", green: "#7ed957", pink: "#ff7eb6", blue: "#6ec6ff" };
const HIGHLIGHT = "rgba(255, 210, 0, 0.36)";
// "#ffd200" -> "rgba(255, 210, 0, 0.36)"
export const washOf = (hex, a = 0.36) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : HIGHLIGHT;
};

// Stamps: what each one is called (for buttons and reading aloud)
export const STAMPS = [
  ["ppp", "pianississimo"], ["pp", "pianissimo"], ["p", "piano"], ["mp", "mezzo piano"], ["mf", "mezzo forte"], ["f", "forte"],
  ["ff", "fortissimo"], ["fff", "fortississimo"], ["fp", "fortepiano"], ["sf", "sforzando (sf)"], ["sfz", "sforzando"],
  ["rf", "rinforzando"], ["cresc", "crescendo hairpin"], ["dim", "diminuendo hairpin"], ["cresc.", "cresc. (words)"],
  ["dim.", "dim. (words)"], ["rit.", "ritardando"], ["accel.", "accelerando"], ["a tempo", "a tempo"],
  ["accent", "accent"], ["marcato", "marcato"], ["staccato", "staccato"], ["tenuto", "tenuto"], ["fermata", "fermata"],
  ["tr", "trill"], ["mordent", "mordent"], ["turn", "turn"], ["arpeggio", "arpeggio"], ["8va", "octave higher (8va)"],
  ["8vb", "octave lower (8vb)"], ["breath", "breath mark"], ["caesura", "caesura"], ["ped", "pedal down"],
  ["release", "pedal up"], ["una corda", "una corda"], ["tre corde", "tre corde"], ["segno", "segno"], ["coda", "coda"],
  ["circle", "circle"], ["check", "check mark"], ["eyes", "watch (glasses)"],
];

// Draws a stamp centered at (x, y); u: its size in pixels (about a staff space and a half)
export function drawStamp(ctx, k, x, y, u, color) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, u * 0.09);
  const line = (pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * u, y + b * u) : ctx.moveTo(x + a * u, y + b * u))); ctx.stroke(); };
  const dyn = (text) => {
    ctx.font = `italic 700 ${Math.round(u * 1.25)}px "Times New Roman", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  };
  // performance directions in words (rit., a tempo, una corda...): italic, not bold
  const words = (text) => {
    ctx.font = `italic 400 ${Math.round(u * 1.05)}px "Times New Roman", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  };
  switch (k) {
    case "ppp": case "pp": case "p": case "mp": case "mf": case "f": case "ff": case "fff": case "fp": case "sf": case "sfz": case "rf": dyn(k); break;
    case "cresc.": case "dim.": case "rit.": case "accel.": case "a tempo": case "una corda": case "tre corde": words(k); break;
    case "tr": ctx.font = `italic 700 ${Math.round(u * 1.2)}px "Times New Roman", Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("tr", x, y); break;
    case "8va": case "8vb":
      ctx.font = `italic 700 ${Math.round(u * 0.95)}px "Times New Roman", Georgia, serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(k, x - u * 1.4, y);
      ctx.setLineDash([u * 0.25, u * 0.2]); line([[0.6, k === "8va" ? -0.35 : 0.35], [1.8, k === "8va" ? -0.35 : 0.35], [1.8, k === "8va" ? 0.1 : -0.1]]); ctx.setLineDash([]); break;
    case "marcato": line([[-0.4, 0.35], [0, -0.4], [0.4, 0.35]]); break;
    case "mordent": ctx.lineWidth = Math.max(1, u * 0.11); line([[-0.8, 0.15], [-0.45, -0.3], [-0.2, 0.15], [0.15, -0.3], [0.45, 0.15], [0.8, -0.3]]); line([[-0.05, -0.55], [0.05, 0.4]]); break;
    case "turn":
      ctx.lineWidth = Math.max(1, u * 0.12);
      ctx.beginPath(); ctx.ellipse(x - u * 0.38, y, u * 0.38, u * 0.3, 0, 0.2 * Math.PI, 1.9 * Math.PI, true); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + u * 0.38, y, u * 0.38, u * 0.3, 0, 1.2 * Math.PI, 0.9 * Math.PI, true); ctx.stroke(); break;
    case "arpeggio": {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const t = i / 24, yy = y - u * 1.2 + t * u * 2.4, xx = x + Math.sin(t * Math.PI * 6) * u * 0.18; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke(); break;
    }
    case "segno":
      ctx.lineWidth = Math.max(1, u * 0.12);
      ctx.beginPath(); ctx.moveTo(x + u * 0.35, y - u * 0.45); ctx.bezierCurveTo(x - u * 0.6, y - u * 0.75, x - u * 0.6, y - u * 0.05, x, y); ctx.bezierCurveTo(x + u * 0.6, y + u * 0.05, x + u * 0.6, y + u * 0.75, x - u * 0.35, y + u * 0.45); ctx.stroke();
      line([[-0.55, 0.6], [0.55, -0.6]]);
      ctx.beginPath(); ctx.arc(x - u * 0.45, y - u * 0.05, u * 0.09, 0, 2 * Math.PI); ctx.arc(x + u * 0.45, y + u * 0.05, u * 0.09, 0, 2 * Math.PI); ctx.fill(); break;
    case "coda":
      ctx.lineWidth = Math.max(1, u * 0.12);
      ctx.beginPath(); ctx.ellipse(x, y, u * 0.42, u * 0.55, 0, 0, 2 * Math.PI); ctx.stroke();
      line([[-0.75, 0], [0.75, 0]]); line([[0, -0.8], [0, 0.8]]); break;
    case "cresc": line([[1.6, -0.45], [-1.6, 0], [1.6, 0.45]]); break;
    case "dim": line([[-1.6, -0.45], [1.6, 0], [-1.6, 0.45]]); break;
    case "accent": line([[-0.55, -0.3], [0.55, 0], [-0.55, 0.3]]); break;
    case "staccato": ctx.beginPath(); ctx.arc(x, y, u * 0.14, 0, 2 * Math.PI); ctx.fill(); break;
    case "tenuto": ctx.lineWidth = Math.max(1, u * 0.13); line([[-0.5, 0], [0.5, 0]]); break;
    case "fermata":
      ctx.beginPath(); ctx.arc(x, y + u * 0.35, u * 0.8, Math.PI, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y + u * 0.15, u * 0.13, 0, 2 * Math.PI); ctx.fill(); break;
    case "breath":
      ctx.beginPath(); ctx.arc(x, y - u * 0.25, u * 0.18, 0, 2 * Math.PI); ctx.fill();
      line([[0.12, -0.2], [0.05, 0.3], [-0.2, 0.55]]); break;
    case "caesura": ctx.lineWidth = Math.max(1, u * 0.13); line([[-0.35, 0.5], [0, -0.5]]); line([[0.05, 0.5], [0.4, -0.5]]); break;
    case "ped":
      ctx.font = `italic 700 ${Math.round(u * 1.05)}px "Times New Roman", Georgia, serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Ped.", x, y); break;
    case "release":
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; line([[-0.45 * Math.cos(a), -0.45 * Math.sin(a)], [0.45 * Math.cos(a), 0.45 * Math.sin(a)]]); }
      ctx.beginPath(); ctx.arc(x, y, u * 0.16, 0, 2 * Math.PI); ctx.stroke(); break;
    case "circle": ctx.beginPath(); ctx.ellipse(x, y, u * 1.3, u * 0.9, 0, 0, 2 * Math.PI); ctx.stroke(); break;
    case "check": line([[-0.5, 0], [-0.15, 0.4], [0.55, -0.45]]); break;
    case "eyes":
      ctx.beginPath(); ctx.arc(x - u * 0.4, y, u * 0.3, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + u * 0.4, y, u * 0.3, 0, 2 * Math.PI); ctx.stroke();
      line([[-0.1, -0.05], [0.1, -0.05]]); break;
    default: dyn(k);
  }
  ctx.restore();
}

export class Marks {
  // save(data): called (a moment after) each change; enabled(): whether drawing is allowed now (not locked, say)
  constructor({ save, enabled = () => true } = {}) {
    this.pages = {};
    this.layers = new Map(); // page -> its canvas on screen
    this.tool = { kind: "pen", color: INKS.black }; // kind: pen, highlight, text, stamp, finger (digit), erase, move
    this.hlColor = HIGHLIGHTS.yellow;
    this.digit = "1";
    this.stamp = "mf";
    this.size = 1; // stroke size, 0.3 to 3 (1 is the usual pen)
    this.onText = null; // (page, x, y, clientX, clientY): the page asks for the words of a text note there
    this.markMode = false; // fingers draw too
    this.undoStack = [];
    this.save = save;
    this.enabled = enabled;
    this.active = null;
    this.lastPen = -1e9;
    this.saveTimer = 0;
  }

  load(data) {
    this.pages = (data && data.pages) || {};
    this.undoStack = [];
    for (const page of this.layers.keys()) this.draw(page);
  }

  data() { return { v: 1, pages: this.pages }; }
  count() { return Object.values(this.pages).reduce((n, list) => n + list.length, 0); }

  // save at once anything not saved yet (before another piece opens)
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.save) this.save(this.data());
  }

  changed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = 0; if (this.save) this.save(this.data()); }, 400);
  }

  // A transparent canvas the size of the page, with this page's markings
  // crop: the part of the page showing ({ x0, y0, x1, y1 } as page fractions; the whole page if not given)
  layer(page, w, h, crop) {
    const c = document.createElement("canvas");
    c.crop = crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
    c.className = "marks";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.dataset.page = String(page);
    this.layers.set(page, c);
    this.draw(page);
    return c;
  }

  draw(page) {
    const c = this.layers.get(page);
    if (!c) return;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    for (const s of this.pages[page] || []) this.paintOn(c, s);
  }

  // paint a stroke on a layer, through the layer's crop
  paintOn(c, s) {
    const k = c.crop, ctx = c.getContext("2d");
    const W = c.width / (k.x1 - k.x0), H = c.height / (k.y1 - k.y0);
    ctx.save();
    ctx.translate(-k.x0 * W, -k.y0 * H);
    this.paint(ctx, s, W, H);
    ctx.restore();
  }

  // a page's markings drawn onto any canvas of the whole page (for exporting)
  drawPageInto(ctx, page, W, H) {
    for (const s of this.pages[page] || []) this.paint(ctx, s, W, H);
  }

  paint(ctx, s, W, H) {
    ctx.save();
    if (s.t === "stamp") {
      drawStamp(ctx, s.k, s.x * W, s.y * H, 0.022 * W * (s.z || 1), s.c);
    } else if (s.t === "note") {
      ctx.fillStyle = s.c;
      const px = Math.round(0.02 * W * (s.z || 1));
      ctx.font = `600 ${px}px "Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      String(s.s).split("\n").forEach((ln, i) => ctx.fillText(ln, s.x * W, s.y * H + i * px * 1.2));
    } else if (s.t === "text") {
      ctx.fillStyle = s.c;
      ctx.font = `700 ${Math.round(0.026 * W * Math.sqrt(s.z || 1))}px "Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.s, s.x * W, s.y * H);
    } else if (s.t === "hl") {
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = s.c ? washOf(s.c) : HIGHLIGHT;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.lineWidth = s.w * W;
      ctx.beginPath();
      for (let i = 0; i < s.p.length; i += 3) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s.p[i] * W, s.p[i + 1] * H);
      if (s.p.length === 3) ctx.lineTo(s.p[0] * W + 0.1, s.p[1] * H);
      ctx.stroke();
    } else {
      ctx.strokeStyle = s.c;
      ctx.fillStyle = s.c;
      ctx.lineCap = ctx.lineJoin = "round";
      if (s.p.length === 3) { // a dot
        ctx.beginPath();
        ctx.arc(s.p[0] * W, s.p[1] * H, (s.w * W * (0.6 + s.p[2])) / 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      for (let i = 3; i < s.p.length; i += 3) {
        ctx.lineWidth = s.w * W * (0.6 + (s.p[i + 2] + s.p[i - 1]) / 2); // firmer pressure, thicker line
        ctx.beginPath();
        ctx.moveTo(s.p[i - 3] * W, s.p[i - 2] * H);
        ctx.lineTo(s.p[i] * W, s.p[i + 1] * H);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Pencil and finger input on the music
  attach(root) {
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    root.addEventListener("pointerdown", (e) => {
      const pen = e.pointerType === "pen";
      // the hand resting on the screen while writing: ignore it
      if (!pen && (this.active || performance.now() - this.lastPen < 600)) { swallow(e); return; }
      if (!this.enabled() || !this.markMode) return;
      const unit = e.target.closest && e.target.closest(".page");
      if (!unit) return;
      const page = Number(unit.dataset.page);
      const c = this.layers.get(page);
      if (!c || !c.isConnected) return;
      swallow(e);
      if (pen) this.lastPen = performance.now();
      const r = c.getBoundingClientRect(), k = c.crop;
      // where on the page (fractions of the whole page, whatever part of it shows)
      const at = (ev) => [k.x0 + ((ev.clientX - r.left) / r.width) * (k.x1 - k.x0), k.y0 + ((ev.clientY - r.top) / r.height) * (k.y1 - k.y0), ev.pressure > 0 && ev.pointerType === "pen" ? ev.pressure : 0.5];
      const scale = { x: r.width / (k.x1 - k.x0), y: r.height / (k.y1 - k.y0) }; // screen pixels per page fraction
      const [x, y, p] = at(e);
      const kind = this.tool.kind;
      // Move: drag the marking under the finger or Pencil (on an empty spot, the page moves instead, when zoomed in)
      if (kind === "move") {
        const hit = this.hitAt(page, x, y, scale);
        if (!hit) { this.active = null; return; } // not ours: the music stand handles it
        swallow(e);
        try { root.setPointerCapture(e.pointerId); } catch {}
        this.active = { id: e.pointerId, page, c, r: scale, at, move: hit, from: JSON.parse(JSON.stringify(hit)), start: [x, y], last: [x, y] };
        this.drawWith(page, null, hit);
        return;
      }
      swallow(e);
      try { root.setPointerCapture(e.pointerId); } catch {}
      // stamps, finger numbers and text go where the finger lifts (a second finger turns it into a pinch instead)
      if (kind === "finger" || kind === "stamp" || kind === "text") {
        this.active = { id: e.pointerId, page, c, r: scale, at, tap: { x, y, cx: e.clientX, cy: e.clientY, kind } };
        return;
      }
      this.active = { id: e.pointerId, page, c, r: scale, at, erased: [] };
      if (this.tool.kind === "erase") { this.eraseAt(this.active, x, y); return; }
      const hl = this.tool.kind === "highlight";
      this.active.stroke = hl ? { t: "hl", c: this.hlColor, w: 0.018 * this.size, p: [x, y, p] } : { t: "pen", c: this.tool.color, w: 0.0022 * this.size, p: [x, y, p] };
      this.paintOn(c, this.active.stroke);
    }, true);
    root.addEventListener("pointermove", (e) => {
      const a = this.active;
      if (!a || e.pointerId !== a.id) return;
      swallow(e);
      if (e.pointerType === "pen") this.lastPen = performance.now();
      if (a.tap) return;
      if (a.move) {
        const [x, y] = a.at(e);
        this.shift(a.move, x - a.last[0], y - a.last[1]);
        a.last = [x, y];
        this.drawWith(a.page, null, a.move);
        return;
      }
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y, p] = a.at(ev);
        if (this.tool.kind === "erase") { this.eraseAt(a, x, y); continue; }
        const s = a.stroke, n = s.p.length;
        const dx = (x - s.p[n - 3]) * a.r.x, dy = (y - s.p[n - 2]) * a.r.y;
        if (dx * dx + dy * dy < 1.5) continue;
        s.p.push(x, y, p);
        if (s.t === "pen") this.paintOn(a.c, { ...s, p: s.p.slice(-6) });
      }
      if (a.stroke && a.stroke.t === "hl") this.drawWith(a.page, a.stroke);
    }, true);
    const end = (e) => {
      const a = this.active;
      if (!a || e.pointerId !== a.id) return;
      swallow(e);
      if (e.pointerType === "pen") this.lastPen = performance.now();
      this.active = null;
      if (a.tap) {
        const [x, y] = a.at(e), t = a.tap;
        if (Math.hypot((x - t.x) * a.r.x, (y - t.y) * a.r.y) > 14 || e.type === "pointercancel") return;
        if (t.kind === "finger") this.add(a.page, { t: "text", s: this.digit, x: t.x, y: t.y, c: this.tool.color === INKS.black ? INKS.blue : this.tool.color, z: this.size });
        else if (t.kind === "stamp") this.add(a.page, { t: "stamp", k: this.stamp, x: t.x, y: t.y, c: this.tool.color, z: this.size });
        else if (this.onText) this.onText(a.page, t.x, t.y, t.cx, t.cy);
        return;
      }
      if (a.move) {
        const moved = Math.hypot((a.last[0] - a.start[0]) * a.r.x, (a.last[1] - a.start[1]) * a.r.y) > 1;
        if (moved) { this.undoStack.push({ page: a.page, moved: a.move, from: a.from }); this.changed(); }
        this.draw(a.page);
        return;
      }
      if (this.tool.kind === "erase") {
        if (a.erased.length) { this.undoStack.push({ page: a.page, erased: a.erased }); this.changed(); }
        return;
      }
      this.add(a.page, a.stroke);
    };
    root.addEventListener("pointerup", end, true);
    root.addEventListener("pointercancel", end, true);
  }

  // the page as it will look with a stroke still being drawn (for the highlighter, drawn whole each time), or with a
  // marking being moved outlined
  drawWith(page, stroke, picked = null) {
    this.draw(page);
    const c = this.layers.get(page);
    if (!c) return;
    if (stroke) this.paintOn(c, stroke);
    if (picked) {
      const b = this.bounds(picked), k = c.crop, ctx = c.getContext("2d");
      const W = c.width / (k.x1 - k.x0), H = c.height / (k.y1 - k.y0), pad = 6 * (window.devicePixelRatio || 1);
      ctx.save();
      ctx.translate(-k.x0 * W, -k.y0 * H);
      ctx.strokeStyle = "#8a6a1f";
      ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x0 * W - pad, b.y0 * H - pad, (b.x1 - b.x0) * W + 2 * pad, (b.y1 - b.y0) * H + 2 * pad);
      ctx.restore();
    }
  }

  // a marking's box on the page (page fractions; roughly, for text and stamps)
  bounds(s) {
    if (s.p) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let i = 0; i < s.p.length; i += 3) { x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]); y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]); }
      const h = (s.w || 0) / 2;
      return { x0: x0 - h, y0: y0 - h, x1: x1 + h, y1: y1 + h };
    }
    const z = s.z || 1;
    if (s.t === "note") {
      const lines = String(s.s).split("\n"), w = 0.011 * z * Math.max(...lines.map((l) => l.length));
      return { x0: s.x, y0: s.y, x1: s.x + w, y1: s.y + 0.024 * z * lines.length };
    }
    const r = s.t === "stamp" ? 0.03 * z : 0.016 * Math.sqrt(z);
    return { x0: s.x - r, y0: s.y - r * 0.8, x1: s.x + r, y1: s.y + r * 0.8 };
  }

  // the topmost marking at (x, y) on a page, within a finger's width (scale: screen pixels per page fraction)
  hitAt(page, x, y, scale) {
    const list = this.pages[page] || [];
    const reach = 16;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.p) {
        for (let j = 0; j < s.p.length; j += 3) if (Math.hypot((s.p[j] - x) * scale.x, (s.p[j + 1] - y) * scale.y) < reach + (s.t === "hl" ? 10 : 2)) return s;
        continue;
      }
      const b = this.bounds(s);
      const dx = Math.max(b.x0 - x, 0, x - b.x1) * scale.x, dy = Math.max(b.y0 - y, 0, y - b.y1) * scale.y;
      if (Math.hypot(dx, dy) < reach) return s;
    }
    return null;
  }

  shift(s, dx, dy) {
    if (s.p) for (let i = 0; i < s.p.length; i += 3) { s.p[i] += dx; s.p[i + 1] += dy; }
    if (s.x !== undefined) { s.x += dx; s.y += dy; }
  }

  // stop a stroke or tap being made (two fingers came down: it's a pinch)
  cancelActive() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (a.move) Object.assign(a.move, a.from);
    if (a.erased && a.erased.length) { this.undoStack.push({ page: a.page, erased: a.erased }); this.changed(); }
    this.draw(a.page);
  }

  // a text note typed at (x, y) on a page
  addNote(page, x, y, text) {
    const s = String(text || "").trim();
    if (s) this.add(page, { t: "note", s, x, y, c: this.tool.color, z: this.size });
  }

  add(page, stroke) {
    (this.pages[page] ||= []).push(stroke);
    this.undoStack.push({ page, added: stroke });
    this.draw(page);
    this.changed();
  }

  eraseAt(a, x, y) {
    const list = this.pages[a.page] || [];
    const rad = 10; // pixels on screen
    const near = (s) => {
      if (s.t === "text" || s.t === "stamp") return Math.hypot((s.x - x) * a.r.x, (s.y - y) * a.r.y) < rad + 12 * (s.z || 1);
      if (s.t === "note") {
        const w = 0.012 * String(s.s).length * (s.z || 1), h = 0.025 * (s.z || 1) * String(s.s).split("\n").length;
        return x >= s.x - 0.01 && x <= s.x + w + 0.01 && y >= s.y - 0.01 && y <= s.y + h + 0.01;
      }
      for (let i = 0; i < s.p.length; i += 3) if (Math.hypot((s.p[i] - x) * a.r.x, (s.p[i + 1] - y) * a.r.y) < rad + (s.t === "hl" ? 8 : 2)) return true;
      return false;
    };
    const keep = [];
    for (const s of list) { if (near(s)) a.erased.push(s); else keep.push(s); }
    if (keep.length !== list.length) { this.pages[a.page] = keep; this.draw(a.page); }
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) return false;
    const list = (this.pages[u.page] ||= []);
    if (u.added) { const i = list.lastIndexOf(u.added); if (i >= 0) list.splice(i, 1); }
    if (u.erased) list.push(...u.erased);
    if (u.cleared) this.pages[u.page] = u.cleared;
    if (u.moved) Object.assign(u.moved, u.from);
    this.draw(u.page);
    this.changed();
    return true;
  }

  clearPage(page) {
    const list = this.pages[page];
    if (!list || !list.length) return false;
    this.undoStack.push({ page, cleared: list });
    this.pages[page] = [];
    this.draw(page);
    this.changed();
    return true;
  }
}
