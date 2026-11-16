// Page Turner: shows a PDF one page at a time and turns pages from a Bluetooth pedal, taps or swipes.
// Teach: play the piece, or any section of it, turning pages yourself; sections add up. Sheet music: add the
// piece's MusicXML (from Audiveris) and the app learns it without teaching. Follow: play from anywhere and the app
// turns the pages by listening, keeping up with practice, and highlights the measure being played.
import { Microphone } from "./listen.js";
import { NOTE_NAMES, BLACK_KEYS, FRAME_RATE } from "./engine/features.js";
import { Hearing } from "./engine/hearing.js";
import { makeLesson, addSection, sectionsOf, Follower } from "./engine/follower.js";
import { loadLesson, saveLesson, forgetLesson, loadLastFile, saveLastFile, keepData } from "./store.js";
import { readScore, keepParts, withPageStarts, parsePageStarts, playOrder } from "./engine/score.js";
import { scoreSection } from "./engine/scorelesson.js";
import { findMeasures, findMeasuresByCount, systemCounts } from "./engine/layout.js";
import { MeasureMarker } from "./engine/marker.js";

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
const modebar = $("modebar"), modeText = $("modeText"), progress = $("progress"), progressFill = $("progressFill");

const state = { pdf: null, page: 1, count: 0, cache: new Map(), layout: "", name: "", key: null, lesson: null };
let mode = "idle"; // idle, teach or follow
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
  stopMode();
  const old = state.pdf;
  dropCache(() => true);
  Object.assign(state, { pdf, count: pdf.numPages, page: 1, name, lesson: null });
  state.key = `${(pdf.fingerprints && pdf.fingerprints[0]) || name}:${pdf.numPages}`;
  fileName.textContent = name;
  fileName.title = name;
  if (old) old.destroy();
  await show(1);
  const key = state.key;
  const lesson = await loadLesson(key);
  if (state.key === key) {
    state.lesson = lesson || null;
    updateLessonInfo();
    updateButtons();
  }
  return true;
}

/* ---------- Drawing pages ---------- */
function layoutKey() {
  const r = stand.getBoundingClientRect();
  return `${Math.round(r.width)}x${Math.round(r.height)}@${window.devicePixelRatio || 1}`;
}

function render(n) {
  const key = `${n}|${state.layout}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const pdf = state.pdf;
  const job = (async () => {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const r = stand.getBoundingClientRect();
    const w = Math.max(80, r.width - 24), h = Math.max(80, r.height - 24);
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

let showToken = 0;
async function show(n) {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(state.count, n));
  updateCounter();
  const token = ++showToken;
  let canvas;
  try {
    canvas = await render(state.page);
  } catch {
    if (token === showToken) setStatus(`Page ${state.page} couldn't be drawn.`, "error");
    return;
  }
  if (token !== showToken) return;
  sheet.replaceChildren(canvas, marker);
  setStatus(null);
  // Keep the pages on either side ready so a turn is instant
  const near = [state.page + 1, state.page - 1].filter((p) => p >= 1 && p <= state.count);
  const keep = new Set([state.page, ...near].map((p) => `${p}|${state.layout}`));
  dropCache((key) => !keep.has(key));
  near.forEach((p) => render(p).catch(() => {}));
}

// A turn by the pianist: pedal, tap, swipe or the arrow buttons
function turn(step) {
  if (!state.pdf) return;
  const target = state.page + step;
  if (target < 1) return toast("First page");
  if (target > state.count) return toast("Last page");
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
  pageNum.value = state.pdf ? `${state.page} / ${state.count}` : "– / –";
  $("prevBtn").disabled = !state.pdf || state.page <= 1;
  $("nextBtn").disabled = !state.pdf || state.page >= state.count;
}

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const key = layoutKey();
    if (key === state.layout) return;
    state.layout = key;
    show(state.page);
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
  updateButtons();
  updateModebar();
  try {
    await ready;
  } catch (err) {
    stopMode();
    showMicProblem(err);
  }
}

function stopMode() {
  if (mode === "teach") teach = null;
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
    if (frame.index % 5 === 0) updateModebar(st);
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
    if (performance.now() < flash.until) text = `Following · ${flash.text}`;
    modeText.textContent = text;
  }
}

function updateButtons() {
  forgetBtn.hidden = !sectionsOf(state.lesson).length || mode !== "idle";
  teachBtn.textContent = mode === "teach" ? "Done" : "Teach";
  teachBtn.setAttribute("aria-pressed", String(mode === "teach"));
  teachBtn.disabled = !state.pdf || mode === "follow";
  followBtn.textContent = mode === "follow" ? "Stop" : "Follow";
  followBtn.setAttribute("aria-pressed", String(mode === "follow"));
  followBtn.disabled = !state.lesson || mode === "teach";
  followBtn.title = state.lesson ? "" : "Add this piece's sheet music or teach it first";
  scoreBtn.disabled = !state.pdf || mode !== "idle";
  applyBtn.disabled = mode !== "idle";
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
  parts.forEach((p, i) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = String(i);
    box.checked = !opts.parts || !opts.parts.length || opts.parts.includes(i);
    const staves = p.staves > 1 ? ` (${p.staves} staves)` : "";
    label.append(box, ` ${p.name || `Part ${i + 1}`}${staves}`);
    partsList.append(label);
  });
  barsInput.value = (opts.pageStarts || []).join(", ");
}
applyBtn.addEventListener("click", () => {
  const section = sectionsOf(state.lesson).find((s) => s.fromScore);
  if (!section || !section.scoreFile) return;
  const boxes = [...partsList.querySelectorAll("input")];
  const chosen = boxes.filter((b) => b.checked).map((b) => Number(b.value));
  const parts = chosen.length && chosen.length < boxes.length ? chosen : null;
  const pageStarts = parsePageStarts(barsInput.value);
  addScore(section.scoreFile, section.name, { parts, pageStarts });
  backToMusic();
});

// The measure being played, highlighted on the page (when the piece has sheet music)
// The follower's position wobbles a little, so the highlight is smoothed (see engine/marker.js)
let movesSeen = 0;
function drawMarker() {
  const f = follower && follower.lesson;
  const canvas = sheet.querySelector("canvas");
  const sure = f && follower.status === "following" && !follower.unsure;
  const moves = follower ? follower.moves || 0 : 0;
  let m = -1;
  if (f && f.order) { // smoothed, in the order the measures are played
    const shown = smoother.update(sure ? f.played[follower.position] : -1, moves !== movesSeen);
    m = shown >= 0 ? f.order[shown] : -1;
  } else if (sure) m = f.measure[follower.position]; // sheet music added in Test 7
  movesSeen = moves;
  const box = m >= 0 && f.layout ? f.layout[m] : null;
  if (!box || box.page !== state.page || !canvas) { marker.hidden = true; return; }
  marker.style.left = `${canvas.offsetLeft + box.x0 * canvas.offsetWidth}px`;
  marker.style.top = `${canvas.offsetTop + box.y0 * canvas.offsetHeight}px`;
  marker.style.width = `${(box.x1 - box.x0) * canvas.offsetWidth}px`;
  marker.style.height = `${(box.y1 - box.y0) * canvas.offsetHeight}px`;
  marker.hidden = false;
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
    let score = keepParts(full, options.parts);
    const byBars = !!(options.pageStarts && options.pageStarts.length);
    if (byBars) score = withPageStarts(score, options.pageStarts);
    if (!score.measures.some((m) => m.notes.length)) throw new Error("the parts you chose have no notes.");
    const counts = byBars ? {} : systemCounts(score);
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
      scoreFile: bytes, options: { parts: options.parts || null, pageStarts: byBars ? options.pageStarts : [] },
      partList: full.parts.map((p) => ({ name: p.name, staves: p.staves })),
    });
    // replace any earlier sheet music; taught sections stay (they're used where they fit better)
    state.lesson = { version: 2, sections: [section, ...sectionsOf(state.lesson).filter((s) => !s.fromScore)] };
    setStatus(null);
    updateLessonInfo();
    updateButtons();
    let note = "";
    if (score.pages !== state.count) {
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
  else startTeach();
  backToMusic();
});
followBtn.addEventListener("click", () => {
  if (mode === "follow") stopMode();
  else startFollow();
  backToMusic();
});

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
  if (e.button > 0) return;
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  stand.focus({ preventScroll: true });
  keepAwake();
});
stand.addEventListener("pointerup", (e) => {
  if (!down || e.pointerId !== down.id) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t;
  down = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) return turn(dx < 0 ? 1 : -1);
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
$("openBtn").addEventListener("click", () => { fileInput.click(); });
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
  if (await openPdf(data, file.name)) saveLastFile(file.name, copy).catch(() => {});
});
function setCard(open) {
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
  if (openToken === 0 && last && (await openPdf(last.bytes, last.name))) return;
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
