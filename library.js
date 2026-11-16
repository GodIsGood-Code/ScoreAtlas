// The library panel: every PDF opened on this iPad, and setlists (pieces in the order they'll be played).
// Pieces: tap to open; rename; remove (tap twice). Setlists: make one, add pieces, put them in order, play it.

import { listMeta, putMeta, removePiece, loadSetlists, saveSetlists } from "./store.js";

const ago = (t) => {
  const d = Math.floor((Date.now() - t) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString();
};

export class LibraryUI {
  // panel: the <aside>; onOpen(key); onAdd(): pick a new PDF; onPlay(setlist, index)
  constructor(panel, { onOpen, onAdd, onPlay }) {
    Object.assign(this, { panel, onOpen, onAdd, onPlay });
    this.tab = "pieces";
    this.editing = null; // the setlist being edited
    this.pieces = [];
    this.setlists = [];
    this.body = panel.querySelector(".lib-body");
    this.search = panel.querySelector(".lib-search");
    panel.querySelector(".lib-close").addEventListener("click", () => this.close());
    panel.querySelector(".lib-add").addEventListener("click", () => this.onAdd());
    for (const b of panel.querySelectorAll(".lib-tab")) b.addEventListener("click", () => { this.tab = b.dataset.tab; this.editing = null; this.render(); });
    this.search.addEventListener("input", () => this.render());
  }

  get isOpen() { return !this.panel.hidden; }

  async open(tab) {
    if (tab) { this.tab = tab; this.editing = null; }
    await this.refresh();
    this.panel.hidden = false;
  }

  close() { this.panel.hidden = true; }

  async refresh() {
    this.pieces = (await listMeta()).sort((a, b) => (b.opened || 0) - (a.opened || 0));
    this.setlists = await loadSetlists();
    this.render();
  }

  name(key) { const p = this.pieces.find((x) => x.key === key); return p ? p.name : "(removed)"; }

  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  button(text, cls, onClick, label) {
    const b = this.el("button", `btn small ${cls || ""}`.trim(), text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }

  render() {
    for (const b of this.panel.querySelectorAll(".lib-tab")) b.setAttribute("aria-pressed", String(b.dataset.tab === this.tab));
    this.search.hidden = this.tab !== "pieces" || !!this.editing;
    this.body.textContent = "";
    if (this.editing) return this.renderEditor();
    if (this.tab === "pieces") return this.renderPieces();
    return this.renderSetlists();
  }

  renderPieces() {
    const q = this.search.value.trim().toLowerCase();
    const list = this.pieces.filter((p) => !q || p.name.toLowerCase().includes(q));
    if (!this.pieces.length) {
      this.body.append(this.el("p", "note", "No pieces yet. Tap “Add a PDF” to put one in your library. Every PDF you open is kept here."));
      return;
    }
    if (!list.length) { this.body.append(this.el("p", "note", "No piece matches.")); return; }
    const grid = this.el("div", "lib-grid");
    for (const p of list) {
      const card = this.el("div", "lib-piece");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Open ${p.name}`);
      const thumb = this.el("div", "lib-thumb");
      if (p.thumb) { const img = this.el("img"); img.src = p.thumb; img.alt = ""; thumb.append(img); }
      const info = this.el("div", "lib-info");
      info.append(this.el("b", "lib-name", p.name), this.el("span", "lib-meta", `${p.pages} page${p.pages === 1 ? "" : "s"} · opened ${ago(p.opened || p.added)}`));
      const actions = this.el("div", "lib-actions");
      actions.append(
        this.button("Rename", "", async () => {
          const name = window.prompt("New name for this piece:", p.name);
          if (name && name.trim()) { p.name = name.trim(); await putMeta(p); this.render(); }
        }),
        this.button("Remove", "", async (b) => {
          if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to remove"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Remove"; }, 4000); return; }
          await removePiece(p.key);
          for (const s of this.setlists) s.items = s.items.filter((k) => k !== p.key);
          await saveSetlists(this.setlists);
          await this.refresh();
        }),
      );
      card.append(thumb, info, actions);
      const open = () => { this.close(); this.onOpen(p.key); };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      grid.append(card);
    }
    this.body.append(grid);
  }

  renderSetlists() {
    const top = this.el("div", "lib-row");
    top.append(this.button("New setlist", "", async () => {
      const s = { id: `s${Date.now()}`, name: "New setlist", items: [] };
      this.setlists.push(s);
      await saveSetlists(this.setlists);
      this.editing = s;
      this.render();
    }));
    this.body.append(top);
    if (!this.setlists.length) { this.body.append(this.el("p", "note", "A setlist plays pieces one after another: on a piece's last page, the pedal goes on to the next piece.")); return; }
    const list = this.el("ul", "lib-list");
    for (const s of this.setlists) {
      const li = this.el("li");
      const text = this.el("div", "lib-info");
      text.append(this.el("b", "lib-name", s.name), this.el("span", "lib-meta", s.items.length ? s.items.map((k) => this.name(k)).join(" · ") : "no pieces yet"));
      const actions = this.el("div", "lib-actions");
      const play = this.button("Play", "primary", () => { if (s.items.length) { this.close(); this.onPlay(s, 0); } });
      play.disabled = !s.items.length;
      actions.append(play, this.button("Edit", "", () => { this.editing = s; this.render(); }));
      li.append(text, actions);
      list.append(li);
    }
    this.body.append(list);
  }

  renderEditor() {
    const s = this.editing;
    const save = () => saveSetlists(this.setlists);
    const head = this.el("div", "lib-row");
    const name = this.el("input", "lib-setname");
    name.type = "text";
    name.value = s.name;
    name.setAttribute("aria-label", "Setlist name");
    name.addEventListener("input", () => { s.name = name.value.trim() || "Setlist"; save(); });
    head.append(name, this.button("Done", "primary", () => { this.editing = null; this.render(); }));
    this.body.append(head);
    const list = this.el("ol", "lib-list lib-order");
    s.items.forEach((key, i) => {
      const li = this.el("li");
      li.append(this.el("span", "lib-name", this.name(key)));
      const actions = this.el("div", "lib-actions");
      const move = (d) => { const j = i + d; [s.items[i], s.items[j]] = [s.items[j], s.items[i]]; save(); this.render(); };
      const up = this.button("↑", "icon", () => move(-1), "Move up"), down = this.button("↓", "icon", () => move(1), "Move down");
      up.disabled = i === 0;
      down.disabled = i === s.items.length - 1;
      actions.append(up, down, this.button("✕", "icon", () => { s.items.splice(i, 1); save(); this.render(); }, "Take out of the setlist"));
      li.append(actions);
      list.append(li);
    });
    if (!s.items.length) this.body.append(this.el("p", "note", "Add pieces from your library below, in the order you'll play them."));
    else this.body.append(list);
    this.body.append(this.el("h3", null, "Add pieces"));
    const add = this.el("ul", "lib-list");
    for (const p of this.pieces) {
      const li = this.el("li");
      li.append(this.el("span", "lib-name", p.name), this.button("Add", "", () => { s.items.push(p.key); save(); this.render(); }, `Add ${p.name}`));
      add.append(li);
    }
    this.body.append(add);
    const del = this.button("Delete this setlist", "", async (b) => {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; return; }
      this.setlists = this.setlists.filter((x) => x !== s);
      await save();
      this.editing = null;
      this.render();
    });
    del.classList.add("lib-delete");
    this.body.append(del);
  }
}
