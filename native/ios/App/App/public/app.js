// ScoreAtlas (the app; the project is called page-turner): shows a PDF one page at a time and turns pages from a Bluetooth pedal, taps or swipes.
// Teach: play the piece, or any section of it, turning pages yourself; sections add up. Sheet music: add the
// piece's MusicXML (from Audiveris) and the app learns it without teaching. Follow: play from anywhere and the app
// turns the pages by listening, keeping up with practice, and highlights the measure being played.
import { Microphone } from "./listen.js";
import { NOTE_NAMES, BLACK_KEYS, FRAME_RATE } from "./engine/features.js";
import { Hearing } from "./engine/hearing.js";
import { makeLesson, addSection, sectionsOf, Follower, FOLLOW_SETTINGS } from "./engine/follower.js";
import { loadLesson, saveLesson, forgetLesson, loadLastFile, saveLastFile, keepData, savePiece, loadPiece, loadMeta, putMeta, removePiece, loadSetlists, saveSetlists, listMeta } from "./store.js";
import { Marks, INKS, STAMPS, drawStamp } from "./marks.js";
import { LibraryUI } from "./library.js";
import { Metronome, TempoLadder, tempoName } from "./metronome.js";
import { PageEditor, remapMarks } from "./pages.js";
import { pairFiles } from "./importer.js";
import { troubleSpots, troubleText } from "./engine/trouble.js";
import { synthesize } from "./engine/synth.js";
import { renderJournal } from "./journal.js";
import { makeBackup, restoreBackup, shareFile, wavFile, markedPdf } from "./share.js";
import { expectedNotes, checkNotes, noteName } from "./engine/notecheck.js";
import { readScore, keepParts, keepHand, withPageStarts, shiftPages, parsePageStarts, playOrder, suggestParts, timeline } from "./engine/score.js";
import { scoreSection } from "./engine/scorelesson.js";
import { findMeasures, findMeasuresByCount, systemCounts } from "./engine/layout.js";
import { MeasureMarker } from "./engine/marker.js";
import { PracticeLog, busiestPassages } from "./engine/practice.js";
import { Recorder } from "./engine/recorder.js";

const PDFJS = new URL("./vendor/pdfjs/", import.meta.url).href;
// Running as the App Store app (Capacitor, see native/): a few things go through the app instead of the browser
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const native = (msg) => { try { window.webkit.messageHandlers.scoreAtlas.postMessage(msg); } catch { /* not in the app */ } };
if (NATIVE) document.documentElement.classList.add("native");
const SAMPLE = { url: "samples/warm-ups.pdf", name: "Sample: Warm-ups", score: "samples/warm-ups.musicxml" };

const $ = (id) => document.getElementById(id);
const stand = $("stand"), sheet = $("sheet"), pageNum = $("pageNum");
const fileName = $("fileName"), fileInput = $("fileInput");
const card = $("card"), helpBtn = $("helpBtn"), keysSeen = $("keysSeen");
const teachBtn = $("teachBtn"), followBtn = $("followBtn"), micBtn = $("micBtn"), forgetBtn = $("forgetBtn");
const scoreBtn = $("scoreBtn"), scoreInput = $("scoreInput");
const scoreOpts = $("scoreOpts"), partsBox = $("partsBox"), partsList = $("partsList"), barsInput = $("barsInput"), applyBtn = $("applyBtn");
// the measure highlight, drawn over the page
const marker = document.createElement("div");
marker.className = "measure-mark";
marker.hidden = true;
const smoother = new MeasureMarker(FRAME_RATE / 2); // drawn every other frame
// loop outlines and the practice "heat" on the bars, drawn over the page
const overlay = document.createElement("div");
overlay.className = "overlay";
const loopBtn = $("loopBtn"), reportPanel = $("report");
let historyTab = "session"; // the Practice history panel's tab: session, takes or journal
let practice = null; // PracticeLog while following with sheet music
let sessionHands = "both";
let lastReport = null; // the most recent session's report
let loop = null; // { from, to } measure indices of the passage being looped
let loopPick = 0; // 1: waiting for the first bar to be tapped, 2: for the last
let loopFirst = -1;
let heatOn = true;
const modebar = $("modebar"), modeText = $("modeText"), progress = $("progress"), progressFill = $("progressFill");

const state = { pdf: null, page: 1, count: 0, cache: new Map(), layout: "", name: "", key: null, lesson: null };
const zoom = { z: 1, x: 0, y: 0, res: 1 }; // pinch to zoom: scale, shift (screen pixels), resolution the pages are drawn at
const ZOOM_MAX = 4;
let mode = "idle"; // idle, teach, follow or replay
let locked = false; // performance lock: taps and Pencil do nothing, only the pedal turns pages
let marksKey = null; // the piece the markings belong to
const marks = new Marks({
  save: (data) => { if (marksKey) saveLesson(`${marksKey}|marks`, data).catch(() => toast("Couldn't save your markings on this iPad.", 3000)); },
  enabled: () => !locked && mode !== "replay",
});
let setlist = null; // { list: { id, name, items }, index } while playing a setlist

// Settings (kept on this iPad)
const settings = { turnShift: 0, highlight: true, tapTurns: true, awake: true, theme: "auto" };
try { Object.assign(settings, JSON.parse(localStorage.getItem("pt-settings") || "{}")); } catch {}
const saveSettings = () => { try { localStorage.setItem("pt-settings", JSON.stringify(settings)); } catch {} };
function applyTheme() {
  if (settings.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}
applyTheme();
// The follower's settings with the pianist's page-turn timing (seconds earlier, negative for later)
function followSettings() {
  const shift = settings.turnShift || 0, base = FOLLOW_SETTINGS.anticipation;
  return { ...FOLLOW_SETTINGS, anticipation: Math.max(0, base + shift), scoreLead: Math.max(0, FOLLOW_SETTINGS.scoreLead + Math.min(0, base + shift)) };
}
let teach = null; // { frames, turns } while teaching
let follower = null;
let micCheck = false;

/* ---------- PDF loading ---------- */
let libPromise = null;
function loadPdfLib() {
  if (!libPromise) {
    libPromise = import(PDFJS + "pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
      return lib;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

let openToken = 0;
async function openPdf(data, name) {
  const token = ++openToken;
  setStatus(`Opening ${name}…`);
  let pdf;
  try {
    const lib = await loadPdfLib();
    pdf = await lib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (err) {
    if (token !== openToken) return false;
    const locked = err && err.name === "PasswordException";
    setStatus(locked
      ? `${name} is password-protected. Remove the password, then open it again.`
      : `Couldn't open ${name}. Check that it's a PDF file and try again.`, "error");
    if (!state.pdf) fileName.textContent = "No PDF open";
    return false;
  }
  if (token !== openToken) { pdf.destroy(); return false; } // a newer file was opened meanwhile
  stopMode(!!setlist);
  marks.flush();
  marksKey = null;
  marks.load(null);
  const old = state.pdf;
  dropCache(() => true);
  Object.assign(state, { pdf, count: pdf.numPages, page: 1, name, lesson: null });
  zoom.z = 1; zoom.x = 0; zoom.y = 0; zoom.res = 1; applyZoom(); state.layout = layoutKey();
  state.key = `${(pdf.fingerprints && pdf.fingerprints[0]) || name}:${pdf.numPages}`;
  fileName.textContent = name.replace(/\.pdf$/i, "");
  fileName.title = name;
  if (old) old.destroy();
  await show(1);
  const key = state.key;
  const [lesson, marked] = await Promise.all([loadLesson(key), loadLesson(`${key}|marks`)]);
  if (state.key === key) {
    marksKey = key;
    marks.load(marked);
    state.lesson = lesson || null;
    updateLessonInfo();
    updateButtons();
  }
  return true;
}

/* ---------- Drawing pages ---------- */
// Display options (kept on this iPad): two pages side by side when the iPad is sideways, and half-page turns (the
// top half of the next page shows while the bottom half of this one is still being played)
const view = { twoUp: false, halfTurns: false, half: false, crop: false, darkPages: false };
try { Object.assign(view, JSON.parse(localStorage.getItem("pt-view") || "{}"), { half: false }); } catch {}
const saveView = () => { try { localStorage.setItem("pt-view", JSON.stringify({ twoUp: view.twoUp, halfTurns: view.halfTurns, crop: view.crop, darkPages: view.darkPages })); } catch {} };
const FULL = { x0: 0, y0: 0, x1: 1, y1: 1 };
// Trimming margins: the part of each page with music on it (page fractions), found once from a small picture
const cropCache = new Map();
async function cropFor(n, page) {
  const key = `${state.key}|${n}`;
  if (cropCache.has(key)) return cropCache.get(key);
  let box = FULL;
  try {
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 240 / base.width });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const W = c.width, H = c.height;
    const rows = new Uint16Array(H), cols = new Uint16Array(W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4] < 150) { rows[y]++; cols[x]++; }
    // a row or column counts as music when it has a few dark dots (specks and scanner shadows at the edge don't)
    const firstOf = (a, lo, hi, step) => { for (let i = lo; i !== hi; i += step) if (a[i] >= 2) return i; return -1; };
    const m = 0.02; // ignore the outermost 2% (scanner edges)
    const y0 = firstOf(rows, Math.floor(H * m), H, 1), y1 = firstOf(rows, Math.ceil(H * (1 - m)) - 1, -1, -1);
    const x0 = firstOf(cols, Math.floor(W * m), W, 1), x1 = firstOf(cols, Math.ceil(W * (1 - m)) - 1, -1, -1);
    if (y0 >= 0 && x0 >= 0 && y1 > y0 && x1 > x0) {
      const pad = 0.015;
      box = { x0: Math.max(0, x0 / W - pad), y0: Math.max(0, y0 / H - pad), x1: Math.min(1, (x1 + 1) / W + pad), y1: Math.min(1, (y1 + 1) / H + pad) };
      if ((box.x1 - box.x0) * (box.y1 - box.y0) > 0.92) box = FULL; // hardly any margin: leave the page as it is
    }
    c.width = c.height = 0;
  } catch {}
  cropCache.set(key, box);
  return box;
}
function isTwoUp() {
  const r = stand.getBoundingClientRect();
  return view.twoUp && state.count > 1 && r.width > r.height * 1.1;
}
// the first page of the pair showing page n (pairs 1–2, 3–4, ...)
const spreadStart = (n) => (n % 2 ? n : n - 1);

function layoutKey() {
  const r = stand.getBoundingClientRect();
  return `${Math.round(r.width)}x${Math.round(r.height)}@${window.devicePixelRatio || 1}${isTwoUp() ? "|2" : ""}${view.crop ? "|crop" : ""}${zoom.res > 1 ? `|z${zoom.res}` : ""}`;
}

function render(n) {
  const key = `${n}|${state.layout}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const pdf = state.pdf;
  const two = isTwoUp();
  const job = (async () => {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const crop = view.crop ? await cropFor(n, page) : FULL;
    const bw = base.width * (crop.x1 - crop.x0), bh = base.height * (crop.y1 - crop.y0); // the part shown, in points
    const r = stand.getBoundingClientRect();
    const w = Math.max(80, two ? (r.width - 36) / 2 : r.width - 24), h = Math.max(80, r.height - 24);
    const fit = Math.min(w / bw, h / bh);
    let scale = fit * Math.min(window.devicePixelRatio || 1, 3) * zoom.res;
    const maxPixels = 16e6; // iPad Safari refuses canvases larger than about 16.7 million pixels
    if (bw * bh * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (bw * bh));
    const vp = page.getViewport({ scale, offsetX: -crop.x0 * base.width * scale, offsetY: -crop.y0 * base.height * scale });
    const canvas = document.createElement("canvas");
    canvas.crop = crop;
    canvas.width = Math.floor(bw * scale);
    canvas.height = Math.floor(bh * scale);
    canvas.style.width = `${Math.floor(bw * fit)}px`;
    canvas.style.height = `${Math.floor(bh * fit)}px`;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Page ${n}`);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    return canvas;
  })();
  job.catch(() => state.cache.delete(key));
  state.cache.set(key, job);
  return job;
}

function dropCache(shouldDrop) {
  for (const [key, job] of state.cache) {
    if (!shouldDrop(key)) continue;
    state.cache.delete(key);
    job.then((c) => { if (!c.isConnected) { c.width = 0; c.height = 0; } }, () => {});
  }
}

// What is on screen: [{ page, canvas, unit, y0, y1 }] (the part of each page that shows, as fractions of its height)
let shown = [];
const showing = (page, y = 0.5) => shown.find((e) => e.page === page && y >= e.y0 - 1e-6 && y <= e.y1 + 1e-6) || null;
const cropOf = (canvas) => (canvas && canvas.crop) || FULL;
// a page fraction (across or down) as a fraction of what the canvas shows
const shownX = (canvas, x) => { const k = cropOf(canvas); return (x - k.x0) / (k.x1 - k.x0); };
const shownY = (canvas, y) => { const k = cropOf(canvas); return (y - k.y0) / (k.y1 - k.y0); };
// the place on screen of a measure box, if that part of its page shows
const entryFor = (box) => {
  if (!box) return null;
  for (const e of shown) {
    if (e.page !== box.page) continue;
    const y = shownY(e.canvas, (box.y0 + box.y1) / 2);
    if (y >= e.y0 - 1e-6 && y <= e.y1 + 1e-6) return e;
  }
  return null;
};

// A page with its Pencil markings on top
function pageUnit(n, canvas) {
  const unit = document.createElement("div");
  unit.className = "page";
  unit.dataset.page = String(n);
  unit.style.width = canvas.style.width;
  unit.style.height = canvas.style.height;
  unit.append(canvas);
  const layer = marks.layer(n, parseFloat(canvas.style.width), parseFloat(canvas.style.height), cropOf(canvas));
  if (layer) unit.append(layer);
  return unit;
}

// Where to split a page for half-page turns: the empty gap between lines of music nearest the middle
const splits = new Map();
function splitOf(n, canvas) {
  const key = `${n}|${state.layout}`;
  if (splits.has(key)) return splits.get(key);
  let best = 0.5;
  try {
    const w = 160, h = Math.round((canvas.height / canvas.width) * w);
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    const ctx = small.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const blank = (y) => { let ink = 0; for (let x = 0; x < w; x++) if (px[(y * w + x) * 4] < 170) ink++; return ink <= 1; };
    let bestDist = Infinity;
    for (let y = Math.round(h * 0.3), run = -1; y <= Math.round(h * 0.7); y++) {
      if (blank(y)) { if (run < 0) run = y; continue; }
      if (run >= 0 && y - run >= 2) {
        const mid = (run + y) / 2 / h;
        if (Math.abs(mid - 0.5) < bestDist) { bestDist = Math.abs(mid - 0.5); best = mid; }
      }
      run = -1;
    }
  } catch {}
  splits.set(key, best);
  return best;
}

let showToken = 0;
// opts.half: show the top half of the next page over the bottom half of this one
async function show(n, opts = {}) {
  if (!state.pdf) return;
  const before = state.page;
  state.page = Math.max(1, Math.min(state.count, n));
  const newPage = state.page !== before;
  const two = isTwoUp();
  view.half = !!opts.half && !two && state.page < state.count;
  updateCounter();
  const token = ++showToken;
  const first = two ? spreadStart(state.page) : state.page;
  const pages = two ? [first, first + 1].filter((p) => p <= state.count) : view.half ? [state.page, state.page + 1] : [state.page];
  let canvases;
  try {
    canvases = await Promise.all(pages.map((p) => render(p)));
  } catch {
    if (token === showToken) setStatus(`Page ${state.page} couldn't be drawn.`, "error");
    return;
  }
  if (token !== showToken) return;
  const units = pages.map((p, i) => pageUnit(p, canvases[i]));
  if (view.half) {
    // the next page's top half above this page's bottom half
    const [mine, next] = units;
    const h = parseFloat(canvases[0].style.height), h2 = parseFloat(canvases[1].style.height);
    const fMine = splitOf(pages[0], canvases[0]), fNext = splitOf(pages[1], canvases[1]);
    const top = document.createElement("div"), bottom = document.createElement("div");
    top.className = bottom.className = "half";
    top.style.height = `${fNext * h2}px`;
    bottom.style.height = `${(1 - fMine) * h}px`;
    top.style.width = bottom.style.width = canvases[0].style.width;
    top.append(next);
    bottom.append(mine);
    mine.style.marginTop = `${-fMine * h}px`;
    const stack = document.createElement("div");
    stack.className = "half-stack";
    stack.append(top, bottom);
    sheet.replaceChildren(stack, overlay, marker);
    shown = [{ page: pages[1], canvas: canvases[1], unit: next, y0: 0, y1: fNext }, { page: pages[0], canvas: canvases[0], unit: mine, y0: fMine, y1: 1 }];
  } else {
    sheet.replaceChildren(...units, overlay, marker);
    shown = pages.map((p, i) => ({ page: p, canvas: canvases[i], unit: units[i], y0: 0, y1: 1 }));
  }
  sheet.classList.toggle("two-up", two);
  sheet.classList.toggle("dark-pages", !!view.darkPages);
  // zoomed in: a new page shows from its top
  if (zoom.z > 1.01) { if (newPage) zoom.y = Infinity; clampZoom(); applyZoom(); }
  drawOverlay();
  setStatus(null);
  // Keep the pages around ready so a turn is instant
  const around = two ? [first - 2, first - 1, first + 2, first + 3] : [state.page - 1, state.page + 1, state.page + 2];
  const near = around.filter((p) => p >= 1 && p <= state.count);
  const keep = new Set([...pages, ...near].map((p) => `${p}|${state.layout}`));
  dropCache((key) => !keep.has(key));
  near.forEach((p) => render(p).catch(() => {}));
}

// A turn by the pianist: pedal, tap, swipe or the arrow buttons
function turn(step) {
  if (!state.pdf) return;
  const two = isTwoUp();
  // half-page turns: forward goes to the half view first, then to the next page; back undoes that
  if (view.halfTurns && !two) {
    if (step > 0 && !view.half && state.page < state.count) { show(state.page, { half: true }); return; }
    if (step < 0 && view.half) { show(state.page); return; }
  }
  const from = two ? spreadStart(state.page) : state.page;
  const target = from + step * (two ? 2 : 1);
  if (target < 1) { if (!setlistStep(-1)) toast("First page"); return; }
  if (target > state.count) { if (!setlistStep(1)) toast("Last page"); return; }
  show(target);
  if (mode !== "idle") turnLog.push({ page: target, time: lastFrameTime, how: "pianist" });
  if (mode === "teach" && teach) {
    teach.turns.push({ frame: Math.max(0, teach.frames.length - 1), page: target });
    updateModebar();
  } else if (mode === "follow" && follower) {
    follower.pianistTurned(target);
  }
}

function updateCounter() {
  const two = isTwoUp(), first = spreadStart(state.page);
  pageNum.value = !state.pdf ? "– / –" : two && first < state.count ? `${first}–${first + 1} / ${state.count}` : `${state.page}${view.half ? "½" : ""} / ${state.count}`;
  $("prevBtn").disabled = !state.pdf || (state.page <= 1 && !view.half && !setlist);
  $("nextBtn").disabled = !state.pdf || ((two ? first + 1 : state.page) >= state.count && !setlist);
}

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const key = layoutKey();
    if (key === state.layout) return;
    state.layout = key;
    show(state.page, { half: view.half });
  }, 150);
}).observe(stand);
state.layout = layoutKey();

/* ---------- Messages ---------- */
function setStatus(text, kind) {
  const el = $("status");
  el.hidden = !text;
  el.dataset.kind = kind || "";
  $("statusText").textContent = text || "";
}
let toastTimer = 0;
function toast(text, ms = 1400) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- Teach and Follow ---------- */
const mic = new Microphone(onFrame);
let micStarting = null;
function startMic() {
  if (mic.running && !micStarting) return Promise.resolve();
  if (!micStarting) micStarting = mic.start().finally(() => { micStarting = null; });
  return micStarting;
}
function releaseMic() {
  if (!micCheck && mode === "idle" && mic.running) mic.stop();
}

async function startTeach() {
  if (!state.pdf || mode !== "idle") return;
  const ready = startMic(); // must begin inside the tap
  stopNoteCheck(); // it would slow the listening down
  stopHear();
  mode = "teach";
  teach = { frames: [], turns: [], startPage: state.page }; // a section starts wherever the pianist is
  updateButtons();
  updateModebar();
  try {
    await ready;
  } catch (err) {
    stopMode();
    showMicProblem(err);
  }
}

function finishTeach() {
  const t = teach;
  mode = "idle";
  teach = null;
  releaseMic();
  updateButtons();
  updateModebar();
  if (!t) return;
  let section;
  try {
    section = makeLesson(t.frames, t.turns, { startPage: t.startPage, taughtAt: Date.now() });
  } catch {
    toast("No music was heard, so nothing was learned. Check the microphone and try again.", 4000);
    return;
  }
  delete section.source;
  const before = sectionsOf(state.lesson).length;
  state.lesson = addSection(state.lesson, section);
  const replaced = before + 1 - sectionsOf(state.lesson).length;
  updateLessonInfo();
  updateButtons();
  toast(`Learned this section: ${clock(section.length / FRAME_RATE)} of music, ${plural(section.turns.length, "page turn")}` +
    (replaced ? `. It replaces ${replaced === 1 ? "an older section" : `${replaced} older sections`} of the same music.` : ""), 3500);
  keepData();
  saveLesson(state.key, state.lesson).catch(() => toast("Couldn't save what was learned on this iPad.", 3000));
}

// Practicing one hand: the reference is the sheet music's notes for that hand only (built once per piece and hand)
let hands = "both"; // "both", "left" or "right"
const handCache = new Map(); // `${key}|${hand}` -> lesson
// The sheet music as it was added (parts chosen, pages placed), from a section
function scoreOf(sec) {
  let score = keepParts(readScore(sec.scoreFile), sec.options && sec.options.parts);
  const o = sec.options || {};
  if (o.pageStarts && o.pageStarts.length) score = withPageStarts(score, o.pageStarts, o.firstPage || 1);
  else score = shiftPages(score, o.firstPage || 1);
  return score;
}
function handLesson(hand) {
  const sec = scoreSectionOf();
  if (!sec || hand === "both" || !sec.scoreFile) return state.lesson;
  const key = `${state.key}|${hand}`;
  if (handCache.has(key)) return handCache.get(key);
  const score = keepHand(scoreOf(sec), hand);
  if (!score.measures.some((m) => m.notes.length)) throw new Error(`the sheet music has no ${hand}-hand notes`);
  const hs = scoreSection(score);
  for (const k of ["layout", "measures", "pages", "name", "order", "scoreFile", "options", "partList", "barInfo"]) hs[k] = sec[k];
  hs.hand = hand;
  const lesson = { version: 2, sections: [hs] };
  handCache.set(key, lesson);
  return lesson;
}
async function setHands(hand) {
  if (mode !== "idle") return;
  hands = hand;
  updateButtons();
  if (hand === "both") { toast("Both hands", 1200); return; }
  setStatus(`Learning the ${hand} hand…`);
  await breathe();
  try {
    handLesson(hand);
    setStatus(null);
    toast(`${hand === "left" ? "Left" : "Right"} hand only: Follow listens for it, and Hear the music plays it`, 3000);
  } catch (err) {
    setStatus(null);
    hands = "both";
    toast(`Couldn't: ${err.message || err}`, 3000);
  }
  updateButtons();
}
for (const b of $("handsChoice").querySelectorAll("button")) b.addEventListener("click", () => setHands(b.dataset.hand));

async function startFollow() {
  if (!state.lesson || mode !== "idle") return;
  const ready = startMic();
  stopNoteCheck(); // it would slow the listening down
  stopHear();
  let lesson = state.lesson;
  try { lesson = handLesson(hands); } catch { hands = "both"; }
  mode = "follow";
  // Start from the page on screen: the pianist may begin anywhere, and the page is a hint where
  follower = new Follower(lesson, {
    page: state.page,
    settings: followSettings(),
    onTurn: (page, why) => {
      show(page);
      turnLog.push({ page, time: lastFrameTime, how: why === "jump" ? "jump" : "auto" });
      flashMode(why === "jump" ? `Found you on page ${page}` : `Turned to page ${page}`);
    },
  });
  const sec = scoreSectionOf();
  practice = null;
  if (sec && follower.lesson.order) {
    practice = new PracticeLog(follower.lesson, Array.from(follower.lesson.order), barInfoOf(sec), (f, j) => follower.cost(f, j));
    if (loop) practice.setLoop(...playedRange(loop));
  }
  loopState = { endReached: false, quiet: 0, reps: 0, last: null };
  ladder.seen = 0;
  sessionHands = hands;
  startRecording();
  updateButtons();
  updateModebar();
  try {
    await ready;
  } catch (err) {
    stopMode();
    showMicProblem(err);
  }
}

function stopMode(quiet = false) {
  if (mode === "teach") teach = null;
  if (mode === "replay") { stopReplay(); return; }
  if (mode === "follow") keepRecording();
  if (mode === "follow" && !quiet && practice && practice.n > 10 * FRAME_RATE) finishPractice();
  practice = null;
  mode = "idle";
  follower = null;
  marker.hidden = true;
  smoother.reset();
  releaseMic();
  updateButtons();
  updateModebar();
}

// For automated tests and troubleshooting: the audio clock, and every page turn with its time
let lastFrameTime = 0;
const turnLog = [];
window.pageTurner = {
  get audioTime() { return lastFrameTime; },
  get mode() { return mode; },
  get page() { return state.page; },
  turns: turnLog,
  // the measure boxes on the page on screen (page fractions), for tests
  layoutOnPage: () => { const sec = scoreSectionOf(); return sec && sec.layout ? sec.layout.filter((b) => b && b.page === state.page) : []; },
  get view() { return { ...view, twoUp: isTwoUp(), shown: shown.map((e) => e.page) }; },
  get locked() { return locked; },
  showTour: () => showTour(),
  get settings() { return { ...settings }; },
  set noteCheckLimit(s) { noteCheckLimit = s; },
  get notecheck() { return lastReport && lastReport.notecheck ? { checked: lastReport.notecheck.checked, missed: lastReport.notecheck.missed, wrong: lastReport.notecheck.wrong } : null; },
  get setlist() { return setlist ? { name: setlist.list.name, index: setlist.index, count: setlist.list.items.length } : null; },
  marks: () => marks.data(),
  get key() { return state.key; },
  get hands() { return hands; },
  get hearing() { return hear ? { played: hearPlayed(), speed: hear.speed } : null; },
  get loop() { return loop ? { ...loop } : null; },
  get zoom() { return { ...zoom }; },
  get replaying() { return replay ? { title: replay.R.title || "Last session", duration: replay.R.duration } : null; },
};

function onFrame(frame) {
  lastFrameTime = frame.time;
  const heard = hearing.update(frame);
  if (!$("helpPanel").hidden && $("micCheck").open) drawEar(heard); // no need to redraw the note display while it's hidden
  if (mode === "teach" && teach) {
    teach.frames.push({ chroma: frame.chroma, onset: frame.onset, sounding: frame.sounding });
    if (teach.frames.length % 25 === 0) updateModebar();
  } else if (mode === "follow" && follower) {
    const st = follower.push(frame);
    if (practice) {
      const sure = follower.status === "following" && !follower.unsure;
      practice.record(frame, sure ? follower.position : -1, follower.moves || 0);
      if (loop) loopFrame(frame, sure);
    }
    if (frame.index % 5 === 0) updateModebar(st);
    if (frame.index % 5 === 0 && !(follower.lesson.layout)) halfTurnByTime();
    if (frame.index % 2 === 0) drawMarker();
  }
}

let flash = { text: "", until: 0 };
function flashMode(text) {
  flash = { text, until: performance.now() + 1500 };
  updateModebar();
}

function updateModebar(st = follower && follower.state()) {
  modebar.hidden = mode === "idle";
  modebar.dataset.mode = mode;
  progress.hidden = mode !== "follow";
  if (mode === "teach") {
    const secs = teach ? teach.frames.length / FRAME_RATE : 0;
    modeText.textContent = `Teaching from page ${teach ? teach.startPage : state.page} · ${clock(secs)} · ${plural(teach ? teach.turns.length : 0, "page turn")} · tap Done at the end`;
  } else if (mode === "follow" && st) {
    progressFill.style.width = `${(st.progress * 100).toFixed(1)}%`;
    progress.dataset.unsure = String(st.unsure || st.status !== "following");
    let text;
    if (st.status === "waiting") text = "Following · start playing anywhere on this page";
    else if (st.status === "searching") text = "Following · listening for where you are";
    else text = st.unsure ? "Following · not sure where you are" : `Following · ${Math.round(st.progress * 100)}% through`;
    if (loop && practice && st.status === "following" && loopState.reps) text += ` · loop ${plural(loopState.reps, "time")}${loopState.last ? `, last ♩ ${Math.round(loopState.last)}` : ""}`;
    if (performance.now() < flash.until) text = `Following · ${flash.text}`;
    modeText.textContent = text;
  }
}

function updateButtons() {
  forgetBtn.hidden = !sectionsOf(state.lesson).length || mode !== "idle";
  teachBtn.textContent = mode === "teach" ? "Done teaching" : "Teach";
  teachBtn.setAttribute("aria-pressed", String(mode === "teach"));
  teachBtn.disabled = !state.pdf || mode === "follow" || mode === "replay";
  followBtn.querySelector(".lbl").textContent = mode === "follow" ? "Stop" : "Follow";
  followBtn.setAttribute("aria-pressed", String(mode === "follow"));
  // without sheet music or teaching, Follow explains what to do instead of doing nothing
  followBtn.dataset.ready = String(!!state.lesson);
  followBtn.disabled = !state.pdf || mode === "teach" || mode === "replay";
  $("teachDone").hidden = mode !== "teach";
  $("pieceTitle").textContent = state.pdf ? fileName.textContent : "ScoreAtlas";
  $("shareRecording").hidden = !lastRecording;
  scoreBtn.disabled = !state.pdf || mode !== "idle";
  applyBtn.disabled = mode !== "idle";
  const sec = scoreSectionOf();
  const placed = !!(sec && sec.layout && sec.layout.some(Boolean));
  loopBtn.querySelector(".lbl").textContent = loopPick ? "Cancel picking the loop" : loop ? "Turn the loop off" : "Loop a passage";
  $("loopHint").textContent = loopPick === 1 ? "Now tap the first bar on the music" : loopPick === 2 ? "Now tap the last bar" : loop ? `Bars ${barName(sec, loop.from)}–${barName(sec, loop.to)}` : "Tap Loop, then the first and the last bar";
  loopBtn.setAttribute("aria-pressed", String(!!loop || !!loopPick));
  loopBtn.disabled = !placed || mode === "teach" || mode === "replay";
  for (const id of ["troubleBtn", "hearBtn"]) $(id).disabled = !placed || mode === "teach" || mode === "replay";
  for (const b of $("handsChoice").querySelectorAll("button")) { b.disabled = !sec || mode !== "idle"; b.setAttribute("aria-pressed", String(b.dataset.hand === (sec ? hands : "both"))); }
  $("practiceNote").hidden = placed;
  $("practiceDot").hidden = !(loop || hands !== "both" || hear);
  $("replayBtn").hidden = !lastRecording;
  $("hearBtn").querySelector("b").textContent = hear ? "Stop the music" : "Hear the music";
  micBtn.textContent = micCheck ? "Stop" : "Check microphone";
  micBtn.setAttribute("aria-pressed", String(micCheck));
}

function updateLessonInfo() {
  const el = $("lessonInfo"), sections = sectionsOf(state.lesson);
  forgetBtn.hidden = !sections.length || mode !== "idle";
  resetForget();
  const fromScore = sections.find((s) => s.fromScore);
  const taught = sections.filter((s) => !s.fromScore);
  const parts = [];
  if (fromScore) {
    const placed = fromScore.layout ? fromScore.layout.filter(Boolean).length : 0;
    parts.push(`Sheet music: ${plural(fromScore.measures || 0, "measure")} on ${plural(fromScore.pages || 0, "page")}` +
      (placed < (fromScore.measures || 0) ? ` (${placed} found on the pages for highlighting)` : "") + ".");
  }
  if (taught.length) {
    const secs = taught.reduce((n, s) => n + s.length, 0) / FRAME_RATE;
    const turns = taught.reduce((n, s) => n + s.turns.length, 0);
    parts.push(`Taught: ${plural(taught.length, "section")}, ${clock(secs)} of music, ${plural(turns, "page turn")}.`);
  }
  if (!state.pdf) el.textContent = "";
  else el.textContent = parts.length ? parts.join(" ") : "This piece has no sheet music and hasn't been taught yet.";
  showScoreOptions(fromScore);
}

// Sheet music options: which parts the pianist plays, and the first bar of each page of their own edition
function showScoreOptions(section) {
  const can = !!(section && section.scoreFile);
  scoreOpts.hidden = !can;
  if (!can) return;
  const opts = section.options || {};
  const parts = section.partList || [];
  partsBox.hidden = parts.length < 2;
  partsList.textContent = "";
  const { mine, fragments } = suggestParts(parts);
  const kept = (i) => !opts.parts || !opts.parts.length || opts.parts.includes(i);
  const addBox = (indices, text) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = indices.join(",");
    box.checked = indices.every(kept);
    label.append(box, ` ${text}`);
    partsList.append(label);
  };
  // the piano parts first, then the others by size; Audiveris's tiny misread bits as one line
  const main = parts.map((p, i) => i).filter((i) => !fragments.includes(i))
    .sort((x, y) => Number(!!(mine && mine.includes(y))) - Number(!!(mine && mine.includes(x))) || (parts[y].notes || 0) - (parts[x].notes || 0));
  for (const i of main) {
    const p = parts[i];
    const bits = [p.staves > 1 ? `${p.staves} staves` : "", p.notes !== undefined ? plural(p.notes, "note") : ""].filter(Boolean).join(", ");
    addBox([i], `${p.name || `Part ${i + 1}`}${bits ? ` (${bits})` : ""}${mine && mine.includes(i) ? " · piano" : ""}`);
  }
  if (fragments.length) {
    const notes = fragments.reduce((n, i) => n + (parts[i].notes || 0), 0);
    addBox(fragments, `${plural(fragments.length, "small bit")} split off by mistake (${plural(notes, "note")})`);
  }
  barsInput.value = (opts.pageStarts || []).join(", ");
  $("startPageInput").value = String(opts.firstPage || 1);
}
applyBtn.addEventListener("click", () => {
  const section = sectionsOf(state.lesson).find((s) => s.fromScore);
  if (!section || !section.scoreFile) return;
  const boxes = [...partsList.querySelectorAll("input")];
  const all = boxes.flatMap((b) => b.value.split(",").map(Number));
  const chosen = boxes.filter((b) => b.checked).flatMap((b) => b.value.split(",").map(Number));
  const parts = chosen.length && chosen.length < all.length ? chosen : null;
  const pageStarts = parsePageStarts(barsInput.value);
  const firstPage = Math.max(1, parseInt($("startPageInput").value, 10) || 1);
  addScore(section.scoreFile, section.name, { parts, pageStarts, firstPage });
  backToMusic();
});

// The measure being played, highlighted on the page (when the piece has sheet music)
// The follower's position wobbles a little, so the highlight is smoothed (see engine/marker.js)
let movesSeen = 0;
function drawMarker() {
  const f = follower && follower.lesson;
  const sure = f && follower.status === "following" && !follower.unsure;
  const moves = follower ? follower.moves || 0 : 0;
  let m = -1;
  if (f && f.order) { // smoothed, in the order the measures are played
    const shown = smoother.update(sure ? f.played[follower.position] : -1, moves !== movesSeen);
    m = shown >= 0 ? f.order[shown] : -1;
  } else if (sure) m = f.measure[follower.position]; // sheet music added in Test 7
  movesSeen = moves;
  const box = m >= 0 && f.layout ? f.layout[m] : null;
  if (box) halfTurnCheck(box);
  const at = entryFor(box);
  if (!at || !settings.highlight) { marker.hidden = true; return; }
  placeOnPage(marker, box, at.canvas);
  marker.hidden = false;
}

// Half-page turns while following: once the pianist is in the bottom half of the page, show the next page's top half
function halfTurnCheck(box) {
  if (!view.halfTurns || view.half || isTwoUp() || mode !== "follow" || state.page >= state.count) return;
  const canvas = shown.length && shown[0].page === state.page ? shown[0].canvas : null;
  const split = canvas ? splitOf(state.page, canvas) : 0.5;
  if (box.page === state.page && canvas && shownY(canvas, box.y0) >= split - 0.02) show(state.page, { half: true });
}
function halfTurnByTime() {
  if (!view.halfTurns || view.half || isTwoUp() || state.page >= state.count) return;
  if (follower.status !== "following" || follower.unsure) return;
  const f = follower.lesson, j = follower.position;
  if (f.pageAt[j] !== state.page) return;
  // the stretch of the lesson on this page: halfway through it
  let a = j, z = j;
  while (a > f.startOf[j] && f.pageAt[a - 1] === state.page) a--;
  while (z < f.endOf[j] - 1 && f.pageAt[z + 1] === state.page) z++;
  if (z < f.endOf[j] - 1 && j - a > (z - a) / 2) show(state.page, { half: true });
}

/* ---------- Practice: loop a passage, and the report after a session ---------- */
const scoreSectionOf = () => sectionsOf(state.lesson).find((s) => s.fromScore) || null;
// bar numbers and lengths of the sheet music's measures (kept with the sheet music since Test 9; read again before)
function barInfoOf(sec) {
  if (!sec.barInfo && sec.scoreFile) {
    try { sec.barInfo = readScore(sec.scoreFile).measures.map((m) => ({ number: m.number, quarters: m.quarters, tempo: m.tempo })); } catch {}
  }
  return sec.barInfo || Array.from({ length: sec.measures || 0 }, (_, i) => ({ number: String(i + 1), quarters: 4 }));
}
const barName = (sec, m) => { const b = barInfoOf(sec)[m]; return b ? b.number : String(m + 1); };
// the played bars a loop over measures from..to covers (the first time through, if the passage repeats)
function playedRange(l) {
  const order = scoreSectionOf().order;
  let a = order.indexOf(l.from);
  if (a < 0) a = 0;
  let z = a;
  while (z < order.length - 1 && order[z] !== l.to) z++;
  return [a, z];
}
const playedRangeToMeasures = (l) => { const o = scoreSectionOf().order; return { from: o[l.from], to: o[l.to] }; };

// Places an element over a measure box on the page on screen
function placeOnPage(el, box, canvas) {
  const r = canvas.getBoundingClientRect(), o = sheet.getBoundingClientRect();
  const x0 = shownX(canvas, box.x0), x1 = shownX(canvas, box.x1), y0 = shownY(canvas, box.y0), y1 = shownY(canvas, box.y1);
  el.style.left = `${r.left - o.left + x0 * r.width}px`;
  el.style.top = `${r.top - o.top + y0 * r.height}px`;
  el.style.width = `${(x1 - x0) * r.width}px`;
  el.style.height = `${(y1 - y0) * r.height}px`;
}

// The loop's bars outlined, and while the report is open, each bar tinted by how often it was played
function drawOverlay() {
  overlay.textContent = "";
  const sec = scoreSectionOf();
  if (!sec || !sec.layout || !shown.length) return;
  const here = (m) => entryFor(sec.layout[m]);
  if (lastReport && heatOn && !reportPanel.hidden && historyTab === "session") {
    const most = Math.max(1, ...lastReport.plays.values());
    for (const [m, count] of lastReport.plays) {
      if (!here(m)) continue;
      const el = document.createElement("div");
      el.className = "heat-mark";
      el.style.setProperty("--heat", (0.06 + 0.3 * (count / most)).toFixed(2));
      el.dataset.count = `×${count}`;
      if (lastReport.hesitations.get(m)) el.dataset.hesitated = "";
      placeOnPage(el, sec.layout[m], here(m).canvas);
      overlay.append(el);
    }
  }
  if (lastReport && lastReport.notecheck && !reportPanel.hidden && historyTab === "session") {
    for (const [m, v] of lastReport.notecheck.byMeasure) {
      const n = v.missed + v.wrong;
      if (!n || !here(m)) continue;
      const el = document.createElement("div");
      el.className = "note-mark";
      el.dataset.count = `${n} ✕`;
      placeOnPage(el, sec.layout[m], here(m).canvas);
      overlay.append(el);
    }
  }
  if (loop || loopPick === 2) {
    const a = loop ? loop.from : loopFirst, z = loop ? loop.to : loopFirst;
    for (let m = a; m <= z; m++) {
      if (!here(m)) continue;
      const el = document.createElement("div");
      el.className = "loop-mark";
      placeOnPage(el, sec.layout[m], here(m).canvas);
      overlay.append(el);
    }
  }
}

loopBtn.addEventListener("click", () => {
  if (loopPick) loopPick = 0;
  else if (loop) {
    loop = null;
    if (practice) practice.setLoop(null);
    toast("Loop off", 1200);
  } else {
    loopPick = 1;
    toast("Tap the first bar of the passage to loop", 2500);
  }
  updateButtons();
  drawOverlay();
  backToMusic();
});

function pickLoopBar(x, y) {
  const sec = scoreSectionOf();
  if (!sec || !sec.layout) return;
  let m = -1;
  for (const e of shown) {
    const r = e.canvas.getBoundingClientRect(), k = cropOf(e.canvas);
    const sx = (x - r.left) / r.width, sy = (y - r.top) / r.height;
    if (sx < 0 || sx > 1 || sy < e.y0 || sy > e.y1) continue;
    const fx = k.x0 + sx * (k.x1 - k.x0), fy = k.y0 + sy * (k.y1 - k.y0); // on the whole page
    m = sec.layout.findIndex((b) => b && b.page === e.page && fx >= b.x0 && fx <= b.x1 && fy >= b.y0 && fy <= b.y1);
    if (m >= 0) break;
  }
  if (m < 0) { toast("Tap inside a bar (turn pages with the arrows or the pedal)", 2200); return; }
  if (loopPick === 1) {
    loopFirst = m;
    loopPick = 2;
    toast(`From bar ${barName(sec, m)}. Now tap the last bar (turn the page first if it's on the next one)`, 3000);
  } else {
    loop = { from: Math.min(loopFirst, m), to: Math.max(loopFirst, m) };
    loopPick = 0;
    if (practice) practice.setLoop(...playedRange(loop));
    loopState.reps = 0;
    loopState.last = null;
    toast(`Looping bars ${barName(sec, loop.from)}–${barName(sec, loop.to)}. Play it as often as you like; Follow counts each time`, 3500);
  }
  updateButtons();
  drawOverlay();
}

// While looping: count repetitions, and when the pianist stops after the loop's last bar, show its first page again
let loopState = { endReached: false, quiet: 0, reps: 0, last: null };
function loopFrame(frame, sure) {
  const [a, z] = playedRange(loop);
  const f = follower.lesson;
  if (sure) {
    const p = f.played[follower.position];
    if (p === z) loopState.endReached = true;
    else if (p >= a && p < z) loopState.endReached = false;
  }
  loopState.quiet = frame.sounding ? 0 : loopState.quiet + 1;
  if (loopState.endReached && loopState.quiet === Math.round(0.6 * FRAME_RATE)) {
    loopState.endReached = false;
    const sec = scoreSectionOf(), box = sec.layout && sec.layout[loop.from];
    const page = box ? box.page : null;
    if (page && !showing(page, box.y0)) { show(page); follower.pianistTurned(page); }
  }
  if (frame.index % FRAME_RATE === 0) {
    const live = practice.report({ refine: false });
    ladderCheck(live);
    const reps = live.loopReps;
    loopState.reps = reps.length;
    loopState.last = reps.length ? reps[reps.length - 1].tempo : null;
  }
}

// After a session: work out the report, keep a summary of it on the iPad, and show it
function finishPractice() {
  const sec = scoreSectionOf();
  let r;
  try { r = practice.report(); } catch (err) { console.warn("practice report failed", err); return; }
  if (!r.bars.length) return;
  const date = Date.now();
  lastReport = { ...r, sec, log: practice, hand: sessionHands, date, key: state.key };
  const key = state.key;
  const summary = {
    date, hand: sessionHands, seconds: Math.round(r.seconds), plays: [...r.plays], hesitations: [...r.hesitations],
    tempo: r.longest ? r.longest.map((b) => [b.measure, b.tempo ? Math.round(b.tempo) : null]) : [],
    loop: r.loop ? playedRangeToMeasures(r.loop) : null, loopReps: r.loopReps.map((x) => Math.round(x.tempo)),
  };
  loadLesson(`${key}|practice`).then((old) => {
    const sessions = [...((old && old.sessions) || []), summary].slice(-50);
    return saveLesson(`${key}|practice`, { sessions });
  }).catch(() => {});
  renderReport();
  setReport(true);
}

function setReport(open) {
  if (open) { closePanels("report"); setHistoryTab("session"); }
  reportPanel.hidden = !open;
  drawOverlay();
  updateButtons();
}
// Practice history: the last session's report, kept takes and the journal, as tabs of one panel
function setHistoryTab(tab) {
  historyTab = tab;
  for (const b of $("historyTabs").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  for (const d of reportPanel.querySelectorAll(".history-tab")) d.hidden = d.dataset.tab !== tab;
  $("historyPiece").textContent = state.pdf ? fileName.textContent : "This piece";
  $("replayBtn").hidden = tab !== "session" || !lastRecording || !(lastReport && lastRecording.log === lastReport.log);
  if (tab === "session") {
    if (lastReport) renderReport();
    else {
      $("reportBody").replaceChildren(el("p", "note", "No session yet. Tap Follow, play, and tap Stop: the report of your session shows here (bars you practiced most, where you hesitated, your tempo, and Check my notes)."));
    }
    $("heatWrap").hidden = !lastReport;
  } else if (tab === "takes") showTakes();
  else showJournal();
  drawOverlay();
}
function openHistory(tab) {
  closePanels("report");
  reportPanel.hidden = false;
  setHistoryTab(tab || (lastReport ? "session" : "journal"));
  updateButtons();
}
for (const b of $("historyTabs").querySelectorAll("button")) b.addEventListener("click", () => setHistoryTab(b.dataset.tab));
$("historyBtn").addEventListener("click", () => openHistory());

function renderReport() {
  const r = lastReport;
  if (!r) return;
  const sec = r.sec;
  const name = (m) => barName(sec, m);
  const pageOf = (m) => (sec.layout && sec.layout[m] ? sec.layout[m].page : null);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const goTo = (m, text) => {
    const b = el("button", "bar-link", text);
    b.type = "button";
    const page = pageOf(m);
    if (!page) b.disabled = true;
    b.addEventListener("click", () => { if (page && mode === "idle") { show(page); flashBar(m); } });
    return b;
  };
  // listen to that moment of the session (when this report's session was recorded)
  const listen = (t0) => {
    const b = el("button", "listen-btn", "▶");
    b.type = "button";
    b.setAttribute("aria-label", "Listen to this moment");
    b.hidden = !(lastRecording && lastRecording.log === r.log && t0 !== null && t0 !== undefined);
    b.addEventListener("click", () => replayFromClock(t0));
    return b;
  };
  const firstTime = (m, hesitation) => { const b = r.bars.find((x) => x.measure === m && x.t0 !== null && (!hesitation || x.hesitation)); return b ? b.t0 : null; };
  const body = $("reportBody");
  body.textContent = "";
  const played = new Set(r.bars.map((b) => b.measure)).size;
  const hesCount = [...r.hesitations.values()].reduce((x, y) => x + y, 0);
  body.append(el("p", "report-sum", `${clock(r.seconds)} of practice · ${plural(played, "bar")} played${hesCount ? ` · ${plural(hesCount, "hesitation")}` : ""}`));

  const busy = busiestPassages(r.plays, barInfoOf(sec).length);
  if (busy.length) {
    body.append(el("h3", null, "Practiced most"));
    const list = el("ul", "report-list");
    for (const b of busy) {
      const li = el("li");
      li.append(goTo(b.from, b.from === b.to ? `Bar ${name(b.from)}` : `Bars ${name(b.from)}–${name(b.to)}`), el("span", null, ` ${b.count} times`), listen(firstTime(b.from)));
      list.append(li);
    }
    body.append(list);
  }
  const words = { slow: "slowed down", paused: "paused", "went back": "stopped and went back" };
  if (r.hesitations.size) {
    body.append(el("h3", null, "Where you hesitated"));
    const list = el("ul", "report-list");
    const top = [...r.hesitations].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 6);
    for (const [m, count] of top) {
      const why = {};
      for (const b of r.bars) if (b.measure === m && b.hesitation) why[b.hesitation] = (why[b.hesitation] || 0) + 1;
      const main = Object.entries(why).sort((x, y) => y[1] - x[1])[0];
      const li = el("li");
      li.append(goTo(m, `Bar ${name(m)}`), el("span", null, ` ${count > 1 ? `${count} times, ` : ""}${main ? words[main[0]] : ""}`), listen(firstTime(m, true)));
      list.append(li);
    }
    body.append(list);
  }
  // wrong-note detection: listen to the session's recording for missed and wrong notes
  if (lastRecording && lastRecording.log === r.log) {
    const kb = el("button", "btn small", lastRecording.kept ? "Take kept ✓" : "Keep this take");
    kb.type = "button";
    kb.id = "keepTakeBtn";
    kb.disabled = !!lastRecording.kept;
    kb.addEventListener("click", () => keepTake());
    const row = el("div", "actions");
    row.append(kb);
    body.append(row);
  }
  const canCheck = lastRecording && lastRecording.log === r.log && sec.scoreFile;
  if (canCheck || r.notecheck) {
    body.append(el("h3", null, "Notes"));
    if (!r.notecheck) {
      const b = el("button", "btn small primary", "Check my notes");
      b.type = "button";
      b.id = "checkNotesBtn";
      b.addEventListener("click", () => checkMyNotes());
      body.append(b, el("p", "note", "Listens to the recording of this session for missed and wrong notes. Takes a little while; the iPad works it out on its own."));
    } else {
      const nc = r.notecheck;
      body.append(el("p", "report-sum", nc.missed + nc.wrong
        ? `${plural(nc.checked, "note")} checked: ${nc.missed} missed${nc.wrong ? `, ${nc.wrong} wrong` : ""}`
        : `${plural(nc.checked, "note")} checked: all there. Well played!`));
      const worst = [...nc.byMeasure].filter(([, v]) => v.missed + v.wrong).sort((a, b) => (b[1].missed + b[1].wrong) - (a[1].missed + a[1].wrong) || a[0] - b[0]).slice(0, 8);
      if (worst.length) {
        const list = el("ul", "report-list");
        for (const [m] of worst) {
          const here = nc.notes.filter((x) => x.measure === m && (x.status === "missed" || x.status === "wrong"));
          const missed = [...new Set(here.filter((x) => x.status === "missed").map((x) => noteName(x.midi)))];
          const wrong = [...new Set(here.filter((x) => x.status === "wrong").map((x) => `${noteName(x.instead)} for ${noteName(x.midi)}`))];
          const what = [missed.length ? `missed ${missed.join(", ")}` : "", wrong.length ? `played ${wrong.join(", ")}` : ""].filter(Boolean).join(" · ");
          const li = el("li");
          li.className = "notes-item";
          const skip = el("button", "skip-btn", "Not in my music");
          skip.type = "button";
          skip.title = "The sheet music reader may have added these notes: don't check them again";
          skip.addEventListener("click", () => ignoreNotes(r, here.filter((x) => x.status === "missed").length ? here.filter((x) => x.status === "missed") : here));
          li.append(goTo(m, `Bar ${name(m)}`), el("span", "notes-what", what), listen(here[0] ? here[0].tc : null), skip);
          list.append(li);
        }
        body.append(list);
        body.append(el("p", "note", "Bars with mistakes are marked in red on the music while this report is open. If a note is flagged every time though you play it, the sheet music reader probably misread it: tap Not in my music."));
      }
    }
  }
  if (r.loop && r.loopReps.length) {
    const lm = playedRangeToMeasures(r.loop);
    body.append(el("h3", null, `Loop, bars ${name(lm.from)}–${name(lm.to)}: ${plural(r.loopReps.length, "time")}`));
    body.append(el("p", "report-loop", r.loopReps.map((x, i) => `${i + 1}: ♩ ${Math.round(x.tempo)}`).join(" · ")));
  }
  const run = r.longest && r.longest.filter((b) => b.tempo);
  if (run && run.length >= 4) {
    body.append(el("h3", null, `Tempo in your longest run (${plural(r.longest.length, "bar")}, from bar ${name(r.longest[0].measure)} to bar ${name(r.longest[r.longest.length - 1].measure)})`));
    body.append(tempoChart(run, sec));
  }
  if (!busy.length && !r.hesitations.size && !(run && run.length >= 4)) body.append(el("p", "note", "Play a little longer for more to show here."));
}

// Tempo bar by bar for one run: a line, hesitations marked, the marked tempo as a dashed line; tap for values
function tempoChart(run, sec) {
  const NS = "http://www.w3.org/2000/svg";
  const wrap = document.createElement("div");
  wrap.className = "tempo-chart";
  const W = 340, H = 150, L = 34, R = 8, T = 12, B = 22;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  const info = barInfoOf(sec);
  const marked = (info.find((b) => b.tempo > 0) || {}).tempo || 0;
  const vals = run.map((b) => b.tempo);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (marked) { lo = Math.min(lo, marked); hi = Math.max(hi, marked); }
  const step = hi - lo > 120 ? 40 : 20;
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const x = (i) => L + (run.length === 1 ? 0 : (i * (W - L - R)) / (run.length - 1));
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  svg.setAttribute("aria-label", `Tempo by bar, from ${Math.round(Math.min(...vals))} to ${Math.round(Math.max(...vals))} quarter notes a minute`);
  for (let v = lo; v <= hi + 1e-6; v += step) {
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
    add("text", { x: L - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" }, String(v));
  }
  const every = Math.max(1, Math.ceil(run.length / 7));
  run.forEach((b, i) => { if (i % every === 0 || i === run.length - 1) add("text", { x: x(i), y: H - 6, class: "axis", "text-anchor": "middle" }, barName(sec, b.measure)); });
  if (marked) {
    add("line", { x1: L, x2: W - R, y1: y(marked), y2: y(marked), class: "marked" });
    add("text", { x: W - R, y: y(marked) - 4, class: "axis", "text-anchor": "end" }, `marked ${marked}`);
  }
  add("path", { d: run.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.tempo).toFixed(1)}`).join(""), class: "tempo-line" });
  run.forEach((b, i) => { if (b.hesitation) add("circle", { cx: x(i), cy: y(b.tempo), r: 4, class: "tempo-dot" }); });
  const cross = add("line", { x1: 0, x2: 0, y1: T, y2: H - B, class: "cross", visibility: "hidden" });
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  const words = { slow: "slowed down", paused: "paused", "went back": "stopped" };
  const showAt = (clientX) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(run.length - 1, Math.round(((vx - L) / (W - L - R)) * (run.length - 1))));
    const b = run[i];
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    tip.textContent = `Bar ${barName(sec, b.measure)} · ♩ ${Math.round(b.tempo)}${b.hesitation ? ` · ${words[b.hesitation]}` : ""}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - 10, Math.max(10, (x(i) / W) * r.width))}px`;
  };
  svg.addEventListener("pointermove", (e) => showAt(e.clientX));
  svg.addEventListener("pointerdown", (e) => showAt(e.clientX));
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  wrap.append(svg, tip);
  // the same numbers as a table, for reading out
  const details = document.createElement("details");
  details.innerHTML = "<summary>As a table</summary>";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Bar</th><th>♩ a minute</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  for (const b of run) {
    const tr = document.createElement("tr");
    for (const v of [barName(sec, b.measure), Math.round(b.tempo), b.hesitation ? words[b.hesitation] : ""]) { const td = document.createElement("td"); td.textContent = v; tr.append(td); }
    tb.append(tr);
  }
  table.append(tb);
  details.append(table);
  wrap.append(details);
  return wrap;
}

// Briefly highlight a bar (from the report), once its page is on screen
function flashBar(m, tries = 0) {
  const sec = scoreSectionOf();
  const box = sec && sec.layout && sec.layout[m];
  if (!box) return;
  const at = entryFor(box);
  if (!at || !at.canvas.isConnected) { if (tries < 20) setTimeout(() => flashBar(m, tries + 1), 150); return; }
  const el = document.createElement("div");
  el.className = "flash-mark";
  placeOnPage(el, box, at.canvas);
  overlay.append(el);
  setTimeout(() => el.remove(), 1600);
}
$("reportClose").addEventListener("click", () => { setReport(false); backToMusic(); });

// Panels can be dragged by their title to anywhere on the screen (so they don't hide the music); the place is kept
function makeMovable(panel, handle, key) {
  const place = (x, y) => {
    const w = panel.offsetWidth, h = panel.offsetHeight;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - Math.min(h, 120) - 8, y));
    Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
    return { x, y };
  };
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const at = place(e.clientX - drag.dx, e.clientY - drag.dy);
    try { localStorage.setItem(key, JSON.stringify(at)); } catch {}
  });
  const end = () => { drag = null; };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  // back where it was left (kept on screen if the iPad was turned since)
  const restore = () => {
    let at = null;
    try { at = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    if (at && !panel.hidden) place(at.x, at.y);
  };
  new ResizeObserver(restore).observe(panel);
  window.addEventListener("resize", restore);
}
makeMovable(reportPanel, reportPanel.querySelector(".report-head"), "pt-report-place");
makeMovable(card, card.querySelector(".panel-head"), "pt-card-place");
$("heatToggle").addEventListener("change", (e) => { heatOn = e.target.checked; drawOverlay(); });

/* ---------- Record and replay: listen back to the last session with the highlight and pages following ---------- */
const replayBar = $("replayBar"), rpPlay = $("rpPlay"), rpSeek = $("rpSeek"), rpTime = $("rpTime");
let recorder = null; // while following
let sessionStart = { turns: 0, page: 1 };
let lastRecording = null; // { samples, rate, startTime, duration, log, sec, turns, firstPage }
let replay = null; // { ctx, buf, src, playing, offset, t0, raf }

function startRecording() {
  recorder = new Recorder();
  mic.onSamples = (block, rate, time) => { if (recorder) recorder.push(block, rate, time); };
  sessionStart = { turns: turnLog.length, page: state.page };
}

function keepRecording() {
  mic.onSamples = null;
  if (recorder && recorder.duration > 5) {
    lastRecording = {
      samples: recorder.samples(), rate: recorder.rate, startTime: recorder.startTime, duration: recorder.duration,
      log: practice, sec: practice ? scoreSectionOf() : null, turns: turnLog.slice(sessionStart.turns), firstPage: sessionStart.page,
    };
  }
  recorder = null;
}

// Play the last session from `at` seconds into it
function startReplay(at = 0, R = lastRecording) {
  if (!R || (mode !== "idle" && mode !== "replay")) return;
  if (replay && replay.R !== R) stopReplay();
  if (!replay) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buf = ctx.createBuffer(1, R.samples.length, R.rate);
    buf.getChannelData(0).set(R.samples);
    replay = { ctx, buf, src: null, playing: false, offset: 0, t0: 0, raf: 0, lastM: -1, lastSeen: -1, R };
  }
  mode = "replay";
  replayBar.hidden = false;
  rpSeek.max = String(R.duration);
  $("rpKeep").hidden = R !== lastRecording || !!R.kept;
  $("rpTitle").textContent = R.title || "Last session";
  updateButtons();
  playFrom(at);
}

function replayNow() {
  const r = replay;
  return r.playing ? r.offset + (r.ctx.currentTime - r.t0) : r.offset;
}

function stopSource() {
  const r = replay;
  if (r && r.src) { r.src.onended = null; try { r.src.stop(); } catch {} r.src.disconnect(); r.src = null; }
}

function playFrom(at) {
  const r = replay, R = replay.R;
  stopSource();
  at = Math.max(0, Math.min(R.duration - 0.05, at));
  const src = r.ctx.createBufferSource();
  src.buffer = r.buf;
  src.connect(r.ctx.destination);
  r.ctx.resume().catch(() => {});
  src.start(0, at);
  Object.assign(r, { src, t0: r.ctx.currentTime, offset: at, playing: true, lastM: -1 });
  src.onended = () => { if (r.src === src) { r.playing = false; r.offset = R.duration; drawReplay(); } };
  tickReplay();
}

function pauseReplay() {
  const r = replay;
  if (!r) return;
  if (r.playing) { r.offset = replayNow(); stopSource(); r.playing = false; drawReplay(); }
  else playFrom(r.offset >= r.R.duration - 0.1 ? 0 : r.offset);
}

function tickReplay() {
  const r = replay;
  if (!r) return;
  cancelAnimationFrame(r.raf);
  drawReplay();
  if (r.playing) r.raf = requestAnimationFrame(tickReplay);
}

// The bar being played at this moment of the recording (from where the follower was), and the page showing
function drawReplay() {
  const r = replay;
  if (!r) return;
  const R = r.R;
  const t = replayNow(), at = R.startTime + t;
  let m = -1;
  const log = R.log, sec = R.sec;
  if (R.track && sec && sec.layout) {
    // a kept take: the bar at each tenth of a second, worked out when it was kept
    const k = Math.min(R.track.length - 1, Math.max(0, Math.floor(t * 10)));
    m = R.track[k] >= 0 && sec.layout[R.track[k]] ? R.track[k] : -1;
  } else if (log && sec && sec.layout && log.n) {
    // the last frame at or before this moment, then back over a moment the follower wasn't sure (up to 1.5 s)
    let lo = 0, hi = log.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (log.time[mid] <= at) lo = mid; else hi = mid - 1; }
    for (let i = lo; i >= 0 && i > lo - 75; i--) if (log.pos[i] >= 0) { m = log.lesson.measure[log.pos[i]]; break; }
  }
  let page = R.firstPage;
  for (const turn of R.turns) if (turn.time <= at) page = turn.page;
  if (m >= 0 && sec.layout[m]) page = sec.layout[m].page;
  if (!showing(page, 0.5) && !(page === state.page)) show(page);
  const box = m >= 0 && sec.layout[m];
  const where = box ? entryFor(box) : null;
  if (where) { placeOnPage(marker, box, where.canvas); marker.hidden = false; } else marker.hidden = true;
  rpSeek.value = String(t);
  rpTime.textContent = `${clock(t)} / ${clock(R.duration)}`;
  rpPlay.textContent = r.playing ? "Pause" : "Play";
  rpPlay.setAttribute("aria-pressed", String(r.playing));
}

function stopReplay() {
  if (!replay) return;
  stopSource();
  cancelAnimationFrame(replay.raf);
  replay.ctx.close().catch(() => {});
  replay = null;
  replayBar.hidden = true;
  marker.hidden = true;
  mode = "idle";
  updateButtons();
}

rpPlay.addEventListener("click", () => { pauseReplay(); backToMusic(); });
$("rpBack").addEventListener("click", () => { if (replay) { const t = replayNow() - 5; replay.playing ? playFrom(t) : ((replay.offset = Math.max(0, t)), drawReplay()); } });
$("rpFwd").addEventListener("click", () => { if (replay) { const t = replayNow() + 5; replay.playing ? playFrom(t) : ((replay.offset = Math.min(replay.R.duration, t)), drawReplay()); } });
rpSeek.addEventListener("input", () => {
  if (!replay) return;
  const t = Number(rpSeek.value);
  if (replay.playing) playFrom(t);
  else { replay.offset = t; drawReplay(); }
});
$("rpClose").addEventListener("click", () => { stopReplay(); backToMusic(); });
$("replayBtn").addEventListener("click", () => startReplay(0));
// play from a moment (engine clock) of the last session, a second early
function replayFromClock(t) {
  if (!lastRecording) return;
  startReplay(Math.max(0, t - lastRecording.startTime - 1));
}

/* ---------- Kept takes: recordings saved with the piece, to listen to later (auditions, lessons, progress) ---------- */
// Kept as 16,000 samples a second, 16-bit (about 2 MB a minute), with the bar being played every tenth of a second
// (from where the follower was), so a take plays back with the highlight and the pages following.
function barTrack(R) {
  const n = Math.ceil(R.duration * 10), track = new Int16Array(n).fill(-1);
  const log = R.log;
  if (!log || !log.n) return track;
  let i = 0;
  for (let k = 0; k < n; k++) {
    const at = R.startTime + k / 10;
    while (i + 1 < log.n && log.time[i + 1] <= at) i++;
    for (let j = i; j >= 0 && j > i - 75; j--) if (log.pos[j] >= 0) { track[k] = log.lesson.measure[log.pos[j]]; break; }
  }
  return track;
}
const takeKey = (key, id) => `${key}|take|${id}`;
async function keepTake() {
  const R = lastRecording, key = state.key;
  if (!R || !key || R.kept) return;
  const samples = new Int16Array(R.samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-32768, Math.min(32767, Math.round(R.samples[i] * 32767)));
  const id = Date.now();
  const when = new Date(id).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const take = { id, name: `Take, ${when}`, date: id, rate: R.rate, duration: R.duration, startTime: R.startTime, samples, track: barTrack(R), turns: R.turns, firstPage: R.firstPage, hand: sessionHands };
  try {
    await saveLesson(takeKey(key, id), take);
    const list = ((await loadLesson(`${key}|takes`)) || {}).list || [];
    list.push({ id, name: take.name, date: id, duration: R.duration });
    await saveLesson(`${key}|takes`, { list });
    R.kept = true;
    $("rpKeep").hidden = true;
    renderReport();
    toast(`Kept: ${clock(R.duration)} (Practice → Kept takes)`, 2600);
  } catch {
    toast("Couldn't keep the take: the iPad may be out of space.", 3500);
  }
}
async function showTakes() {
  const body = $("takesBody");
  body.textContent = "";
  const key = state.key;
  const list = key ? ((await loadLesson(`${key}|takes`)) || {}).list || [] : [];
  if (!list.length) {
    body.append(el("p", "note", "No takes kept for this piece yet. After practicing with Follow, tap Keep this take in the practice report (or while listening back)."));
    return;
  }
  const total = list.reduce((n, t) => n + t.duration, 0);
  body.append(el("p", "note", `${plural(list.length, "take")}, ${clock(total)} in all (about ${Math.max(1, Math.round((total * 32) / 1024))} MB on this iPad).`));
  const ul = el("ul", "takes-list");
  for (const t of [...list].sort((a, b) => b.date - a.date)) {
    const li = el("li");
    const info = el("div", "take-info");
    info.append(el("b", null, t.name), el("span", null, `${clock(t.duration)} · ${new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`));
    const acts = el("div", "lib-actions");
    const btn = (text, cls, fn, label) => { const b = el("button", `btn small ${cls}`, text); b.type = "button"; if (label) b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b; };
    acts.append(
      btn("Play", "primary", () => playTake(t.id), `Play ${t.name}`),
      btn("Share", "", () => shareTake(t.id)),
      btn("Rename", "", async () => {
        const name = window.prompt("Name for this take:", t.name);
        if (!name || !name.trim()) return;
        t.name = name.trim();
        await saveLesson(`${key}|takes`, { list });
        const full = await loadLesson(takeKey(key, t.id));
        if (full) { full.name = t.name; await saveLesson(takeKey(key, t.id), full); }
        showTakes();
      }),
      btn("Delete", "quiet", async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Delete"; }, 3000); return; }
        await forgetLesson(takeKey(key, t.id)).catch(() => {});
        await saveLesson(`${key}|takes`, { list: list.filter((x) => x !== t) });
        showTakes();
      }),
    );
    li.append(info, acts);
    ul.append(li);
  }
  body.append(ul);
}
async function loadTake(id) {
  const t = await loadLesson(takeKey(state.key, id));
  if (!t) { toast("That take isn't on this iPad any more", 2500); return null; }
  const samples = new Float32Array(t.samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] = t.samples[i] / 32768;
  return { ...t, samples, sec: scoreSectionOf(), title: t.name, kept: true };
}
async function playTake(id) {
  if (mode !== "idle" && mode !== "replay") { toast("Stop following first", 1800); return; }
  const R = await loadTake(id);
  if (!R) return;
  closePanels();
  if (replay) stopReplay();
  startReplay(0, R);
}
async function shareTake(id) {
  const R = await loadTake(id);
  if (!R) return;
  await shareFile(wavFile(R.samples, R.rate), `${fileName.textContent} - ${R.name.replace(/[\\/:*?"<>|]+/g, " ")}.wav`, "audio/wav");
}
$("rpKeep").addEventListener("click", () => keepTake());

const breathe = () => new Promise((r) => setTimeout(r, 30)); // let the screen update between long steps

// A page of the PDF as a gray image, about 130 dots per inch, for finding the measures
async function pageImage(n) {
  const page = await state.pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 1100 / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[4 * i] * 0.3 + rgba[4 * i + 1] * 0.59 + rgba[4 * i + 2] * 0.11) | 0;
  const out = { gray, w: canvas.width, h: canvas.height };
  canvas.width = canvas.height = 0;
  return out;
}

// Add the piece's sheet music (MusicXML from Audiveris, or from anywhere): read it, find its measures on the PDF's
// pages, and learn how it sounds, so Follow works without teaching. Options: parts = the parts the pianist plays
// (the others are left out of what the app listens for); pageStarts = the first bar of each page from page 2, for
// sheet music whose pages don't match the PDF (the measures are then found on the PDF by counting barlines).
async function addScore(bytes, name, options = {}) {
  if (!state.pdf || mode !== "idle") return;
  scoreBtn.disabled = applyBtn.disabled = true;
  try {
    setStatus("Reading the sheet music…");
    await breathe();
    const full = readScore(bytes);
    // new sheet music: start with the piano part(s) only, when there clearly are some
    if (options.parts === undefined) options = { ...options, parts: suggestParts(full.parts).mine };
    let score = keepParts(full, options.parts);
    const byBars = !!(options.pageStarts && options.pageStarts.length);
    const firstPage = Math.max(1, Math.min(state.count, Math.round(options.firstPage || 1)));
    if (byBars) score = withPageStarts(score, options.pageStarts, firstPage);
    else score = shiftPages(score, firstPage);
    if (!score.measures.some((m) => m.notes.length)) throw new Error("the parts you chose have no notes.");
    const counts = byBars ? {} : systemCounts(score);
    // (the file's own page numbers, moved to where the music starts in the PDF)
    const layout = new Array(score.measures.length).fill(null);
    for (let page = 1; page <= Math.min(score.pages, state.count); page++) {
      const here = score.measures.map((m, i) => (m.page === page ? i : -1)).filter((i) => i >= 0);
      if (!here.length) continue;
      setStatus(`Finding the measures on page ${page} of ${score.pages}…`);
      await breathe();
      const img = await pageImage(page);
      let boxes = counts[page] ? findMeasures(img.gray, img.w, img.h, counts[page]) : null;
      if (!boxes) boxes = findMeasuresByCount(img.gray, img.w, img.h, here.length);
      if (!boxes) continue;
      here.forEach((mi, k) => { if (boxes[k]) layout[mi] = { page, x0: boxes[k].x0, y0: boxes[k].y0, x1: boxes[k].x1, y1: boxes[k].y1 }; });
    }
    setStatus("Learning how the music sounds…");
    await breathe();
    const section = scoreSection(score);
    Object.assign(section, {
      layout, measures: score.measures.length, pages: score.pages, name,
      order: Int16Array.from(playOrder(score)), // played-order index -> measure, for the highlight
      scoreFile: bytes, options: { parts: options.parts || null, pageStarts: byBars ? options.pageStarts : [], firstPage },
      partList: full.parts.map((p) => ({ name: p.name, staves: p.staves, notes: p.notes })),
      barInfo: score.measures.map((m) => ({ number: m.number, quarters: m.quarters, tempo: m.tempo })),
    });
    // replace any earlier sheet music; taught sections stay (they're used where they fit better)
    state.lesson = { version: 2, sections: [section, ...sectionsOf(state.lesson).filter((s) => !s.fromScore)] };
    setStatus(null);
    updateLessonInfo();
    updateButtons();
    let note = "";
    if (score.pages > state.count || (firstPage === 1 && score.pages !== state.count)) {
      note = byBars
        ? ` Note: your bar numbers give ${plural(score.pages, "page")}, the PDF has ${plural(state.count, "page")}.`
        : ` Note: the sheet music has ${plural(score.pages, "page")}, the PDF ${plural(state.count, "page")}. If pages turn at the wrong places, type the first bar of each page under Sheet music options.`;
    }
    if (!options.quiet) toast(`Sheet music ready: ${plural(score.measures.length, "measure")}. Tap Follow and play.${note}`, note ? 8000 : 4500);
    keepData();
    saveLesson(state.key, state.lesson).catch(() => toast("Couldn't save the sheet music on this iPad.", 3000));
  } catch (err) {
    setStatus(`Couldn't use ${name}: ${err.message || err}`, "error");
  } finally {
    updateButtons();
  }
}
scoreBtn.addEventListener("click", () => scoreInput.click());
scoreInput.addEventListener("change", () => {
  const file = scoreInput.files && scoreInput.files[0];
  scoreInput.value = "";
  backToMusic();
  if (!file) return;
  file.arrayBuffer().then((buf) => addScore(new Uint8Array(buf), file.name),
    () => setStatus(`Couldn't read ${file.name}. If it's in iCloud, download it to the iPad first.`, "error"));
});

// Forget everything this piece learned (asks for a second tap first)
let forgetTimer = 0;
function resetForget() {
  clearTimeout(forgetTimer);
  forgetBtn.textContent = "Forget";
  forgetBtn.dataset.armed = "";
}
forgetBtn.addEventListener("click", () => {
  if (!forgetBtn.dataset.armed) {
    forgetBtn.textContent = "Tap again to forget";
    forgetBtn.dataset.armed = "1";
    forgetTimer = setTimeout(resetForget, 4000);
    return;
  }
  const key = state.key;
  state.lesson = null;
  forgetLesson(key).catch(() => {});
  updateLessonInfo();
  updateButtons();
  toast("Forgot everything this piece learned. Tap Teach to start again.", 3000);
});

teachBtn.addEventListener("click", () => {
  if (mode === "teach") finishTeach();
  else { stopHear(); startTeach(); setCard(false); }
  backToMusic();
});
$("teachDone").addEventListener("click", () => { if (mode === "teach") finishTeach(); backToMusic(); });
followBtn.addEventListener("click", () => {
  if (!state.lesson && mode === "idle") {
    setCard(true);
    toast("To follow this piece, add its sheet music or teach it (under Piece)", 3200);
    return;
  }
  if (hear) stopHear();
  if (mode === "follow") stopMode();
  else startFollow();
  backToMusic();
});

/* ---------- Library and setlists ---------- */
const library = new LibraryUI($("library"), {
  onOpen: (key) => { setlist = null; showSetlistChip(); openFromLibrary(key); },
  onAdd: () => fileInput.click(),
  onShare: async (sl) => {
    toast("Packing the setlist…", 1500);
    try {
      const { bytes, pieces } = await makeBackup({ keys: sl.items, setlist: { ...sl } });
      const res = await shareFile(bytes, `${sl.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Setlist"}.scoreatlas`, "application/zip");
      if (res !== "cancelled") toast(`"${sl.name}" with ${plural(pieces, "piece")}: open it on the other iPad with Library → Add music`, 3600);
    } catch (err) { toast(`Couldn't share the setlist: ${err.message || err}`, 3000); }
  },
  onPlay: (list, index) => playSetlist(list, index),
});

// A small picture of page 1, for the library
async function thumbnailOf() {
  try {
    const page = await state.pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 160 / base.width });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const url = c.toDataURL("image/jpeg", 0.7);
    c.width = c.height = 0;
    return url;
  } catch { return null; }
}

// Keep the PDF just opened in the library
async function rememberPiece(name, bytes) {
  const key = state.key;
  if (!key) return;
  const old = await loadMeta(key);
  const meta = {
    key, name: old ? old.name : name.replace(/\.pdf$/i, ""), pages: state.count,
    added: old ? old.added : Date.now(), opened: Date.now(), thumb: (old && old.thumb) || (await thumbnailOf()),
  };
  savePiece(key, name, bytes, meta).catch(() => toast("Couldn't keep this PDF in the library (the iPad may be out of space).", 3500));
}

async function openFromLibrary(key) {
  const piece = await loadPiece(key);
  if (!piece) { toast("That piece isn't on this iPad any more.", 2500); return false; }
  const ok = await openPdf(piece.bytes.slice(), piece.name);
  if (ok) {
    saveLastFile(piece.name, piece.bytes).catch(() => {});
    const meta = await loadMeta(key);
    if (meta) {
      meta.opened = Date.now();
      putMeta(meta).catch(() => {});
      fileName.textContent = meta.name;
    }
  }
  return ok;
}

async function playSetlist(list, index) {
  setlist = { list, index };
  const ok = await openFromLibrary(list.items[index]);
  if (!ok) setlist = null;
  showSetlistChip();
}

// The pedal at the end (or start) of a piece in a setlist goes on to the next (or previous) piece. If Follow was on,
// it carries on with the next piece. Returns false when not playing a setlist.
function setlistStep(dir) {
  if (!setlist) return false;
  const i = setlist.index + dir;
  if (i < 0) { toast("First piece of the setlist"); return true; }
  if (i >= setlist.list.items.length) { toast("End of the setlist"); return true; }
  const wasFollowing = mode === "follow";
  setlist.index = i;
  openFromLibrary(setlist.list.items[i]).then((ok) => {
    showSetlistChip();
    if (!ok) return;
    if (dir < 0) show(state.count);
    toast(`${setlist.index + 1} of ${setlist.list.items.length}: ${fileName.textContent}`, 2000);
    if (wasFollowing && state.lesson) startFollow();
  });
  return true;
}

function showSetlistChip() {
  const chip = $("setlistChip");
  chip.hidden = !setlist;
  document.body.classList.toggle("in-setlist", !!setlist);
  if (setlist) {
    $("setlistText").textContent = `${setlist.list.name} · ${setlist.index + 1}/${setlist.list.items.length}`;
    const next = setlist.list.items[setlist.index + 1];
    chip.title = next ? `Next: ${library.name(next)}` : "Last piece";
  }
  updateCounter();
}
$("setlistEnd").addEventListener("click", () => { setlist = null; showSetlistChip(); toast("Setlist ended", 1200); backToMusic(); });

/* ---------- Pencil markings: the Mark toolbar ---------- */
marks.attach(sheet);
const markBar = $("markBar"), markBtn = $("markBtn");
function setMarkMode(on) {
  marks.markMode = on;
  markBar.hidden = !on;
  document.body.classList.toggle("marking", on);
  markBtn.setAttribute("aria-pressed", String(on));
  if (on) { closePanels(); toast("Marking: write with the Pencil or a finger. Tap Done when finished.", 2500); }
  else if (!$("noteInput").hidden) closeNoteInput();
}
markBtn.addEventListener("click", () => { setMarkMode(!marks.markMode); backToMusic(); });
// The Mark toolbar: a row of tools, and below it the chosen tool's options (colors, fingers, stamps) with a size slider
const pen = { color: INKS.black, size: 1 };
try { Object.assign(pen, JSON.parse(localStorage.getItem("pt-pen") || "{}")); } catch {}
const savePen = () => { try { localStorage.setItem("pt-pen", JSON.stringify({ color: pen.color, size: pen.size, hl: marks.hlColor, tool: marks.tool.kind, stamp: marks.stamp })); } catch {} };
function pickTool(kind) {
  marks.tool = { kind, color: pen.color };
  for (const b of markBar.querySelectorAll("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === kind));
  $("inkRow").hidden = !["pen", "text", "stamp", "finger"].includes(kind);
  $("hlRow").hidden = kind !== "highlight";
  $("digitRow").hidden = kind !== "finger";
  $("stampRow").hidden = kind !== "stamp";
  $("sizeWrap").hidden = kind === "erase";
  $("markHint").hidden = kind !== "erase";
  drawPenChoice();
  savePen();
}
function drawPenChoice() {
  for (const b of $("inkRow").querySelectorAll("[data-color]")) b.setAttribute("aria-pressed", String(b.dataset.color === pen.color));
  const custom = !Object.values(INKS).includes(pen.color);
  $("inkCustom").style.background = custom ? pen.color : "";
  $("inkRow").querySelector(".wheel").setAttribute("aria-pressed", String(custom));
  for (const b of $("hlRow").querySelectorAll("[data-hl]")) b.setAttribute("aria-pressed", String(b.dataset.hl === marks.hlColor));
  const hlCustom = ![...$("hlRow").querySelectorAll("[data-hl]")].some((b) => b.dataset.hl === marks.hlColor);
  $("hlCustom").style.background = hlCustom ? marks.hlColor : "";
  $("hlRow").querySelector(".wheel").setAttribute("aria-pressed", String(hlCustom));
  // the size dot shows the line as it will be drawn
  const dot = $("sizeDot"), hl = marks.tool.kind === "highlight";
  const px = hl ? Math.max(6, 16 * pen.size) : marks.tool.kind === "pen" ? Math.max(2, 4 * pen.size) : Math.max(8, 12 * Math.sqrt(pen.size));
  dot.style.width = dot.style.height = `${Math.min(30, px)}px`;
  dot.style.background = hl ? marks.hlColor : pen.color;
  $("sizeSlider").value = String(pen.size);
  for (const b of $("stampRow").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.stamp === marks.stamp));
}
function setInk(color) {
  pen.color = color;
  marks.tool = { ...marks.tool, color };
  drawPenChoice();
  savePen();
}
for (const b of markBar.querySelectorAll("[data-tool]")) b.addEventListener("click", () => pickTool(b.dataset.tool));
for (const b of $("inkRow").querySelectorAll("[data-color]")) b.addEventListener("click", () => setInk(b.dataset.color));
$("inkPicker").addEventListener("input", (e) => setInk(e.target.value));
for (const b of $("hlRow").querySelectorAll("[data-hl]")) b.addEventListener("click", () => { marks.hlColor = b.dataset.hl; drawPenChoice(); savePen(); });
$("hlPicker").addEventListener("input", (e) => { marks.hlColor = e.target.value; drawPenChoice(); savePen(); });
$("sizeSlider").addEventListener("input", (e) => { pen.size = Number(e.target.value); marks.size = pen.size; drawPenChoice(); savePen(); });
for (const b of $("digitRow").querySelectorAll("button")) b.addEventListener("click", () => {
  marks.digit = b.textContent;
  for (const x of $("digitRow").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
});
// the stamps, each drawn as it will look on the music
for (const [k, label] of STAMPS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "stamp-btn";
  b.dataset.stamp = k;
  b.setAttribute("aria-label", label);
  b.title = label;
  const c = document.createElement("canvas");
  c.width = 92; c.height = 48;
  b.append(c);
  b.addEventListener("click", () => { marks.stamp = k; drawPenChoice(); savePen(); });
  $("stampRow").append(b);
}
function drawStampButtons() {
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1d1b18";
  for (const b of $("stampRow").querySelectorAll("button")) {
    const c = b.querySelector("canvas"), ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    drawStamp(ctx, b.dataset.stamp, c.width / 2, c.height / 2, b.dataset.stamp.length > 4 ? 13 : 16, ink);
  }
}
drawStampButtons();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawStampButtons);
$("markUndo").addEventListener("click", () => { if (!marks.undo()) toast("Nothing to undo", 1000); });
// text notes: type the words where the page was tapped
let notePlace = null;
marks.onText = (page, x, y, cx, cy) => {
  notePlace = { page, x, y };
  const box = $("noteInput"), r = stand.getBoundingClientRect();
  box.hidden = false;
  box.style.left = `${Math.max(8, Math.min(r.width - 268, cx - r.left))}px`;
  box.style.top = `${Math.max(8, Math.min(r.height - 120, cy - r.top))}px`;
  $("noteText").value = "";
  $("noteText").focus();
};
function closeNoteInput() { $("noteInput").hidden = true; notePlace = null; backToMusic(); }
$("noteOk").addEventListener("click", () => { if (notePlace) marks.addNote(notePlace.page, notePlace.x, notePlace.y, $("noteText").value); closeNoteInput(); });
$("noteCancel").addEventListener("click", closeNoteInput);
$("noteText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("noteOk").click(); } e.stopPropagation(); });
for (const ev of ["pointerdown", "pointerup", "click"]) $("noteInput").addEventListener(ev, (e) => e.stopPropagation());
marks.size = pen.size;
try { const saved = JSON.parse(localStorage.getItem("pt-pen") || "{}"); if (saved.hl) marks.hlColor = saved.hl; if (saved.stamp) marks.stamp = saved.stamp; } catch {}
$("markClear").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Clear page"; }, 3000); return; }
  b.dataset.armed = "";
  b.textContent = "Clear page";
  const pages = shown.map((x) => x.page);
  let any = false;
  for (const pg of pages) any = marks.clearPage(pg) || any;
  toast(any ? "Cleared (Undo brings it back)" : "No markings here", 1500);
});
$("markDone").addEventListener("click", () => { setMarkMode(false); backToMusic(); });
try { pickTool(JSON.parse(localStorage.getItem("pt-pen") || "{}").tool || "pen"); } catch { pickTool("pen"); }

/* ---------- The Practice menu ---------- */
const practiceMenu = $("practiceMenu");
$("practiceBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = practiceMenu.hidden;
  closePanels();
  practiceMenu.hidden = !open;
  $("practiceBtn").setAttribute("aria-expanded", String(open));
  updateButtons();
});
document.addEventListener("pointerdown", (e) => {
  if (!practiceMenu.hidden && !practiceMenu.contains(e.target) && !$("practiceBtn").contains(e.target)) { practiceMenu.hidden = true; $("practiceBtn").setAttribute("aria-expanded", "false"); }
});
// the menu's buttons do their thing and close it
for (const id of ["loopBtn", "troubleBtn", "hearBtn", "openMetro", "historyBtn"]) {
  $(id).addEventListener("click", () => { practiceMenu.hidden = true; $("practiceBtn").setAttribute("aria-expanded", "false"); });
}

/* ---------- View: two pages, half-page turns, and the performance lock ---------- */
const viewMenu = $("viewMenu");
$("viewBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = viewMenu.hidden;
  closePanels();
  viewMenu.hidden = !open;
  $("viewBtn").setAttribute("aria-expanded", String(!viewMenu.hidden));
  $("twoUpToggle").checked = view.twoUp;
  $("halfToggle").checked = view.halfTurns;
});
document.addEventListener("pointerdown", (e) => {
  if (!viewMenu.hidden && !viewMenu.contains(e.target) && !$("viewBtn").contains(e.target)) { viewMenu.hidden = true; $("viewBtn").setAttribute("aria-expanded", "false"); }
});
$("twoUpToggle").addEventListener("change", (e) => {
  view.twoUp = e.target.checked;
  saveView();
  state.layout = layoutKey();
  if (view.twoUp && !isTwoUp()) toast("Two pages show when the iPad is sideways", 2200);
  show(state.page);
});
$("halfToggle").addEventListener("change", (e) => {
  view.halfTurns = e.target.checked;
  saveView();
  if (!view.halfTurns && view.half) show(state.page);
  if (view.halfTurns && isTwoUp()) toast("Half-page turns work when one page shows", 2200);
});

function setLocked(on) {
  locked = on;
  document.body.classList.toggle("locked", on);
  $("unlockBtn").hidden = !on;
  if (on) {
    viewMenu.hidden = true;
    setCard(false);
    library.close();
    setMarkMode(false);
    if (!reportPanel.hidden) setReport(false);
    toast("Locked: only the pedal turns pages. Hold the lock button to unlock.", 2600);
  } else toast("Unlocked", 1000);
  backToMusic();
}
$("lockBtn").addEventListener("click", () => setLocked(true));
{
  // unlocking takes a press of about a second, so a stray touch can't do it
  const btn = $("unlockBtn");
  let timer = 0;
  const cancel = () => { clearTimeout(timer); btn.classList.remove("holding"); };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.classList.add("holding");
    timer = setTimeout(() => { cancel(); setLocked(false); }, 900);
  });
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointercancel", cancel);
  btn.addEventListener("pointerleave", cancel);
}

/* ---------- Settings and Help ---------- */
function openPanel(id) {
  closePanels(id);
  $(id).hidden = false;
  if (id === "settingsPanel") showSettings();
}
for (const b of document.querySelectorAll(".panel-close")) b.addEventListener("click", () => { b.closest(".panel").hidden = true; backToMusic(); });
$("openSettings").addEventListener("click", () => openPanel("settingsPanel"));
$("openHelp").addEventListener("click", () => openPanel("helpPanel"));
$("cardSettings").addEventListener("click", () => openPanel("settingsPanel"));
$("cardHelp").addEventListener("click", () => openPanel("helpPanel"));
makeMovable($("settingsPanel"), $("settingsPanel").querySelector(".panel-head"), "pt-settings-place");
makeMovable($("helpPanel"), $("helpPanel").querySelector(".panel-head"), "pt-help-place");

const shiftText = (v) => (Math.abs(v) < 0.01 ? "as now" : `${Math.abs(v)} s ${v > 0 ? "earlier" : "later"}`);
function showSettings() {
  $("turnShift").value = String(settings.turnShift);
  $("turnShiftText").textContent = shiftText(settings.turnShift);
  $("setTap").checked = settings.tapTurns;
  $("setHighlight").checked = settings.highlight;
  $("setAwake").checked = settings.awake;
  for (const b of $("themeChoice").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.theme === settings.theme));
}
$("turnShift").addEventListener("input", (e) => {
  settings.turnShift = Number(e.target.value);
  $("turnShiftText").textContent = shiftText(settings.turnShift);
  saveSettings();
  if (mode === "follow") toast("Takes effect the next time you tap Follow", 1800);
});
$("setTap").addEventListener("change", (e) => { settings.tapTurns = e.target.checked; saveSettings(); });
$("setHighlight").addEventListener("change", (e) => { settings.highlight = e.target.checked; saveSettings(); if (!settings.highlight) marker.hidden = true; });
$("setAwake").addEventListener("change", (e) => {
  settings.awake = e.target.checked;
  saveSettings();
  if (settings.awake || NATIVE) keepAwake();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
});
for (const b of $("themeChoice").querySelectorAll("button")) b.addEventListener("click", () => {
  settings.theme = b.dataset.theme;
  saveSettings();
  applyTheme();
  showSettings();
});

/* ---------- The welcome tour (first launch, and from Settings or Help) ---------- */
const tourSteps = [...document.querySelectorAll(".tour-step")];
let tourAt = 0;
function drawTour() {
  tourSteps.forEach((s, i) => { s.hidden = i !== tourAt; });
  $("tourDots").innerHTML = tourSteps.map((_, i) => `<i class="${i === tourAt ? "on" : ""}"></i>`).join("");
  $("tourBack").hidden = tourAt === 0;
  $("tourNext").textContent = tourAt === tourSteps.length - 1 ? "Get started" : "Next";
  $("tourSkip").hidden = tourAt === tourSteps.length - 1;
}
function showTour() {
  closePanels();
  tourAt = 0;
  drawTour();
  $("tour").hidden = false;
  $("tourNext").focus();
}
function endTour() {
  $("tour").hidden = true;
  try { localStorage.setItem("pt-welcomed", "1"); } catch {}
  backToMusic();
}
$("tourNext").addEventListener("click", () => { if (tourAt < tourSteps.length - 1) { tourAt++; drawTour(); } else endTour(); });
$("tourBack").addEventListener("click", () => { if (tourAt > 0) { tourAt--; drawTour(); } });
$("tourSkip").addEventListener("click", endTour);
$("tourAgain").addEventListener("click", showTour);
$("helpTour").addEventListener("click", showTour);
// first launch (automated tests skip it)
try { if (!localStorage.getItem("pt-welcomed") && !navigator.webdriver) setTimeout(showTour, 400); } catch {}

/* ---------- Go to a page, a bar or a bookmark (tap the page number) ---------- */
const gotoMenu = $("gotoMenu");
let bookmarks = [];
const bookmarksKey = () => `${state.key}|bookmarks`;
async function openGoto() {
  if (!state.pdf) return;
  closePanels();
  $("gotoPage").placeholder = `1–${state.count}`;
  $("gotoPage").value = "";
  $("gotoBar").value = "";
  const sec = scoreSectionOf();
  const bars = !!(sec && sec.layout);
  $("gotoBarForm").hidden = !bars;
  $("gotoBarNote").hidden = bars;
  if (bars) { const info = barInfoOf(sec); $("gotoBar").placeholder = `${info[0] ? info[0].number : 1}–${info.length ? info[info.length - 1].number : ""}`; }
  gotoMenu.hidden = false;
  $("gotoPage").focus({ preventScroll: true });
  bookmarks = ((await loadLesson(bookmarksKey())) || {}).list || [];
  drawBookmarks();
}
function closeGoto() { gotoMenu.hidden = true; }
pageNum.addEventListener("click", (e) => { e.stopPropagation(); gotoMenu.hidden ? openGoto() : closeGoto(); });
pageNum.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openGoto(); } });
document.addEventListener("pointerdown", (e) => { if (!gotoMenu.hidden && !gotoMenu.contains(e.target) && e.target !== pageNum) closeGoto(); });
// going somewhere by hand is like turning there: the follower takes it as a hint
function goToPage(n) {
  n = Math.max(1, Math.min(state.count, n));
  show(n);
  if (mode === "follow" && follower) follower.pianistTurned(n);
}
$("gotoPageForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = parseInt($("gotoPage").value, 10);
  if (!n) return;
  closeGoto();
  goToPage(n);
  backToMusic();
});
$("gotoBarForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const want = $("gotoBar").value.trim();
  const sec = scoreSectionOf();
  if (!want || !sec) return;
  const info = barInfoOf(sec);
  let m = info.findIndex((b) => String(b.number) === want);
  if (m < 0) m = info.findIndex((b) => parseInt(b.number, 10) >= parseInt(want, 10));
  const box = m >= 0 && sec.layout[m];
  if (!box) { toast(`Bar ${want} isn't in the sheet music`, 1800); return; }
  closeGoto();
  goToPage(box.page);
  flashBar(m);
  backToMusic();
});
function drawBookmarks() {
  const ul = $("bookmarkList");
  ul.textContent = "";
  if (!bookmarks.length) { const li = document.createElement("li"); li.className = "note"; li.textContent = "No bookmarks yet."; ul.append(li); return; }
  bookmarks.forEach((b, i) => {
    const li = document.createElement("li");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn small bm-go";
    go.textContent = `${b.name} · p. ${b.page}`;
    go.addEventListener("click", () => { closeGoto(); goToPage(b.page); backToMusic(); });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn small icon flat";
    del.setAttribute("aria-label", `Remove the bookmark ${b.name}`);
    del.textContent = "✕";
    del.addEventListener("click", async () => { bookmarks.splice(i, 1); await saveLesson(bookmarksKey(), { list: bookmarks }); drawBookmarks(); });
    li.append(go, del);
    ul.append(li);
  });
}
$("addBookmark").addEventListener("click", async () => {
  const name = window.prompt("Name this bookmark (for example Coda, or Second movement):", `Page ${state.page}`);
  if (name === null) return;
  bookmarks.push({ page: state.page, name: name.trim() || `Page ${state.page}` });
  bookmarks.sort((a, b) => a.page - b.page);
  await saveLesson(bookmarksKey(), { list: bookmarks }).catch(() => {});
  drawBookmarks();
});

/* ---------- View: trimmed margins and dark pages ---------- */
$("cropToggle").addEventListener("change", (e) => {
  view.crop = e.target.checked;
  saveView();
  state.layout = layoutKey();
  splits.clear();
  show(state.page, { half: view.half });
});
$("darkPagesToggle").addEventListener("change", (e) => {
  view.darkPages = e.target.checked;
  saveView();
  sheet.classList.toggle("dark-pages", view.darkPages);
});
$("viewBtn").addEventListener("click", () => {
  $("cropToggle").checked = !!view.crop;
  $("darkPagesToggle").checked = !!view.darkPages;
});

/* ---------- Metronome and the tempo ladder ---------- */
const metroBar = $("metroBar");
const metro = new Metronome({
  onBeat: (beat, accent, strength) => {
    const dots = $("beatRow").children, d = dots[beat];
    if (!d) return;
    d.classList.add("on");
    setTimeout(() => d.classList.remove("on"), 120);
  },
});
try { const m = JSON.parse(localStorage.getItem("pt-metro") || "{}"); for (const k of ["bpm", "beats", "unit", "subdiv"]) if (m[k]) metro[k] = m[k]; } catch {}
const saveMetro = () => { try { localStorage.setItem("pt-metro", JSON.stringify({ bpm: metro.bpm, beats: metro.beats, unit: metro.unit, subdiv: metro.subdiv })); } catch {} };
for (let n = 1; n <= 12; n++) { const o = document.createElement("option"); o.value = String(n); o.textContent = String(n); $("metroBeats").append(o); }
// the beats of a bar as dots: the first is the downbeat; in 6/8, 9/8 and 12/8 each group of three starts with a bigger one
function drawBeats() {
  const row = $("beatRow");
  row.textContent = "";
  for (let b = 0; b < metro.beats; b++) {
    const d = document.createElement("i");
    d.dataset.level = String(metro.level(b));
    row.append(d);
  }
}
const ladder = new TempoLadder();
const ladderOn = () => !metroBar.hidden && $("ladderOn").checked && !!loop;
const UNIT_SIGN = { 2: "𝅗𝅥 =", 4: "♩ =", 8: "♪ =" };
function drawMetro() {
  if (document.activeElement !== $("metroTempo")) $("metroTempo").value = String(metro.bpm);
  $("metroSlider").value = String(metro.bpm);
  $("metroName").textContent = tempoName(metro.unit === 8 ? metro.bpm / 2 : metro.unit === 2 ? metro.bpm * 2 : metro.bpm);
  $("metroUnit").textContent = UNIT_SIGN[metro.unit] || "♩ =";
  $("metroStart").textContent = metro.running ? "Stop" : "Start";
  $("metroStart").setAttribute("aria-pressed", String(metro.running));
  $("metroBeats").value = String(metro.beats);
  $("metroUnitSel").value = String(metro.unit);
  for (const b of $("subdivChoice").querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.sub) === metro.subdiv));
  if ($("beatRow").children.length !== metro.beats) drawBeats();
  $("ladderWrap").hidden = !loop;
  $("ladderOpts").hidden = !($("ladderOn").checked && loop);
}
$("openMetro").addEventListener("click", () => { closePanels(); metroBar.hidden = false; drawBeats(); drawMetro(); });
const setBpm = (v) => { metro.setTempo(v); if (ladderOn()) ladder.tempo = metro.bpm; drawMetro(); saveMetro(); };
$("metroSlower").addEventListener("click", () => setBpm(metro.bpm - 1));
$("metroFaster").addEventListener("click", () => setBpm(metro.bpm + 1));
$("metroSlider").addEventListener("input", (e) => setBpm(Number(e.target.value)));
// type the tempo: applied when done (Return, or leaving the box)
$("metroTempo").addEventListener("focus", (e) => e.target.select());
$("metroTempo").addEventListener("change", (e) => { const v = parseInt(e.target.value, 10); if (v > 0) setBpm(v); else drawMetro(); });
$("metroTempo").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); });
$("metroTap").addEventListener("click", () => { const v = metro.tap(); if (v) setBpm(v); else toast("Keep tapping the beat", 1000); });
$("metroStart").addEventListener("click", () => { metro.running ? metro.stop() : metro.start(); drawMetro(); backToMusic(); });
$("metroBeats").addEventListener("change", (e) => { metro.beats = Number(e.target.value); drawBeats(); drawMetro(); saveMetro(); });
$("metroUnitSel").addEventListener("change", (e) => { metro.unit = Number(e.target.value); drawBeats(); drawMetro(); saveMetro(); });
for (const b of $("subdivChoice").querySelectorAll("button")) b.addEventListener("click", () => { metro.subdiv = Number(b.dataset.sub); drawMetro(); saveMetro(); });
$("metroSound").addEventListener("change", (e) => {
  metro.sound = e.target.checked;
  if (metro.sound && mode === "follow") toast("The click may confuse following a little; the flashing dots never do", 2600);
});
$("ladderOn").addEventListener("change", (e) => {
  if (e.target.checked) {
    ladder.start = metro.bpm;
    ladder.step = Math.max(1, parseInt($("ladderStep").value, 10) || 4);
    ladder.goal = Math.max(ladder.start, parseInt($("ladderGoal").value, 10) || 120);
    ladder.reset(metro.bpm);
    ladder.seen = practice ? practice.report({ refine: false }).loopReps.length : 0;
    toast(`Tempo ladder: play the loop at ${metro.bpm}; each clean time goes up by ${ladder.step}`, 3200);
  }
  drawMetro();
});
$("ladderStep").addEventListener("change", (e) => { ladder.step = Math.max(1, parseInt(e.target.value, 10) || 4); });
$("ladderGoal").addEventListener("change", (e) => { ladder.goal = Math.max(20, parseInt(e.target.value, 10) || 120); });
for (const id of ["ladderStep", "ladderGoal"]) $(id).addEventListener("keydown", (e) => e.stopPropagation());
$("metroClose").addEventListener("click", () => { metro.stop(); metroBar.hidden = true; backToMusic(); });
makeMovable(metroBar, metroBar.querySelector(".metro-top"), "pt-metro-place");
// after each repetition of the loop (called from loopFrame with the live report)
function ladderCheck(r) {
  if (!ladderOn()) return;
  const hesitated = (rep) => r.bars.some((b) => b.t0 !== null && b.t0 >= rep.t0 - 0.05 && b.t0 < rep.t1 && b.hesitation);
  const perBeat = metro.unit / 4; // quarter notes a minute -> the metronome's beats a minute
  const res = ladder.update(r.loopReps.map((x) => ({ ...x, tempo: x.tempo * perBeat })), hesitated);
  if (res === "up") { metro.setTempo(ladder.tempo); drawMetro(); toast(`Clean! Next time: ${ladder.tempo}`, 2000); if (trouble) trouble.clean++; }
  else if (res === "goal") { metro.setTempo(ladder.tempo); drawMetro(); toast(trouble && trouble.next ? `Goal reached: ${ladder.tempo}. On to the next trouble spot?` : `Goal reached: ${ladder.tempo}. Well done!`, 3200); if (trouble) troubleDone(); }
  else if (res === "again") toast(`Once more at ${ladder.tempo}`, 1600);
}

/* ---------- Hear the music: the sheet music played, from the page on screen, with the bar highlight ---------- */
let hear = null; // { ctx, src, startAt, starts, k0, order, sec, speed, raf, paused }
const HEAR_MAX = 240; // seconds of music made at a time
async function startHear(fromPlayed = null) {
  const sec = scoreSectionOf();
  if (!sec || !sec.scoreFile || (mode !== "idle" && mode !== "hear")) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = hear ? hear.ctx : new Ctx(); // made inside the tap, so the iPad lets it sound
  ctx.resume().catch(() => {});
  stopHear(true);
  mode = "hear";
  updateButtons();
  setStatus("Getting the music ready…");
  await breathe();
  try {
    const order = Array.from(sec.order);
    const score = keepHand(scoreOf(sec), hands);
    const { starts, notes } = timeline(score, order);
    let k0 = fromPlayed;
    if (k0 === null) {
      // the first bar on the page showing (the first time it comes, in playing order)
      const page = shown.length ? shown[0].page : state.page;
      k0 = order.findIndex((m) => sec.layout[m] && sec.layout[m].page === page);
      if (k0 < 0) k0 = 0;
    }
    const speed = Number($("hearSpeed").value) || 1, t0 = starts[k0];
    const part = notes.filter((n) => n.played >= k0 && n.t0 - t0 < HEAR_MAX * speed).map((n) => ({ midi: n.midi, t0: (n.t0 - t0) / speed + 0.15, t1: (n.t1 - t0) / speed + 0.15 }));
    if (!part.length) throw new Error("there are no notes from here");
    const audio = synthesize(part, 22050);
    const buf = ctx.createBuffer(1, audio.length, 22050);
    buf.getChannelData(0).set(audio);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 1.6;
    src.connect(gain).connect(ctx.destination);
    const startAt = ctx.currentTime + 0.05;
    src.start(startAt);
    hear = { ctx, src, startAt, starts: Array.from(starts, (x) => (x - t0) / speed + 0.15), k0, order, sec, speed, raf: 0, paused: false };
    src.onended = () => { if (hear && hear.src === src && !hear.paused) { toast("End of the music", 1600); stopHear(); } };
    setStatus(null);
    $("hearBar").hidden = false;
    $("hearWhat").textContent = hands === "both" ? "Both hands" : hands === "left" ? "Left hand" : "Right hand";
    tickHear();
  } catch (err) {
    setStatus(null);
    toast(`Couldn't play the music: ${err.message || err}`, 3000);
    stopHear();
  }
}
function hearPlayed() {
  const h = hear, t = h.ctx.currentTime - h.startAt;
  let k = h.k0;
  while (k + 1 < h.starts.length - 1 && h.starts[k + 1] <= t) k++;
  return k;
}
function tickHear() {
  const h = hear;
  if (!h) return;
  const k = hearPlayed(), m = h.order[k], box = h.sec.layout[m];
  if (box) {
    if (!showing(box.page, (box.y0 + box.y1) / 2)) show(box.page);
    const at = entryFor(box);
    if (at) { placeOnPage(marker, box, at.canvas); marker.hidden = false; }
  }
  $("hearTime").textContent = `bar ${barName(h.sec, m)}`;
  h.raf = requestAnimationFrame(tickHear);
}
function stopHear(keepCtx = false) {
  if (!hear) return;
  cancelAnimationFrame(hear.raf);
  try { hear.src.onended = null; hear.src.stop(); } catch {}
  if (!keepCtx) hear.ctx.close().catch(() => {});
  hear = null;
  $("hearBar").hidden = true;
  marker.hidden = true;
  if (mode === "hear") mode = "idle";
  updateButtons();
}
$("hearBtn").addEventListener("click", () => { if (hear) stopHear(); else { closePanels(); startHear(); } });
$("hearClose").addEventListener("click", () => { stopHear(); backToMusic(); });
$("hearPlay").addEventListener("click", () => {
  const h = hear;
  if (!h) return;
  h.paused = !h.paused;
  if (h.paused) h.ctx.suspend(); else h.ctx.resume();
  $("hearPlay").querySelector("use").setAttribute("href", h.paused ? "#i-play" : "#i-pause");
  $("hearPlay").setAttribute("aria-label", h.paused ? "Play" : "Pause");
});
$("hearSpeed").addEventListener("input", (e) => { $("hearSpeedText").textContent = `${Math.round(Number(e.target.value) * 100)}%`; });
// a new speed starts again from the bar being played
$("hearSpeed").addEventListener("change", () => { if (hear) startHear(hearPlayed()); });

/* ---------- Trouble spots: loop the passages that keep tripping the pianist up, slower, then faster ---------- */
let trouble = null; // { spots, index, clean, next } while working through them
async function showTrouble() {
  const sec = scoreSectionOf();
  if (!sec) return;
  openPanel("troublePanel");
  const body = $("troubleBody");
  body.textContent = "";
  const data = state.key ? await loadLesson(`${state.key}|practice`) : null;
  const sessions = (data && data.sessions) || [];
  const spots = troubleSpots(sessions, sec.measures || sec.layout.length);
  if (!spots.length) {
    body.append(el("p", "report-sum", sessions.length ? "No trouble spots: nothing tripped you up in your recent sessions." : "Nothing yet."),
      el("p", "note", "Practice with Follow and tap Stop (and Check my notes, in the report). The bars where you hesitate, slow down or miss notes show up here."));
    return;
  }
  const list = el("ul", "trouble-list");
  spots.forEach((sp, i) => {
    const li = el("li");
    const go = el("button", "trouble-go");
    go.type = "button";
    go.append(el("b", null, sp.from === sp.to ? `Bar ${barName(sec, sp.from)}` : `Bars ${barName(sec, sp.from)}–${barName(sec, sp.to)}`), el("span", null, troubleText(sp)));
    go.addEventListener("click", () => practiceSpot(spots, i));
    li.append(el("span", "trouble-rank", String(i + 1)), go);
    list.append(li);
  });
  body.append(list);
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
// loop a spot with the metronome and the tempo ladder: about 70% of the pianist's usual tempo there, up to it
function practiceSpot(spots, i) {
  const sp = spots[i], sec = scoreSectionOf();
  if (!sp || !sec) return;
  closePanels();
  loop = { from: sp.from, to: sp.to };
  loopPick = 0;
  if (practice) practice.setLoop(...playedRange(loop));
  const goal = Math.round((sp.tempo || 90) * (metro.unit / 4));
  metro.setTempo(Math.max(30, Math.round(goal * 0.7)));
  $("ladderStep").value = String(Math.max(2, Math.round(goal * 0.06)));
  $("ladderGoal").value = String(goal);
  metroBar.hidden = false;
  drawBeats();
  $("ladderOn").checked = true;
  $("ladderOn").dispatchEvent(new Event("change"));
  trouble = { spots, index: i, clean: 0, next: i + 1 < spots.length ? spots[i + 1] : null };
  const box = sec.layout[sp.from];
  if (box) show(box.page);
  updateButtons();
  drawOverlay();
  toast(`Trouble spot ${i + 1}: loop ${sp.from === sp.to ? `bar ${barName(sec, sp.from)}` : `bars ${barName(sec, sp.from)}–${barName(sec, sp.to)}`} at ${metro.bpm}, then faster. Tap Follow and play.`, 4200);
}
function troubleDone() {
  const t = trouble;
  trouble = null;
  if (t && t.next) setTimeout(() => { if (mode !== "teach") practiceSpot(t.spots, t.index + 1); }, 2500);
}
$("troubleBtn").addEventListener("click", () => showTrouble());
makeMovable($("troublePanel"), $("troublePanel").querySelector(".panel-head"), "pt-trouble-place");

/* ---------- Page tools ---------- */
const pageEditor = new PageEditor($("pagesPanel"), {
  loadDoc: async (bytes) => (await loadPdfLib()).getDocument({ data: bytes, isEvalSupported: false }).promise,
  toast,
  onSave: async ({ bytes, mapping, asCopy }) => {
    const oldKey = state.key, oldName = fileName.textContent;
    const oldMeta = await loadMeta(oldKey);
    const name = asCopy ? `${oldName} (edited)` : oldName;
    const [lesson, marked, practiced, booked] = await Promise.all([loadLesson(oldKey), loadLesson(`${oldKey}|marks`), loadLesson(`${oldKey}|practice`), loadLesson(`${oldKey}|bookmarks`)]);
    const copy = bytes.slice();
    if (!(await openPdf(bytes, `${name}.pdf`))) throw new Error("the new PDF didn't open");
    const key = state.key;
    await savePiece(key, `${name}.pdf`, copy, { key, name, pages: state.count, added: oldMeta ? oldMeta.added : Date.now(), opened: Date.now(), thumb: await thumbnailOf() });
    saveLastFile(`${name}.pdf`, copy).catch(() => {});
    fileName.textContent = name;
    // markings and bookmarks move with their pages; the practice history stays with the piece
    const moved = remapMarks(marked, mapping);
    await saveLesson(`${key}|marks`, moved);
    marks.load(moved);
    if (booked && booked.list) {
      const where = (n) => mapping.findIndex((m) => m.src === 0 && m.page === n) + 1;
      await saveLesson(`${key}|bookmarks`, { list: booked.list.map((b) => ({ ...b, page: where(b.page) })).filter((b) => b.page > 0) });
    }
    if (practiced && !asCopy) await saveLesson(`${key}|practice`, practiced);
    if (!asCopy) {
      const takes = ((await loadLesson(`${oldKey}|takes`)) || {}).list || [];
      for (const t of takes) { const full = await loadLesson(`${oldKey}|take|${t.id}`); if (full) await saveLesson(`${key}|take|${t.id}`, full); }
      if (takes.length) await saveLesson(`${key}|takes`, { list: takes });
    }
    if (!asCopy) {
      const lists = await loadSetlists();
      for (const sl of lists) sl.items = sl.items.map((k) => (k === oldKey ? key : k));
      await saveSetlists(lists);
      await removePiece(oldKey);
    }
    // the sheet music is matched to the new pages again; a taught playthrough can't be (its pages changed)
    const sec = sectionsOf(lesson).find((x) => x.fromScore);
    const taught = sectionsOf(lesson).some((x) => !x.fromScore);
    if (sec && sec.scoreFile) await addScore(sec.scoreFile, sec.name || name, { ...sec.options });
    toast(`Saved: ${plural(state.count, "page")}.${taught ? " Teach it again, if you had taught it (its pages changed)." : ""}`, 4000);
  },
});
$("editPagesBtn").addEventListener("click", async () => {
  if (!state.pdf || mode !== "idle") return;
  const piece = state.key ? await loadPiece(state.key) : null;
  if (!piece) { toast("Open the piece from the Library first", 2500); return; }
  closePanels("pages");
  pageEditor.open(state.pdf, piece.bytes, fileName.textContent);
});

/* ---------- Adding music: PDFs, their sheet music and shared setlists, several at once ---------- */
async function addFiles(files) {
  const metas = await listMeta();
  const plan = pairFiles(files, metas.map((m) => m.name));
  const read = async (f) => new Uint8Array(await f.arrayBuffer());
  let added = 0, scores = 0;
  try {
    for (const b of plan.bundles) {
      const res = await restoreBackup(await read(b));
      toast(res.shared ? `Added ${typeof res.shared === "string" ? `the setlist "${res.shared}"` : "the shared music"}: ${plural(res.pieces, "piece")}` : `Restored ${plural(res.pieces, "piece")}`, 3000);
      library.refresh && library.refresh();
    }
    // sheet music for pieces already kept: open each and add it
    for (const { score, name } of plan.toLibrary) {
      const meta = metas.find((m) => m.name === name);
      if (meta && (await openFromLibrary(meta.key))) { await addScore(await read(score), score.name); scores++; }
    }
    for (const { pdf, score } of plan.pieces) {
      const data = await read(pdf), copy = data.slice();
      if (!(await openPdf(data, pdf.name))) continue;
      saveLastFile(pdf.name, copy).catch(() => {});
      await rememberPiece(pdf.name, copy);
      added++;
      if (score) { await addScore(await read(score), score.name); scores++; }
    }
    // sheet music that matched no PDF: for the piece that is open
    if (plan.loose.length && state.pdf) {
      for (const score of plan.loose.slice(0, 1)) { await addScore(await read(score), score.name); scores++; }
    }
  } catch (err) {
    setStatus(`Couldn't add the files: ${err.message || err}. If they're in iCloud, download them to the iPad first.`, "error");
    return;
  }
  if (added + scores > 1) toast(`Added ${plural(added, "piece")}${scores ? ` (${scores} with sheet music)` : ""}`, 3200);
  if (plan.other.length) toast(`Skipped ${plan.other.map((f) => f.name).join(", ")}: not a PDF, MusicXML or ScoreAtlas file`, 3500);
}

// The App Store app: a file opened with ScoreAtlas from Files, AirDrop or Mail (the app hands over where it is)
window.scoreAtlasOpen = async (url, name) => {
  try {
    const res = await fetch(window.Capacitor.convertFileSrc(url));
    const bytes = new Uint8Array(await res.arrayBuffer());
    await addFiles([new File([bytes], name)]);
    return true;
  } catch (err) {
    toast(`Couldn't open ${name}: ${err.message || err}`, 3500);
    return false;
  }
};
if (NATIVE) native({ ready: true });

/* ---------- Practice journal ---------- */
async function showJournal() {
  const sec = scoreSectionOf();
  const data = state.key ? await loadLesson(`${state.key}|practice`) : null;
  renderJournal($("journalBody"), (data && data.sessions) || [], (m) => (sec ? barName(sec, m) : String(m + 1)));
}

/* ---------- Backup and restore ---------- */
$("backupSave").addEventListener("click", async () => {
  try {
    setStatus("Making a backup…");
    const { bytes, pieces } = await makeBackup();
    setStatus(null);
    const day = new Date().toISOString().slice(0, 10);
    const how = await shareFile(bytes, `ScoreAtlas backup ${day}.scoreatlas`, "application/zip");
    if (how !== "cancelled") toast(`Backup of ${plural(pieces, "piece")} ${how === "shared" ? "ready" : "saved to Downloads"}`, 2600);
  } catch (err) {
    setStatus(null);
    toast(`Couldn't make the backup: ${err.message || err}`, 3000);
  }
});
$("backupRestore").addEventListener("click", () => $("restoreInput").click());
$("restoreInput").addEventListener("change", async () => {
  const file = $("restoreInput").files && $("restoreInput").files[0];
  $("restoreInput").value = "";
  if (!file) return;
  try {
    setStatus("Restoring…");
    const { pieces } = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
    setStatus(null);
    toast(`Restored ${plural(pieces, "piece")}. Reloading…`, 2000);
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    setStatus(null);
    toast(err.message || "Couldn't restore that file.", 3200);
  }
});

/* ---------- Wrong-note detection (after a session, from its recording) ---------- */
let noteJob = null;
let noteCheckLimit = 12 * 60; // seconds of a session checked at most (the newest)
function stopNoteCheck() {
  if (noteJob) noteJob.stop = true;
}
async function checkMyNotes() {
  const r = lastReport, R = lastRecording;
  if (!r || !R || R.log !== r.log || noteJob) return;
  const sec = r.sec;
  const job = (noteJob = { stop: false });
  const say = (text) => { if (!job.stop) setStatus(text); }; // once stopped, the status line belongs to Follow
  const btn = $("checkNotesBtn");
  if (btn) btn.disabled = true;
  try {
    // the stretches that were played (with sheet music), newest last; at most the last 12 minutes
    const runs = [];
    let cur = null;
    for (const b of r.bars) {
      if (b.t0 === null || b.t0 === undefined) continue;
      const end = b.t1 !== null && b.t1 !== undefined ? b.t1 : b.t0 + 2;
      if (cur && b.t0 - cur.z < 1.5) cur.z = Math.max(cur.z, end);
      else { cur = { a: b.t0, z: end }; runs.push(cur); }
    }
    let budget = noteCheckLimit;
    const chosen = [];
    for (let i = runs.length - 1; i >= 0 && budget > 0; i--) {
      const run = { ...runs[i] };
      run.a = Math.max(run.a, run.z - budget); // a long run: its last part
      chosen.unshift(run);
      budget -= run.z - run.a;
    }
    const total = chosen.reduce((n, x) => n + (x.z - x.a), 0);
    let done = 0;
    const { hearNotes } = await import("./pitch.js");
    const heard = [], soft = [];
    say("Getting the note listener ready…");
    for (const run of chosen) {
      const s0 = Math.max(0, Math.floor((run.a - 0.5 - R.startTime) * R.rate));
      const s1 = Math.min(R.samples.length, Math.ceil((run.z + 0.5 - R.startTime) * R.rate));
      if (s1 <= s0) continue;
      const got = await hearNotes(R.samples.subarray(s0, s1), R.rate, {
        onProgress: (p) => say(`Listening for missed and wrong notes… ${Math.round((100 * (done + p * (run.z - run.a))) / Math.max(1, total))}%`),
        stop: () => job.stop,
      });
      if (!got || job.stop) return; // stopped: Follow or Teach started
      done += run.z - run.a;
      for (const n of got.notes) heard.push({ ...n, t: n.t + s0 / R.rate + R.startTime });
      for (const n of got.soft) soft.push({ ...n, t: n.t + s0 / R.rate + R.startTime });
    }
    const score = keepHand(keepParts(readScore(sec.scoreFile), sec.options && sec.options.parts), r.hand);
    const expected = expectedNotes(r.bars.filter((b) => b.t0 !== null && b.t0 >= (chosen[0] ? chosen[0].a - 0.01 : 0)), score.measures);
    r.noteInput = { expected, heard, soft };
    const ignore = new Set(((await loadLesson(`${r.key}|ignore`)) || {}).notes || []);
    r.notecheck = checkNotes(expected, heard, undefined, soft, ignore);
    keepNoteCheck(r);
    say(null);
    renderReport();
    drawOverlay();
  } catch (err) {
    say(null);
    if (!job.stop) toast(`Couldn't check the notes: ${err.message || err}`, 3200);
    if (btn) btn.disabled = false;
  } finally {
    noteJob = null;
  }
}

// The check's results go with the session's summary, for the practice journal's "notes over time"
function keepNoteCheck(r) {
  const nc = r.notecheck;
  const notes = { checked: nc.checked, missed: nc.missed, wrong: nc.wrong, byMeasure: [...nc.byMeasure].map(([m, v]) => [m, v.missed + v.wrong, v.total]) };
  loadLesson(`${r.key}|practice`).then((old) => {
    const sessions = (old && old.sessions) || [];
    const s = sessions.find((x) => x.date === r.date);
    if (!s) return null;
    s.notes = notes;
    return saveLesson(`${r.key}|practice`, { sessions });
  }).catch(() => {});
}
// "Not in my music": the sheet music reader added notes the pianist's edition doesn't have; leave them out from now on
async function ignoreNotes(r, list) {
  const key = `${r.key}|ignore`;
  const old = ((await loadLesson(key)) || {}).notes || [];
  const set = new Set([...old, ...list.map((x) => `${x.measure}|${x.midi}`)]);
  await saveLesson(key, { notes: [...set] }).catch(() => {});
  const { expected, heard, soft } = r.noteInput;
  r.notecheck = checkNotes(expected, heard, undefined, soft, set);
  keepNoteCheck(r);
  renderReport();
  drawOverlay();
  toast(`Left out from now on: ${[...new Set(list.map((x) => noteName(x.midi)))].join(", ")} in bar ${barName(r.sec, list[0].measure)}`, 2600);
}

/* ---------- Share with a teacher ---------- */
$("shareMarked").addEventListener("click", async () => {
  if (!state.pdf) return;
  try {
    const bytes = await markedPdf(state.pdf, (ctx, n, w, h) => marks.drawPageInto(ctx, n, w, h), (n, t) => setStatus(`Making the PDF: page ${n} of ${t}…`));
    setStatus(null);
    await shareFile(bytes, `${fileName.textContent} (with markings).pdf`, "application/pdf");
  } catch (err) {
    setStatus(null);
    toast(`Couldn't make the PDF: ${err.message || err}`, 3000);
  }
});
$("shareRecording").addEventListener("click", async () => {
  if (!lastRecording) return;
  const day = new Date().toISOString().slice(0, 10);
  await shareFile(wavFile(lastRecording.samples, lastRecording.rate), `${fileName.textContent} practice ${day}.wav`, "audio/wav");
});

/* ---------- Offline: the app keeps itself on the iPad (see sw.js) ---------- */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(async () => {
    const keys = await caches.keys();
    if (keys.some((k) => k.startsWith("page-turner"))) $("offlineNote").hidden = false;
  }).catch(() => {});
}

/* ---------- Microphone check and note display ---------- */
const hearing = new Hearing();
const earKeys = $("earKeys"), earHeard = $("earHeard"), earLevel = $("earLevel"), earNote = $("earNote");
const keyBars = NOTE_NAMES.map((name, i) => {
  const col = document.createElement("div");
  col.className = BLACK_KEYS.has(i) ? "key-col black" : "key-col";
  col.innerHTML = `<div class="bar"><i></i></div><div class="name">${name}</div>`;
  earKeys.append(col);
  return { col, fill: col.querySelector("i") };
});

function drawEar(h) {
  keyBars.forEach(({ col, fill }, q) => {
    fill.style.transform = `scaleY(${Math.min(1, h.level[q]).toFixed(3)})`;
    col.classList.toggle("on", h.heard.includes(q));
  });
  earHeard.textContent = h.quiet ? "quiet" : h.heard.length ? h.heard.map((q) => NOTE_NAMES[q]).join(" · ") : "…";
  const loud = h.quiet ? 0 : Math.max(...h.level);
  earLevel.style.width = `${(loud * 100).toFixed(0)}%`;
}

function clearEar() {
  keyBars.forEach(({ col, fill }) => { fill.style.transform = "scaleY(0)"; col.classList.remove("on"); });
  earHeard.textContent = "the microphone is off";
  earLevel.style.width = "0";
}

function showMicProblem(err) {
  const name = err && err.name;
  let text = "The microphone couldn't start. Reload the page and try again.";
  if (name === "NotAllowedError" || name === "SecurityError") {
    text = "Microphone access is off for this page. In Safari, tap the aA button in the address bar, choose Website Settings, set Microphone to Allow, then reload the page.";
  } else if (name === "NotFoundError" || name === "OverconstrainedError") text = "No microphone was found on this device.";
  else if (name === "NotReadableError") text = "Another app is using the microphone. Close it, then try again.";
  else if (name === "NotSupportedError") text = "This page can't reach the microphone here. Open the app at its own web address in Safari.";
  if (NATIVE && (name === "NotAllowedError" || name === "SecurityError")) text = "Microphone access is off for ScoreAtlas. Open the iPad's Settings, tap ScoreAtlas, and turn on Microphone.";
  earNote.textContent = text;
  earNote.hidden = false;
  openPanel("helpPanel");
  $("micCheck").open = true;
  $("micCheck").scrollIntoView({ block: "nearest" });
  clearEar();
}

micBtn.addEventListener("click", async () => {
  earNote.hidden = true;
  if (micCheck) {
    micCheck = false;
    releaseMic();
    if (!mic.running) clearEar();
    updateButtons();
    return;
  }
  micCheck = true;
  updateButtons();
  try {
    await startMic();
  } catch (err) {
    micCheck = false;
    updateButtons();
    showMicProblem(err);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  if (mode !== "idle") toast(mode === "teach" ? "Teaching stopped because the app went into the background." : "Following stopped because the app went into the background.", 4000);
  micCheck = false;
  stopMode();
  if (mic.running) mic.stop();
  clearEar();
  updateButtons();
});

/* ---------- Pedal and keyboard ---------- */
const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Spacebar", "Enter"]);
const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);
const KEY_NAMES = {
  ArrowRight: "Right arrow", ArrowLeft: "Left arrow", ArrowDown: "Down arrow", ArrowUp: "Up arrow",
  PageDown: "Page Down", PageUp: "Page Up", " ": "Space", Spacebar: "Space", Enter: "Enter",
};
const seen = [];

function keyLabel(e) {
  if (KEY_NAMES[e.key]) return KEY_NAMES[e.key];
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  if (e.key && e.key !== "Unidentified") return e.key;
  return e.code || "Unknown key";
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (["Tab", "Shift", "Escape"].includes(e.key)) return;
  if (e.target instanceof Element && e.target.closest("input[type=text], textarea")) return; // typing
  const onControl = e.target instanceof Element && e.target.closest("button, input, a");
  if (onControl && (e.key === " " || e.key === "Enter")) return; // keep buttons usable from a keyboard
  e.preventDefault();
  if (e.repeat) return;
  const label = keyLabel(e);
  if (!seen.includes(label)) {
    seen.push(label);
    keysSeen.textContent = seen.join(", ");
  }
  keepAwake();
  if (NEXT.has(e.key)) turn(1);
  else if (PREV.has(e.key)) turn(-1);
});

/* ---------- Pinch to zoom (two fingers; one finger moves the page around while zoomed in) ---------- */
function applyZoom() {
  const on = zoom.z > 1.01;
  sheet.style.transform = on ? `translate(${zoom.x.toFixed(1)}px, ${zoom.y.toFixed(1)}px) scale(${zoom.z.toFixed(3)})` : "";
  sheet.classList.toggle("zoomed", on);
  $("zoomChip").hidden = !on;
  $("zoomText").textContent = `${Math.round(zoom.z * 100)}%`;
}
// keep the zoomed music covering the screen (no empty space past its edges)
function clampZoom() {
  const r = stand.getBoundingClientRect(), W = sheet.offsetWidth, H = sheet.offsetHeight;
  const mx = Math.max(0, (zoom.z * W - (r.width - 24)) / 2), my = Math.max(0, (zoom.z * H - (r.height - 24)) / 2);
  zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
  zoom.y = Math.max(-my, Math.min(my, zoom.y));
}
// the middle of the music when not zoomed (zooming is around it)
const sheetCenter = () => { const r = stand.getBoundingClientRect(); return { x: r.left + sheet.offsetLeft + sheet.offsetWidth / 2, y: r.top + sheet.offsetTop + sheet.offsetHeight / 2 }; };
// zoom to z keeping the point (fx, fy) of the screen where it was, starting from (z0, x0, y0) with that point at (f0x, f0y)
function zoomTo(z, fx, fy, from = { z: zoom.z, x: zoom.x, y: zoom.y, fx, fy }) {
  z = Math.max(1, Math.min(ZOOM_MAX, z));
  const c = sheetCenter(), k = z / from.z;
  zoom.z = z;
  zoom.x = fx - c.x - k * (from.fx - c.x - from.x);
  zoom.y = fy - c.y - k * (from.fy - c.y - from.y);
  if (z <= 1.01) { zoom.z = 1; zoom.x = 0; zoom.y = 0; }
  clampZoom();
  applyZoom();
  sharpenLater();
}
// once the fingers stop: draw the pages again at a resolution fit for the zoom
let sharpenTimer = 0;
function sharpenLater() {
  clearTimeout(sharpenTimer);
  sharpenTimer = setTimeout(() => {
    const z = zoom.z, res = z <= 1.05 ? 1 : z <= 1.6 ? 1.5 : z <= 2.2 ? 2 : z <= 3.2 ? 3 : 4;
    if (res === zoom.res) return;
    zoom.res = res;
    state.layout = layoutKey();
    show(state.page, { half: view.half });
  }, 300);
}
function resetZoom() { zoom.z = 1; zoom.x = 0; zoom.y = 0; applyZoom(); sharpenLater(); }
$("zoomReset").addEventListener("click", () => { resetZoom(); backToMusic(); });
const touches = new Map();
let pinch = null, panning = null;
const isControl = (e) => e.target.closest && e.target.closest("button, input, label, textarea, select, .floatbar, .unlock, .modebar, .note-input");
stand.addEventListener("pointerdown", (e) => {
  if (isControl(e)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2 && !marks.markMode && !locked) {
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, from: { z: zoom.z, x: zoom.x, y: zoom.y, fx: (a.x + b.x) / 2, fy: (a.y + b.y) / 2 } };
    down = null; // not a tap or a swipe
    panning = null;
  } else if (touches.size === 1 && zoom.z > 1.01 && !marks.markMode && !locked) {
    panning = { x: e.clientX, y: e.clientY, x0: zoom.x, y0: zoom.y };
  }
}, true);
stand.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    const [a, b] = [...touches.values()];
    zoomTo(pinch.from.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2, pinch.from);
  } else if (panning && touches.size === 1) {
    zoom.x = panning.x0 + (e.clientX - panning.x);
    zoom.y = panning.y0 + (e.clientY - panning.y);
    clampZoom();
    applyZoom();
  }
}, true);
const lift = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (!touches.size) panning = null;
};
stand.addEventListener("pointerup", lift, true);
stand.addEventListener("pointercancel", lift, true);
// a trackpad pinch (or Ctrl and the scroll wheel) on a computer
stand.addEventListener("wheel", (e) => {
  if (!e.ctrlKey || locked) return;
  e.preventDefault();
  zoomTo(zoom.z * Math.exp(-e.deltaY / 150), e.clientX, e.clientY);
}, { passive: false });

/* ---------- Taps and swipes ---------- */
let down = null;
stand.addEventListener("pointerdown", (e) => {
  if (e.button > 0 || locked) return;
  if (e.target.closest && e.target.closest("button, input, label, .markbar, .replaybar, .unlock, .modebar")) { down = null; return; } // controls over the music
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  stand.focus({ preventScroll: true });
  keepAwake();
});
stand.addEventListener("pointerup", (e) => {
  if (!down || e.pointerId !== down.id) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t;
  down = null;
  if (zoom.z > 1.01 && Math.hypot(dx, dy) >= 14) return; // moving the zoomed page, not a swipe
  if (!settings.tapTurns && !loopPick) return;
  if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) return turn(dx < 0 ? 1 : -1);
  if (Math.hypot(dx, dy) < 14 && dt < 600 && loopPick) return pickLoopBar(e.clientX, e.clientY);
  if (Math.hypot(dx, dy) < 14 && dt < 600) {
    const r = stand.getBoundingClientRect();
    turn(e.clientX - r.left < r.width / 3 ? -1 : 1);
  }
});
stand.addEventListener("pointercancel", () => { down = null; });

/* ---------- Buttons ---------- */
function backToMusic() { stand.focus({ preventScroll: true }); }
$("prevBtn").addEventListener("click", () => { turn(-1); backToMusic(); });
$("nextBtn").addEventListener("click", () => { turn(1); backToMusic(); });
$("libraryBtn").addEventListener("click", () => { closePanels("library"); library.open(); });
// Only one panel at a time (and the View menu closes too)
function closePanels(except) {
  for (const id of ["settingsPanel", "helpPanel", "troublePanel"]) if (except !== id) $(id).hidden = true;
  if (except !== "pages" && pageEditor.isOpen) pageEditor.close();
  practiceMenu.hidden = true;
  $("practiceBtn").setAttribute("aria-expanded", "false");
  $("viewBtn").setAttribute("aria-expanded", "false");
  if ($("gotoMenu")) $("gotoMenu").hidden = true;
  if (except !== "card" && !card.hidden) { card.hidden = true; helpBtn.setAttribute("aria-expanded", "false"); }
  if (except !== "report" && !reportPanel.hidden) { reportPanel.hidden = true; drawOverlay(); }
  if (except !== "library" && library.isOpen) library.close();
  viewMenu.hidden = true;
}
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("noteInput").hidden) closeNoteInput();
  else if (!practiceMenu.hidden) practiceMenu.hidden = true;
  else if (!viewMenu.hidden) viewMenu.hidden = true;
  else if (pageEditor.isOpen) pageEditor.close();
  else if (!$("troublePanel").hidden) $("troublePanel").hidden = true;
  else if (!$("tour").hidden) endTour();
  else if (!$("settingsPanel").hidden) $("settingsPanel").hidden = true;
  else if (!$("helpPanel").hidden) $("helpPanel").hidden = true;
  else if (!$("gotoMenu").hidden) $("gotoMenu").hidden = true;
  else if (library.isOpen) library.close();
  else if (!reportPanel.hidden) setReport(false);
  else if (marks.markMode) setMarkMode(false);
  else if (!card.hidden) setCard(false);
});
fileInput.addEventListener("change", async () => {
  const files = [...(fileInput.files || [])];
  fileInput.value = "";
  backToMusic();
  if (files.length) await addFiles(files);
});
function setCard(open) {
  if (open) { closePanels("card"); updateButtons(); }
  card.hidden = !open;
  helpBtn.setAttribute("aria-expanded", String(open));
  try { localStorage.setItem("pt-steps-hidden", open ? "0" : "1"); } catch {}
}
$("cardClose").addEventListener("click", () => { setCard(false); backToMusic(); });
helpBtn.addEventListener("click", () => setCard(card.hidden));
try { if (localStorage.getItem("pt-steps-hidden") === "1") setCard(false); } catch {}

/* ---------- Keep the screen on while the music is up ---------- */
let wakeLock = null;
async function keepAwake() {
  if (NATIVE) { native({ keepAwake: !!settings.awake }); return; } // the App Store app keeps the screen on itself
  if (!settings.awake || wakeLock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

// First launch: the sample goes into the library with its sheet music, so Follow works on it straight away
// (tests skip this unless they ask for it, so they start from an empty library)
async function addSample(pdfBytes) {
  let seeded = false;
  try { seeded = localStorage.getItem("pt-sample-added") === "1"; } catch {}
  if (navigator.webdriver) { try { if (localStorage.getItem("pt-test-sample") !== "1") return; } catch { return; } }
  if (seeded || state.lesson) return;
  try {
    const res = await fetch(SAMPLE.score);
    if (!res.ok) return;
    const xml = new Uint8Array(await res.arrayBuffer());
    await rememberPiece(`${SAMPLE.name}.pdf`, pdfBytes);
    const meta = await loadMeta(state.key);
    if (meta) { meta.name = SAMPLE.name; await putMeta(meta); }
    await addScore(xml, "warm-ups.musicxml", { quiet: true });
    if (scoreSectionOf()) { try { localStorage.setItem("pt-sample-added", "1"); } catch {} }
  } catch { /* the sample still opens, only without its sheet music */ }
}

/* ---------- Start: reopen the last piece, or the sample ---------- */
updateCounter();
updateButtons();
clearEar();
(async () => {
  const last = await loadLastFile();
  if (openToken === 0 && last && (await openPdf(last.bytes.slice(), last.name))) {
    // the piece left open (from before there was a library) goes into the library too
    const meta = await loadMeta(state.key);
    if (meta) fileName.textContent = meta.name;
    else rememberPiece(last.name, last.bytes);
    return;
  }
  const before = openToken; // if the pianist opens a file meanwhile, leave it alone
  try {
    const res = await fetch(SAMPLE.url);
    if (!res.ok) throw new Error(String(res.status));
    const data = new Uint8Array(await res.arrayBuffer());
    const copy = data.slice();
    if (openToken === before && (await openPdf(data, SAMPLE.name))) await addSample(copy);
  } catch {
    if (state.pdf || openToken !== before) return;
    fileName.textContent = "No PDF open";
    setStatus("Open one of your PDFs to begin.");
  }
})();
keepAwake();
