// Page tools: remove pages (blank ones found for you), put them in another order, turn them the right way up, and add
// pages from other PDFs, then save the piece as a new PDF. The pages themselves are copied as they are (pdf-lib, no
// loss of quality); markings move with their pages.

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export class PageEditor {
  // panel: the <aside>; loadDoc(bytes): a PDF.js document; onSave({ bytes, mapping, asCopy }) where mapping[i] is
  // { src, page, rot } for new page i + 1 (src 0: the piece itself)
  constructor(panel, { loadDoc, onSave, toast = () => {} }) {
    Object.assign(this, { panel, loadDoc, onSave, toast });
    this.grid = panel.querySelector(".pe-grid");
    this.info = panel.querySelector(".pe-info");
    this.pick = panel.querySelector(".pe-file");
    panel.querySelector(".pe-close").addEventListener("click", () => this.close());
    panel.querySelector(".pe-cancel").addEventListener("click", () => this.close());
    panel.querySelector(".pe-add").addEventListener("click", () => this.pick.click());
    panel.querySelector(".pe-blank").addEventListener("click", () => this.removeBlank());
    panel.querySelector(".pe-save").addEventListener("click", () => this.save(false));
    panel.querySelector(".pe-copy").addEventListener("click", () => this.save(true));
    this.pick.addEventListener("change", async () => {
      const files = [...(this.pick.files || [])];
      this.pick.value = "";
      for (const f of files) await this.addPdf(new Uint8Array(await f.arrayBuffer()), f.name);
    });
  }

  get isOpen() { return !this.panel.hidden; }

  // doc: the open PDF.js document; bytes: its file
  async open(doc, bytes, name) {
    this.sources = [{ bytes, doc, name }];
    this.items = [];
    this.name = name;
    this.panel.hidden = false;
    for (let n = 1; n <= doc.numPages; n++) this.items.push({ src: 0, page: n, rot: 0, removed: false, thumb: null, ink: null });
    this.render();
    await this.thumbs();
  }

  close() {
    this.panel.hidden = true;
    for (const s of (this.sources || []).slice(1)) s.doc.destroy();
    this.sources = [];
    this.items = [];
  }

  async addPdf(bytes, name) {
    let doc;
    try { doc = await this.loadDoc(bytes.slice()); } catch { this.toast(`Couldn't open ${name}`, 2500); return; }
    const src = this.sources.push({ bytes, doc, name }) - 1;
    for (let n = 1; n <= doc.numPages; n++) this.items.push({ src, page: n, rot: 0, removed: false, thumb: null, ink: null });
    this.render();
    await this.thumbs();
    this.toast(`Added ${doc.numPages} page${doc.numPages === 1 ? "" : "s"} from ${name.replace(/\.pdf$/i, "")} at the end`, 2600);
  }

  // small pictures of the pages, and how much ink each has (to find blank ones)
  async thumbs() {
    for (const it of this.items) {
      if (it.thumb || !this.isOpen) continue;
      const page = await this.sources[it.src].doc.getPage(it.page);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 150 / vp0.width });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      // the edges are left out: scans often have a dark border
      const mx = Math.round(c.width * 0.06), my = Math.round(c.height * 0.05);
      for (let y = my; y < c.height - my; y++) for (let x = mx; x < c.width - mx; x++) { const i = (y * c.width + x) * 4; if (px[i] + px[i + 1] + px[i + 2] < 3 * 150) dark++; }
      it.ink = dark / ((c.width - 2 * mx) * (c.height - 2 * my));
      it.thumb = c;
      page.cleanup();
      this.drawItem(it);
    }
  }

  removeBlank() {
    let n = 0;
    for (const it of this.items) if (!it.removed && it.ink !== null && it.ink < 0.004) { it.removed = true; n++; }
    this.render();
    this.toast(n ? `${n} blank page${n === 1 ? "" : "s"} taken out (tap Put back to keep one)` : "No blank pages found", 2600);
  }

  move(it, d) {
    const i = this.items.indexOf(it), j = i + d;
    if (j < 0 || j >= this.items.length) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    this.render();
  }

  render() {
    this.grid.textContent = "";
    const kept = this.items.filter((x) => !x.removed).length;
    this.info.textContent = `${kept} page${kept === 1 ? "" : "s"}${kept !== this.items.length ? ` (${this.items.length - kept} taken out)` : ""}`;
    let n = 0;
    for (const it of this.items) {
      if (!it.removed) n++;
      const card = make("div", "pe-page");
      card.dataset.removed = it.removed ? "1" : "";
      it.card = card;
      it.label = !it.removed ? n : null;
      this.drawItem(it);
      this.grid.append(card);
    }
  }

  drawItem(it) {
    const card = it.card;
    if (!card) return;
    card.textContent = "";
    const pic = make("div", "pe-thumb");
    if (it.thumb) {
      const img = new Image();
      img.src = it.thumb.toDataURL("image/jpeg", 0.7);
      img.alt = "";
      img.style.transform = `rotate(${it.rot}deg)`;
      pic.append(img);
    }
    const label = make("div", "pe-label");
    const src = this.sources[it.src];
    label.append(make("b", null, it.removed ? "Taken out" : `Page ${it.label}`), make("span", "pe-from", it.src ? `${src.name.replace(/\.pdf$/i, "")} p. ${it.page}` : `was p. ${it.page}`));
    const btns = make("div", "pe-btns");
    const b = (text, aria, fn) => { const x = make("button", "btn small", text); x.type = "button"; x.setAttribute("aria-label", aria); x.addEventListener("click", fn); return x; };
    if (it.removed) btns.append(b("Put back", "Put this page back", () => { it.removed = false; this.render(); }));
    else {
      btns.append(
        b("←", "Move earlier", () => this.move(it, -1)),
        b("→", "Move later", () => this.move(it, 1)),
        b("↻", "Turn a quarter turn", () => { it.rot = (it.rot + 90) % 360; this.drawItem(it); }),
        b("✕", "Take this page out", () => { it.removed = true; this.render(); }),
      );
    }
    card.append(pic, label, btns);
  }

  async save(asCopy) {
    const keep = this.items.filter((x) => !x.removed);
    if (!keep.length) { this.toast("Keep at least one page", 2000); return; }
    const buttons = this.panel.querySelectorAll(".pe-save, .pe-copy");
    buttons.forEach((x) => { x.disabled = true; });
    try {
      const { PDFDocument, degrees } = await import("./vendor/pdf-lib/pdf-lib.esm.min.js");
      const out = await PDFDocument.create();
      const docs = [];
      for (const s of this.sources) docs.push(await PDFDocument.load(s.bytes, { ignoreEncryption: true }));
      for (const it of keep) {
        const [pg] = await out.copyPages(docs[it.src], [it.page - 1]);
        if (it.rot) pg.setRotation(degrees((pg.getRotation().angle + it.rot) % 360));
        out.addPage(pg);
      }
      const bytes = await out.save();
      const mapping = keep.map((it) => ({ src: it.src, page: it.page, rot: it.rot }));
      await this.onSave({ bytes, mapping, asCopy });
      this.close();
    } catch (err) {
      this.toast(`Couldn't save the pages: ${err.message || err}`, 3500);
    } finally {
      buttons.forEach((x) => { x.disabled = false; });
    }
  }
}

// Markings moved with their pages: data { pages: { n: [marks] } } and the new order -> new data
export function remapMarks(data, mapping) {
  const out = { v: 1, pages: {} };
  if (!data || !data.pages) return out;
  const turn = (x, y, rot) => (rot === 90 ? [1 - y, x] : rot === 180 ? [1 - x, 1 - y] : rot === 270 ? [y, 1 - x] : [x, y]);
  mapping.forEach((m, i) => {
    if (m.src !== 0) return;
    const list = data.pages[m.page];
    if (!list || !list.length) return;
    out.pages[i + 1] = list.map((s) => {
      const c = JSON.parse(JSON.stringify(s));
      if (c.p) for (let k = 0; k < c.p.length; k += 3) [c.p[k], c.p[k + 1]] = turn(c.p[k], c.p[k + 1], m.rot);
      if (c.x !== undefined) [c.x, c.y] = turn(c.x, c.y, m.rot);
      return c;
    });
  });
  return out;
}
