// Copies the web app into www/, which Capacitor puts inside the iPad app (`npm run build` does this and then
// `npx cap sync ios`). The list of files is the one the website keeps for offline use (../sw.js), plus licenses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const www = path.join(here, "www");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const list = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
const extra = [
  "vendor/pdfjs/LICENSE", "vendor/fflate/LICENSE", "vendor/tfjs/LICENSE", "vendor/basic-pitch/LICENSE",
  "vendor/pdf-lib/LICENSE.md", "vendor/fonts/OFL.txt",
];
fs.rmSync(www, { recursive: true, force: true });
let n = 0, bytes = 0;
for (const f of [...list, ...extra]) {
  if (f === "./" || f.endsWith("sw.js")) continue;
  const from = path.join(root, f);
  if (!fs.existsSync(from)) { if (!extra.includes(f)) throw new Error(`missing: ${f}`); continue; }
  const to = path.join(www, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  n++;
  bytes += fs.statSync(from).size;
}
console.log(`copied ${n} files (${(bytes / 1e6).toFixed(1)} MB) into www/`);
