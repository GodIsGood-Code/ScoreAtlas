// Page Turner: shows a PDF one page at a time and turns pages from a Bluetooth pedal,
// taps or swipes. Test 2 adds a listening check for the microphone.
import { Listener, NOTE_NAMES, BLACK_KEYS } from "./listen.js";

const PDFJS = new URL("./vendor/pdfjs/", import.meta.url).href;
const SAMPLE = { url: "samples/warm-ups.pdf", name: "Sample: Warm-ups" };

const $ = (id) => document.getElementById(id);
const stand = $("stand"), sheet = $("sheet"), pageNum = $("pageNum");
const fileName = $("fileName"), fileInput = $("fileInput");
const pedal = $("pedal"), pedalText = $("pedalText"), keysSeen = $("keysSeen");
const card = $("card"), helpBtn = $("helpBtn");

const state = { pdf: null, page: 1, count: 0, cache: new Map(), layout: "" };

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
    if (token !== openToken) return;
    const locked = err && err.name === "PasswordException";
    setStatus(locked
      ? `${name} is password-protected. Remove the password, then open it again.`
      : `Couldn't open ${name}. Check that it's a PDF file and try again.`, "error");
    if (!state.pdf) fileName.textContent = "No PDF open";
    return;
  }
  if (token !== openToken) { pdf.destroy(); return; } // a newer file was opened meanwhile
  const old = state.pdf;
  dropCache(() => true);
  state.pdf = pdf;
  state.count = pdf.numPages;
  state.page = 1;
  fileName.textContent = name;
  fileName.title = name;
  if (old) old.destroy();
  await show(1);
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
  sheet.replaceChildren(canvas);
  setStatus(null);
  // Keep the pages on either side ready so a turn is instant
  const near = [state.page + 1, state.page - 1].filter((p) => p >= 1 && p <= state.count);
  const keep = new Set([state.page, ...near].map((p) => `${p}|${state.layout}`));
  dropCache((key) => !keep.has(key));
  near.forEach((p) => render(p).catch(() => {}));
}

function turn(step) {
  if (!state.pdf) return;
  const target = state.page + step;
  if (target < 1) return toast("First page");
  if (target > state.count) return toast("Last page");
  show(target);
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
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1200);
}

/* ---------- Pedal and keyboard ---------- */
const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Spacebar", "Enter"]);
const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);
const KEY_NAMES = {
  ArrowRight: "Right arrow", ArrowLeft: "Left arrow", ArrowDown: "Down arrow", ArrowUp: "Up arrow",
  PageDown: "Page Down", PageUp: "Page Up", " ": "Space", Spacebar: "Space", Enter: "Enter",
};
const seen = [];
let lastPress = "";

function keyLabel(e) {
  if (KEY_NAMES[e.key]) return KEY_NAMES[e.key];
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  if (e.key && e.key !== "Unidentified") return e.key;
  return e.code || "Unknown key";
}

function refreshPedal() {
  if (!document.hasFocus()) {
    pedal.dataset.state = "nofocus";
    pedalText.textContent = "tap the music";
  } else if (lastPress) {
    pedal.dataset.state = "pressed";
    pedalText.textContent = lastPress;
  } else {
    pedal.dataset.state = "ready";
    pedalText.textContent = "ready";
  }
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (["Tab", "Shift", "Escape"].includes(e.key)) return;
  const onControl = e.target instanceof Element && e.target.closest("button, input, a");
  if (onControl && (e.key === " " || e.key === "Enter")) return; // keep buttons usable from a keyboard
  e.preventDefault();
  if (e.repeat) return;
  const label = keyLabel(e);
  const action = NEXT.has(e.key) ? 1 : PREV.has(e.key) ? -1 : 0;
  lastPress = action ? `${label} → ${action > 0 ? "next" : "back"}` : `${label} (not used yet)`;
  if (!seen.includes(label)) {
    seen.push(label);
    keysSeen.textContent = seen.join(", ");
  }
  refreshPedal();
  pedal.classList.remove("flash");
  void pedal.offsetWidth;
  pedal.classList.add("flash");
  keepAwake();
  if (action) turn(action);
});
window.addEventListener("focus", refreshPedal);
window.addEventListener("blur", refreshPedal);

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
stand.addEventListener("focus", refreshPedal);

/* ---------- Listening check ---------- */
const listenBtn = $("listenBtn"), listenLabel = $("listenLabel"), listenMeter = $("listenMeter");
const earHeard = $("earHeard"), earLevel = $("earLevel"), earNote = $("earNote"), earKeys = $("earKeys");
const keyBars = NOTE_NAMES.map((name, i) => {
  const col = document.createElement("div");
  col.className = BLACK_KEYS.has(i) ? "key-col black" : "key-col";
  col.innerHTML = `<div class="bar"><i></i></div><div class="name">${name}</div>`;
  earKeys.append(col);
  return { col, fill: col.querySelector("i") };
});
const smooth = new Float32Array(12);
let listener = null;

function drawEar({ levelDb, chroma }) {
  const loudness = Math.max(0, Math.min(1, (levelDb + 70) / 60));
  earLevel.style.width = `${(loudness * 100).toFixed(1)}%`;
  listenMeter.style.height = `${(loudness * 100).toFixed(1)}%`;
  const quiet = levelDb < -58;
  let max = 0;
  for (let i = 0; i < 12; i++) max = Math.max(max, chroma[i]);
  for (let i = 0; i < 12; i++) {
    const v = quiet || max === 0 ? 0 : chroma[i] / max;
    smooth[i] = smooth[i] * 0.55 + v * 0.45;
  }
  const loudest = [...smooth.keys()].sort((a, b) => smooth[b] - smooth[a]);
  const heard = quiet ? [] : loudest.filter((i) => smooth[i] > 0.55).slice(0, 4).sort((a, b) => a - b);
  keyBars.forEach(({ col, fill }, i) => {
    fill.style.transform = `scaleY(${smooth[i].toFixed(3)})`;
    col.classList.toggle("on", heard.includes(i));
  });
  earHeard.textContent = quiet ? "play a few notes or a chord" : heard.length ? heard.map((i) => NOTE_NAMES[i]).join(" · ") : "…";
}

function setListening(on) {
  listenBtn.setAttribute("aria-pressed", String(on === true));
  listenLabel.textContent = on === true ? "Stop" : on === "starting" ? "Starting…" : "Listen";
  if (on !== true) {
    smooth.fill(0);
    keyBars.forEach(({ col, fill }) => { fill.style.transform = "scaleY(0)"; col.classList.remove("on"); });
    earLevel.style.width = "0";
    listenMeter.style.height = "0";
    if (on === false) earHeard.textContent = "tap Listen to start";
  }
}

function micProblem(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is off for this page. In Safari, tap the aA button in the address bar, choose Website Settings, set Microphone to Allow, then reload the page.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "Another app is using the microphone. Close it, then tap Listen again.";
  if (name === "NotSupportedError") return "This page can't reach the microphone here. Open the app at its own web address in Safari.";
  return "The microphone couldn't start. Reload the page and tap Listen again.";
}

listenBtn.addEventListener("click", async () => {
  if (listener) {
    listener.stop();
    listener = null;
    setListening(false);
    backToMusic();
    return;
  }
  setCard(true);
  earNote.hidden = true;
  setListening("starting");
  const l = new Listener({ onFrame: drawEar });
  try {
    await l.start();
    listener = l;
    setListening(true);
    earHeard.textContent = "play a few notes or a chord";
  } catch (err) {
    setListening(false);
    earNote.textContent = micProblem(err);
    earNote.hidden = false;
  }
  backToMusic();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && listener) {
    listener.stop();
    listener = null;
    setListening(false);
  }
});

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
  openPdf(data, file.name);
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

/* ---------- Start with the sample score ---------- */
refreshPedal();
updateCounter();
(async () => {
  try {
    const res = await fetch(SAMPLE.url);
    if (!res.ok) throw new Error(String(res.status));
    const data = new Uint8Array(await res.arrayBuffer());
    if (!state.pdf && openToken === 0) await openPdf(data, SAMPLE.name);
  } catch {
    if (state.pdf || openToken > 0) return;
    fileName.textContent = "No PDF open";
    setStatus("Open one of your PDFs to begin.");
  }
})();
keepAwake();
