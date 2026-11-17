// Duplicate keys in JSON text. Pure: no node:* imports, no dependency.
//
// Why it matters: JSON.parse keeps the LAST of two equal keys in one object, but the reference runtime reads network
// files with its own HOCON parser, which deep-MERGES them (site/runtime/hocon.js, the "deep-merge on duplicate object
// keys" branch). So a file with a duplicate key means one thing to a JSON reader (a validator, a reviewer's tool) and
// another to the runtime. Keys are compared after unescaping, so `"a"` and `"a"` are the same key.

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const LITERAL = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/;

type Frame = { kind: "object"; keys: Set<string> } | { kind: "array" };
type Expect = "value" | "value-or-close" | "key" | "key-or-close" | "after";

/**
 * Counts the duplicate keys in a JSON text: in each object, every member whose key already appeared in that same
 * object counts once. A leading BOM and surrounding whitespace are allowed. Throws on text that is not JSON (call it
 * on text JSON.parse accepted, or catch). Iterative over an explicit stack, so deep nesting cannot overflow the call
 * stack.
 */
export function countDuplicateKeys(text: string): number {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let duplicates = 0;
  const stack: Frame[] = [];
  let expect: Expect = "value";

  const fail = (): never => {
    throw new Error("not JSON");
  };
  const ws = (): void => {
    for (let c = text.charCodeAt(i); c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d; c = text.charCodeAt(i)) i++;
  };
  const readString = (): string => {
    if (text[i] !== '"') fail();
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail();
      const c = text[i] as string;
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        const e = text[i + 1] ?? "";
        if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          const v = ESCAPES[e];
          if (v === undefined) fail();
          out += v;
          i += 2;
        }
        continue;
      }
      if (c.charCodeAt(0) < 0x20) fail();
      out += c;
      i++;
    }
  };

  for (;;) {
    ws();
    const c = text[i];
    if (expect === "value" || expect === "value-or-close") {
      if (expect === "value-or-close" && c === "]") {
        i++;
        stack.pop();
        expect = "after";
      } else if (c === "{") {
        i++;
        stack.push({ kind: "object", keys: new Set() });
        expect = "key-or-close";
      } else if (c === "[") {
        i++;
        stack.push({ kind: "array" });
        expect = "value-or-close";
      } else if (c === '"') {
        readString();
        expect = "after";
      } else {
        const m = LITERAL.exec(text.slice(i, i + 512));
        if (!m) fail();
        i += (m as RegExpExecArray)[0].length;
        expect = "after";
      }
      continue;
    }
    if (expect === "key" || expect === "key-or-close") {
      if (expect === "key-or-close" && c === "}") {
        i++;
        stack.pop();
        expect = "after";
        continue;
      }
      const frame = stack[stack.length - 1];
      if (frame?.kind !== "object") fail();
      const key = readString();
      const keys = (frame as { keys: Set<string> }).keys;
      if (keys.has(key)) duplicates++;
      else keys.add(key);
      ws();
      if (text[i] !== ":") fail();
      i++;
      expect = "value";
      continue;
    }
    // after a complete value
    const top = stack[stack.length - 1];
    if (top === undefined) break;
    if (c === ",") {
      i++;
      expect = top.kind === "object" ? "key" : "value";
    } else if ((top.kind === "object" && c === "}") || (top.kind === "array" && c === "]")) {
      i++;
      stack.pop();
    } else {
      fail();
    }
  }
  if (i !== text.length) fail();
  return duplicates;
}
