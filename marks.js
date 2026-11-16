// Markings on the music with Apple Pencil or a finger, while "Mark" is on (so nothing is marked by accident): pen in three colours, highlighter,
// fingering numbers, an eraser that removes whole strokes, and undo. Strokes are kept as points relative to the page
// (0..1 across and down), so they stay in place at any size, in two-page view and in half-page view.
// While the Pencil is writing, touches from the hand resting on the screen are ignored (they don't turn the page).

export const INKS = { black: "#1a1d21", red: "#c62828", blue: "#1f5fc4" };
const HIGHLIGHT = "rgba(255, 210, 0, 0.36)";

export class Marks {
  // save(data): called (a moment after) each change; enabled(): whether drawing is allowed now (not locked, say)
  constructor({ save, enabled = () => true } = {}) {
    this.pages = {};
    this.layers = new Map(); // page -> its canvas on screen
    this.tool = { kind: "pen", color: INKS.black }; // kind: pen, highlight, finger (digit), erase
    this.digit = "1";
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
  layer(page, w, h) {
    const c = document.createElement("canvas");
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
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of this.pages[page] || []) this.paint(ctx, s, c.width, c.height);
  }

  paint(ctx, s, W, H) {
    ctx.save();
    if (s.t === "text") {
      ctx.fillStyle = s.c;
      ctx.font = `700 ${Math.round(0.026 * W)}px "Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.s, s.x * W, s.y * H);
    } else if (s.t === "hl") {
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = HIGHLIGHT;
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
      const r = c.getBoundingClientRect();
      const at = (ev) => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, ev.pressure > 0 && ev.pointerType === "pen" ? ev.pressure : 0.5];
      const [x, y, p] = at(e);
      if (this.tool.kind === "finger") {
        this.add(page, { t: "text", s: this.digit, x, y, c: INKS.blue });
        return;
      }
      try { root.setPointerCapture(e.pointerId); } catch {}
      this.active = { id: e.pointerId, page, c, r, at, erased: [] };
      if (this.tool.kind === "erase") { this.eraseAt(this.active, x, y); return; }
      const hl = this.tool.kind === "highlight";
      this.active.stroke = hl ? { t: "hl", w: 0.018, p: [x, y, p] } : { t: "pen", c: this.tool.color, w: 0.0022, p: [x, y, p] };
      this.paint(c.getContext("2d"), this.active.stroke, c.width, c.height);
    }, true);
    root.addEventListener("pointermove", (e) => {
      const a = this.active;
      if (!a || e.pointerId !== a.id) return;
      swallow(e);
      if (e.pointerType === "pen") this.lastPen = performance.now();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y, p] = a.at(ev);
        if (this.tool.kind === "erase") { this.eraseAt(a, x, y); continue; }
        const s = a.stroke, n = s.p.length;
        const dx = (x - s.p[n - 3]) * a.r.width, dy = (y - s.p[n - 2]) * a.r.height;
        if (dx * dx + dy * dy < 1.5) continue;
        s.p.push(x, y, p);
        if (s.t === "pen") this.paint(a.c.getContext("2d"), { ...s, p: s.p.slice(-6) }, a.c.width, a.c.height);
      }
      if (a.stroke && a.stroke.t === "hl") this.drawWith(a.page, a.stroke);
    }, true);
    const end = (e) => {
      const a = this.active;
      if (!a || e.pointerId !== a.id) return;
      swallow(e);
      if (e.pointerType === "pen") this.lastPen = performance.now();
      this.active = null;
      if (this.tool.kind === "erase") {
        if (a.erased.length) { this.undoStack.push({ page: a.page, erased: a.erased }); this.changed(); }
        return;
      }
      this.add(a.page, a.stroke);
    };
    root.addEventListener("pointerup", end, true);
    root.addEventListener("pointercancel", end, true);
  }

  // the page as it will look with a stroke still being drawn (for the highlighter, drawn whole each time)
  drawWith(page, stroke) {
    this.draw(page);
    const c = this.layers.get(page);
    if (c) this.paint(c.getContext("2d"), stroke, c.width, c.height);
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
      if (s.t === "text") return Math.hypot((s.x - x) * a.r.width, (s.y - y) * a.r.height) < rad + 8;
      for (let i = 0; i < s.p.length; i += 3) if (Math.hypot((s.p[i] - x) * a.r.width, (s.p[i + 1] - y) * a.r.height) < rad + (s.t === "hl" ? 8 : 2)) return true;
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
