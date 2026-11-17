// Getting things out of ScoreAtlas and back in: a backup of everything (library, lessons, markings, practice history,
// setlists, settings) as one file; a PDF with the Pencil markings drawn in (for a teacher); a recording as a WAV file.
// Files are handed to the iPad's share sheet (AirDrop, Mail, Save to Files, iCloud Drive) or downloaded.

import { zipSync, unzipSync, strToU8, strFromU8 } from "./vendor/fflate/fflate.js";
import { entries, putEntries } from "./store.js";

// ---------- Handing a file to the person ----------
export async function shareFile(bytes, name, type) {
  const file = new File([bytes], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return "shared";
    }
  } catch (err) {
    if (err && err.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}

// ---------- Backup ----------
const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
const SETTINGS_KEYS = ["pt-settings", "pt-view", "pt-welcomed"];

// Everything as a zip: scoreatlas.json (the structure) and bin/<n> (the binary parts: PDFs, the learned sound).
// only: { keys, setlist } for sharing a setlist: just those pieces (their PDFs, sheet music and markings, not practice
// history) and that one setlist, without settings. The same file opens with Library → Add or Settings → Restore.
export async function makeBackup(only = null) {
  const bins = [];
  const encode = (v) => {
    if (v instanceof ArrayBuffer) v = new Uint8Array(v);
    if (ArrayBuffer.isView(v)) {
      const t = v.constructor.name;
      bins.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
      return { __bin: bins.length - 1, t };
    }
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = encode(v[k]); return o; }
    return v;
  };
  const data = { app: "ScoreAtlas", version: 1, made: new Date().toISOString(), stores: {}, settings: {} };
  const keys = only ? new Set(only.keys) : null;
  const wanted = (store, k) => {
    if (!keys) return true;
    k = String(k);
    if (store === "files") return k.startsWith("piece|") || k.startsWith("meta|") ? keys.has(k.slice(k.indexOf("|") + 1)) : false;
    return keys.has(k) || (k.endsWith("|marks") && keys.has(k.slice(0, -6)));
  };
  for (const name of ["lessons", "files"]) data.stores[name] = (await entries(name)).filter(([k]) => wanted(name, k)).map(([k, v]) => [k, encode(v)]);
  if (only && only.setlist) data.stores.files.push(["setlists", [only.setlist]]);
  if (only) data.shared = only.setlist ? only.setlist.name : true;
  else for (const k of SETTINGS_KEYS) { try { const v = localStorage.getItem(k); if (v !== null) data.settings[k] = v; } catch {} }
  const files = { "scoreatlas.json": strToU8(JSON.stringify(data)) };
  bins.forEach((b, i) => { files[`bin/${i}`] = [b, { level: 0 }]; }); // PDFs and sound features hardly compress
  const pieces = data.stores.files.filter(([k]) => String(k).startsWith("meta|")).length;
  return { bytes: zipSync(files, { level: 6 }), pieces };
}

// Puts a backup back (what's on the iPad is kept; pieces in both are replaced by the backup's)
export async function restoreBackup(bytes) {
  let files;
  try { files = unzipSync(bytes); } catch { throw new Error("This isn't a ScoreAtlas backup file."); }
  if (!files["scoreatlas.json"]) throw new Error("This isn't a ScoreAtlas backup file.");
  const data = JSON.parse(strFromU8(files["scoreatlas.json"]));
  if (data.app !== "ScoreAtlas") throw new Error("This isn't a ScoreAtlas backup file.");
  const decode = (v) => {
    if (v && typeof v === "object" && !Array.isArray(v) && "__bin" in v) {
      const raw = files[`bin/${v.__bin}`];
      const T = TYPED[v.t] || Uint8Array;
      const copy = raw.slice();
      return new T(copy.buffer, 0, copy.byteLength / T.BYTES_PER_ELEMENT);
    }
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = decode(v[k]); return o; }
    return v;
  };
  for (const name of ["lessons", "files"]) {
    const list = (data.stores[name] || []).map(([k, v]) => [k, decode(v)]);
    // setlists are merged, not replaced
    if (name === "files") {
      const mine = (await entries("files")).find(([k]) => k === "setlists");
      const theirs = list.find(([k]) => k === "setlists");
      if (mine && theirs) {
        const ids = new Set(theirs[1].map((s) => s.id));
        theirs[1] = [...theirs[1], ...mine[1].filter((s) => !ids.has(s.id))];
      }
    }
    await putEntries(name, list);
  }
  for (const [k, v] of Object.entries(data.settings || {})) { try { localStorage.setItem(k, v); } catch {} }
  return { pieces: (data.stores.files || []).filter(([k]) => String(k).startsWith("meta|")).length, made: data.made, shared: data.shared || null };
}

// ---------- A recording as a WAV file ----------
export function wavFile(samples, rate) {
  const n = samples.length, out = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF"); out.setUint32(4, 36 + n * 2, true); text(8, "WAVE");
  text(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  text(36, "data"); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return new Uint8Array(out.buffer);
}

// ---------- A PDF of the pages with the markings drawn in ----------
// pdf: the open PDF.js document; drawMarks(ctx, page, w, h): paints that page's markings
export async function markedPdf(pdf, drawMarks, onProgress = () => {}) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 2400 / Math.max(base.width, base.height)); // about 160 dots per inch
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    drawMarks(ctx, n, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, wPt: base.width, hPt: base.height });
    c.width = c.height = 0;
    page.cleanup();
  }
  return buildPdf(pages);
}

// A plain PDF with one JPEG picture per page
export function buildPdf(pages) {
  const parts = [], offsets = [];
  let size = 0;
  const add = (x) => { const b = typeof x === "string" ? strToU8(x, true) : x; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; add(`${n} 0 obj\n`); for (const b of [].concat(body)) add(b); add("\nendobj\n"); };
  add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const count = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, img = pg + 1, content = pg + 2;
    const draw = `q ${p.wPt.toFixed(2)} 0 0 ${p.hPt.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.wPt.toFixed(2)} ${p.hPt.toFixed(2)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`);
    obj(img, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, "\nendstream"]);
    obj(content, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });
  const total = 3 + count * 3;
  const xref = size;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  add(table);
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const b of parts) { out.set(b, at); at += b.length; }
  return out;
}
