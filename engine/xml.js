// A small XML reader (enough for MusicXML), so the same code runs in the browser and in Node.
// parseXml(text) returns the root element: { name, attrs, children: [elements], text }.
// Helpers: child(el, name), children(el, name), textOf(el, name).

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(text) {
  const root = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) {
      const t = text.slice(i, lt);
      if (t.trim()) stack[stack.length - 1].text += decode(t);
    }
    if (text.startsWith("<!--", lt)) { i = text.indexOf("-->", lt) + 3; continue; }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt);
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) { i = text.indexOf("?>", lt) + 2; continue; }
    if (text.startsWith("<!", lt)) {
      // DOCTYPE, possibly with an internal subset in [...]
      let j = lt + 2, depth = 0;
      while (j < n && !(text[j] === ">" && depth === 0)) {
        if (text[j] === "[") depth++;
        else if (text[j] === "]") depth--;
        j++;
      }
      i = j + 1;
      continue;
    }
    const gt = text.indexOf(">", lt);
    if (gt < 0) break;
    if (text[lt + 1] === "/") {
      if (stack.length > 1) stack.pop();
      i = gt + 1;
      continue;
    }
    let body = text.slice(lt + 1, gt);
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);
    const m = /^([^\s/>]+)/.exec(body);
    const el = { name: m ? m[1] : "", attrs: {}, children: [], text: "" };
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = re.exec(body))) el.attrs[a[1]] = decode(a[3] ?? a[4]);
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
    i = gt + 1;
  }
  return root.children.find((c) => c.name) || root;
}

export const child = (el, name) => (el ? el.children.find((c) => c.name === name) : undefined);
export const children = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
export const textOf = (el, name) => {
  const c = child(el, name);
  return c ? c.text.trim() : undefined;
};
