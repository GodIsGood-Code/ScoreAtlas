// Keeps taught pieces ("lessons") and the last opened PDF on this device, in the browser's own database.
// Nothing leaves the iPad.

const DB_NAME = "page-turner";
let opening = null;

function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("lessons");
        req.result.createObjectStore("files");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    opening.catch(() => { opening = null; });
  }
  return opening;
}

async function run(storeName, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const loadLesson = (key) => run("lessons", "readonly", (s) => s.get(key)).catch(() => null);
export const saveLesson = (key, lesson) => run("lessons", "readwrite", (s) => s.put(lesson, key));
export const forgetLesson = (key) => run("lessons", "readwrite", (s) => s.delete(key));
export const loadLastFile = () => run("files", "readonly", (s) => s.get("last")).catch(() => null);
export const saveLastFile = (name, bytes) => run("files", "readwrite", (s) => s.put({ name, bytes }, "last"));

// Ask the browser not to clear our data when space runs low
export function keepData() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {}
}

// The library: every PDF opened is kept (its bytes under "piece|<key>", a small description under "meta|<key>":
// { key, name, pages, added, opened, thumb }), and the setlists (a list of { id, name, items: [key, ...] })
export const savePiece = (key, name, bytes, meta) => run("files", "readwrite", (s) => { s.put({ name, bytes }, `piece|${key}`); return s.put(meta, `meta|${key}`); });
export const loadPiece = (key) => run("files", "readonly", (s) => s.get(`piece|${key}`)).catch(() => null);
export const loadMeta = (key) => run("files", "readonly", (s) => s.get(`meta|${key}`)).catch(() => null);
export const putMeta = (meta) => run("files", "readwrite", (s) => s.put(meta, `meta|${meta.key}`));
export const listMeta = () => run("files", "readonly", (s) => s.getAll(IDBKeyRange.bound("meta|", "meta|￿"))).catch(() => []);
export async function removePiece(key) {
  await run("files", "readwrite", (s) => { s.delete(`piece|${key}`); return s.delete(`meta|${key}`); });
  // and what the app learned about it: the lesson, Pencil markings, practice history
  await run("lessons", "readwrite", (s) => {
    s.delete(key); s.delete(`${key}|marks`); s.delete(`${key}|bookmarks`); s.delete(`${key}|ignore`); s.delete(`${key}|takes`);
    s.delete(IDBKeyRange.bound(`${key}|take|`, `${key}|take|\uffff`)); // kept recordings
    return s.delete(`${key}|practice`);
  }).catch(() => {});
}
export const loadSetlists = () => run("files", "readonly", (s) => s.get("setlists")).then((x) => x || []).catch(() => []);
export const saveSetlists = (lists) => run("files", "readwrite", (s) => s.put(lists, "setlists"));

// Everything in a store as [key, value] pairs, and putting pairs back (for backups)
export async function entries(storeName) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const st = tx.objectStore(storeName);
    const keys = st.getAllKeys(), values = st.getAll();
    tx.oncomplete = () => resolve(keys.result.map((k, i) => [k, values.result[i]]));
    tx.onerror = () => reject(tx.error);
  });
}
export async function putEntries(storeName, list) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const st = tx.objectStore(storeName);
    for (const [k, v] of list) st.put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
