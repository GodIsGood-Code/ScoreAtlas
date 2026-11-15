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
export const loadLastFile = () => run("files", "readonly", (s) => s.get("last")).catch(() => null);
export const saveLastFile = (name, bytes) => run("files", "readwrite", (s) => s.put({ name, bytes }, "last"));

// Ask the browser not to clear our data when space runs low
export function keepData() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {}
}
