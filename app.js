// ScoreAtlas (the app; the project is called page-turner): shows a PDF one page at a time and turns pages from a Bluetooth pedal, taps or swipes.
// Teach: play the piece, or any section of it, turning pages yourself; sections add up. Sheet music: add the
// piece's MusicXML (from Audiveris) and the app learns it without teaching. Follow: play from anywhere and the app
// turns the pages by listening, keeping up with practice, and highlights the measure being played.
import { Microphone } from "./listen.js";
import { NOTE_NAMES, BLACK_KEYS, FRAME_RATE } from "./engine/features.js";
import { Hearing } from "./engine/hearing.js";
import { makeLesson, addSection, sectionsOf, Follower } from "./engine/follower.js";
import { loadLesson, saveLesson, forgetLesson, loadLastFile, saveLastFile, keepData, savePiece, loadPiece, loadMeta, putMeta } from "./store.js";
import { Marks, INKS } from "./marks.js";
import { LibraryUI } from "./library.js";
import { readScore, keepParts, withPageStarts, shiftPages, parsePageStarts, playOrder, suggestParts } from "./engine/score.js";
import { scoreSection } from "./engine/scorelesson.js";
import { findMeasures, findMeasuresByCount, systemCounts } from "./engine/layout.js";
import { MeasureMarker } from "./engine/marker.js";
import { PracticeLog, busiestPassages } from "./engine/practice.js";
import { Recorder } from "./engine/recorder.js";

const PDFJS = new URL("./vendor/pdfjs/", import.meta.url).href;
const SAMPLE = { url: "samples/warm-ups.pdf", name: "Sample: Warm-ups" };

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
const loopBtn = $("loopBtn"), reportPanel = $("report"), reportBtn = $("reportBtn");
let practice = null; // PracticeLog while following with sheet music
let lastReport = null; // the most recent session's report
let loop = null; // { from, to } measure indices of the passage being looped
let loopPick = 0; // 1: waiting for the first bar to be tapped, 2: for the last
let loopFirst = -1;
let heatOn = true;
const modebar = $("modebar"), modeText = $("modeText"), progress = $("progress"), progressFill = $("progressFill");

const state = { pdf: null, page: 1, count: 0, cache: new Map(), layout: "", name: "", key: null, lesson: null };
let mode = "idle"; // idle, teach, follow or replay
let locked = false; // performance lock: taps and Pencil do nothing, only the pedal turns pages
let marksKey = null; // the piece the markings belong to
const marks = new Marks({
  save: (data) => { if (marksKey) saveLesson(`${marksKey}|marks`, data).catch(() => toast("Couldn't save your markings on this iPad.", 3000)); },
  enabled: () => !locked && mode !== "replay",
});
let setlist = null; // { list: { id, name, items }, index } while playing a setlist
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
const view = { twoUp: false, halfTurns: false, half: false };
try { Object.assign(view, JSON.parse(localStorage.getItem("pt-view") || "{}"), { half: false }); } catch {}
const saveView = () => { try { localStorage.setItem("pt-view", JSON.stringify({ twoUp: view.twoUp, halfTurns: view.halfTurns })); } catch {} };
function isTwoUp() {
  const r = stand.getBoundingClientRect();
  return view.twoUp && state.count > 1 && r.width > r.height * 1.1;
}
// the first page of the pair showing page n (pairs 1–2, 3–4, ...)
const spreadStart = (n) => (n % 2 ? n : n - 1);

function layoutKey() {
  const r = stand.getBoundingClientRect();
  return `${Math.round(r.width)}x${Math.round(r.height)}@${window.devicePixelRatio || 1}${isTwoUp() ? "|2" : ""}`;
}

function render(n) {
  const key = `${n}|${state.layout}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const pdf = state.pdf;
  const two = isTwoUp();
  const job = (async () => {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const r = stand.getBoundingClientRect();
    const w = Math.max(80, two ? (r.width - 36) / 2 : r.width - 24), h = Math.max(80, r.height - 24);
    const fit = Math.min(w / base.width, h / base.height);
    let scale = fit * Math.min(window.devicePixelRatio || 1, 3);
    const maxPixels = 16e6; // iPad Safari refuses canvases larger than about 16.7 million pixels
    if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(base.width * fit)}px`;
    canvas.style.height = `${Math.floor(base.height * fit)}px`;
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
// the place on screen of a measure box, if that part of its page shows
const entryFor = (box) => (box ? showing(box.page, (box.y0 + box.y1) / 2) : null);

// A page with its Pencil markings on top
function pageUnit(n, canvas) {
  const unit = document.createElement("div");
  unit.className = "page";
  unit.dataset.page = String(n);
  unit.style.width = canvas.style.width;
  unit.style.height = canvas.style.height;
  unit.append(canvas);
  const layer = marks.layer(n, parseFloat(canvas.style.width), parseFloat(canvas.style.height));
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
  state.page = Math.max(1, Math.min(state.count, n));
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

async function startFollow() {
  if (!state.lesson || mode !== "idle") return;
  const ready = startMic();
  mode = "follow";
  // Start from the page on screen: the pianist may begin anywhere, and the page is a hint where
  follower = new Follower(state.lesson, {
    page: state.page,
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
  get setlist() { return setlist ? { name: setlist.list.name, index: setlist.index, count: setlist.list.items.length } : null; },
  marks: () => marks.data(),
};

function onFrame(frame) {
  lastFrameTime = frame.time;
  const heard = hearing.update(frame);
  if (!card.hidden) drawEar(heard); // no need to redraw the note display while it's hidden
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
  $("practiceNote").hidden = !!lastReport || !!lastRecording;
  scoreBtn.disabled = !state.pdf || mode !== "idle";
  applyBtn.disabled = mode !== "idle";
  const sec = scoreSectionOf();
  loopBtn.hidden = !(sec && sec.layout && sec.layout.some(Boolean));
  loopBtn.querySelector(".lbl").textContent = loopPick ? "Cancel" : loop ? "Loop off" : "Loop";
  loopBtn.setAttribute("aria-label", loopPick ? "Cancel picking a loop" : loop ? "Loop off" : "Loop a passage");
  loopBtn.setAttribute("aria-pressed", String(!!loop || !!loopPick));
  loopBtn.disabled = mode === "teach" || mode === "replay";
  $("replayBtn").hidden = !lastRecording;
  $("replayCardBtn").hidden = !lastRecording || mode !== "idle";
  reportBtn.hidden = !lastReport;
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
  if (!at) { marker.hidden = true; return; }
  placeOnPage(marker, box, at.canvas);
  marker.hidden = false;
}

// Half-page turns while following: once the pianist is in the bottom half of the page, show the next page's top half
function halfTurnCheck(box) {
  if (!view.halfTurns || view.half || isTwoUp() || mode !== "follow" || state.page >= state.count) return;
  const canvas = shown.length && shown[0].page === state.page ? shown[0].canvas : null;
  const split = canvas ? splitOf(state.page, canvas) : 0.5;
  if (box.page === state.page && box.y0 >= split - 0.02) show(state.page, { half: true });
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
  el.style.left = `${r.left - o.left + box.x0 * r.width}px`;
  el.style.top = `${r.top - o.top + box.y0 * r.height}px`;
  el.style.width = `${(box.x1 - box.x0) * r.width}px`;
  el.style.height = `${(box.y1 - box.y0) * r.height}px`;
}

// The loop's bars outlined, and while the report is open, each bar tinted by how often it was played
function drawOverlay() {
  overlay.textContent = "";
  const sec = scoreSectionOf();
  if (!sec || !sec.layout || !shown.length) return;
  const here = (m) => entryFor(sec.layout[m]);
  if (lastReport && heatOn && !reportPanel.hidden) {
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
    const r = e.canvas.getBoundingClientRect();
    const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < e.y0 || fy > e.y1) continue;
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
    const reps = practice.report({ refine: false }).loopReps;
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
  lastReport = { ...r, sec, log: practice };
  const key = state.key;
  const summary = {
    date: Date.now(), seconds: Math.round(r.seconds), plays: [...r.plays], hesitations: [...r.hesitations],
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
  if (open) closePanels("report");
  reportPanel.hidden = !open;
  drawOverlay();
  updateButtons();
}
reportBtn.addEventListener("click", () => { renderReport(); setReport(true); });

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
    body.append(el("h3", null, "Practised most"));
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
function startReplay(at = 0) {
  const R = lastRecording;
  if (!R || (mode !== "idle" && mode !== "replay")) return;
  if (!replay) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buf = ctx.createBuffer(1, R.samples.length, R.rate);
    buf.getChannelData(0).set(R.samples);
    replay = { ctx, buf, src: null, playing: false, offset: 0, t0: 0, raf: 0, lastM: -1, lastSeen: -1 };
  }
  mode = "replay";
  replayBar.hidden = false;
  rpSeek.max = String(R.duration);
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
  const r = replay, R = lastRecording;
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
  else playFrom(r.offset >= lastRecording.duration - 0.1 ? 0 : r.offset);
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
  const r = replay, R = lastRecording;
  if (!r) return;
  const t = replayNow(), at = R.startTime + t;
  let m = -1;
  const log = R.log, sec = R.sec;
  if (log && sec && sec.layout && log.n) {
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
$("rpFwd").addEventListener("click", () => { if (replay) { const t = replayNow() + 5; replay.playing ? playFrom(t) : ((replay.offset = Math.min(lastRecording.duration, t)), drawReplay()); } });
rpSeek.addEventListener("input", () => {
  if (!replay) return;
  const t = Number(rpSeek.value);
  if (replay.playing) playFrom(t);
  else { replay.offset = t; drawReplay(); }
});
$("rpClose").addEventListener("click", () => { stopReplay(); backToMusic(); });
$("replayBtn").addEventListener("click", () => startReplay(0));
$("replayCardBtn").addEventListener("click", () => { setCard(false); startReplay(0); });
// play from a moment (engine clock) of the last session, a second early
function replayFromClock(t) {
  if (!lastRecording) return;
  startReplay(Math.max(0, t - lastRecording.startTime - 1));
}

const breathe = () => new Promise((r) => setTimeout(r, 30)); // let the screen update between long steps

// A page of the PDF as a grey image, about 130 dots per inch, for finding the measures
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
    toast(`Sheet music ready: ${plural(score.measures.length, "measure")}. Tap Follow and play.${note}`, note ? 8000 : 4500);
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
  else { startTeach(); setCard(false); }
  backToMusic();
});
$("teachDone").addEventListener("click", () => { if (mode === "teach") finishTeach(); backToMusic(); });
followBtn.addEventListener("click", () => {
  if (!state.lesson && mode === "idle") {
    setCard(true);
    toast("To follow this piece, add its sheet music or teach it (under Piece)", 3200);
    return;
  }
  if (mode === "follow") stopMode();
  else startFollow();
  backToMusic();
});

/* ---------- Library and setlists ---------- */
const library = new LibraryUI($("library"), {
  onOpen: (key) => { setlist = null; showSetlistChip(); openFromLibrary(key); },
  onAdd: () => fileInput.click(),
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
}
markBtn.addEventListener("click", () => { setMarkMode(!marks.markMode); backToMusic(); });
function pickTool(kind, color) {
  marks.tool = { kind, color: color || INKS.black };
  for (const b of markBar.querySelectorAll("[data-tool]")) {
    const on = b.dataset.tool === kind && (!b.dataset.color || INKS[b.dataset.color] === marks.tool.color);
    b.setAttribute("aria-pressed", String(on));
  }
  $("digitRow").hidden = kind !== "finger";
}
for (const b of markBar.querySelectorAll("[data-tool]")) b.addEventListener("click", () => pickTool(b.dataset.tool, b.dataset.color && INKS[b.dataset.color]));
for (const b of $("digitRow").querySelectorAll("button")) b.addEventListener("click", () => {
  marks.digit = b.textContent;
  for (const x of $("digitRow").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
});
$("markUndo").addEventListener("click", () => { if (!marks.undo()) toast("Nothing to undo", 1000); });
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
pickTool("pen", INKS.black);

/* ---------- View: two pages, half-page turns, and the performance lock ---------- */
const viewMenu = $("viewMenu");
$("viewBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  viewMenu.hidden = !viewMenu.hidden;
  $("viewBtn").setAttribute("aria-expanded", String(!viewMenu.hidden));
  $("twoUpToggle").checked = view.twoUp;
  $("halfToggle").checked = view.halfTurns;
});
document.addEventListener("pointerdown", (e) => {
  if (!viewMenu.hidden && !viewMenu.contains(e.target) && e.target !== $("viewBtn")) { viewMenu.hidden = true; $("viewBtn").setAttribute("aria-expanded", "false"); }
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
  earNote.textContent = text;
  earNote.hidden = false;
  setCard(true);
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
  if (except !== "card" && !card.hidden) { card.hidden = true; helpBtn.setAttribute("aria-expanded", "false"); }
  if (except !== "report" && !reportPanel.hidden) { reportPanel.hidden = true; drawOverlay(); }
  if (except !== "library" && library.isOpen) library.close();
  viewMenu.hidden = true;
}
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!viewMenu.hidden) viewMenu.hidden = true;
  else if (library.isOpen) library.close();
  else if (!reportPanel.hidden) setReport(false);
  else if (marks.markMode) setMarkMode(false);
  else if (!card.hidden) setCard(false);
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  backToMusic();
  if (!file) return;
  let data;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    setStatus(`Couldn't read ${file.name}. If it's in iCloud, download it to the iPad first.`, "error");
    return;
  }
  const copy = data.slice(); // the PDF reader takes over `data`, so keep our own copy to save
  if (await openPdf(data, file.name)) {
    saveLastFile(file.name, copy).catch(() => {});
    rememberPiece(file.name, copy);
  }
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
  if (wakeLock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

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
    if (openToken === before) await openPdf(data, SAMPLE.name);
  } catch {
    if (state.pdf || openToken !== before) return;
    fileName.textContent = "No PDF open";
    setStatus("Open one of your PDFs to begin.");
  }
})();
keepAwake();
