import fs from "node:fs";
const terms = ["drift","lock","plumbline.lock.json","grounding","source","network","agent","re-lock","relock","sign","signed","signature","clone","commit","workflow","block","warn","severity","kind","ref","vendored","runtime","peer","links.json","verifiers","tampered","pin","capture"];
for (const f of process.argv.slice(2)) {
  const t = fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "").toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;
  const hit = terms.filter((w) => new RegExp(`(^|[^a-z.])${w.replace(/\./g, "\.")}([^a-z]|$)`).test(t));
  console.log(f.split(/[\/]/).pop(), "words", words, "terms", hit.length, hit.join(","));
}
