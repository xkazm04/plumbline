#!/usr/bin/env node
// The narrator audition (knowledge/media-generation/production-ops/live-system-demo-film, "narrator-chosen-by-audition"):
// five voices read ONE passage of the film's own lines at the same loosened delivery, and the owner picks by ear.
// It reuses the demo-film kit's key resolution and audio POST (ai-registry/skills/demo-film/tools/lib), so the key is
// read the kit's way (ELEVENLABS_API_KEY, .env files from film/ up to the git root, or an ELEVENLABS_ENV_FILE pointer)
// and never printed.
//
// usage: node film/audition/audition.mjs --dry              the passage and the characters it would spend; no network
//        node film/audition/audition.mjs --list             the account's voices, ranked as narrators (a free GET)
//        node film/audition/audition.mjs [--voices a,b,..] --yes   synthesise; without --voices, the top five, varied
// env:   DEMO_FILM_KIT (default: ../ai-registry/skills/demo-film beside this repository)
// writes film/out/audition/ (git-ignored): <n>-<voice>.mp3 and index.html to listen to them side by side.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const FILM = path.join(REPO, "film");
const OUT = path.join(FILM, "out", "audition");
const KIT = process.env.DEMO_FILM_KIT ?? path.resolve(REPO, "..", "ai-registry", "skills", "demo-film");
if (!existsSync(path.join(KIT, "tools", "lib", "env.mjs"))) {
  console.error(`the demo-film kit is not at ${KIT} (set DEMO_FILM_KIT)`);
  process.exit(2);
}
const { resolveEnv } = await import(pathToFileURL(path.join(KIT, "tools", "lib", "env.mjs")).href);
const { API, postAudio, ffprobeMs } = await import(pathToFileURL(path.join(KIT, "tools", "lib", "audio.mjs")).href);
const { narratorScore } = await import(pathToFileURL(path.join(KIT, "tools", "narrate.mjs")).href);

// The passage: lines from across the film, the opening, a claim with a name in it, a short one, a technical one, the end.
const PASSAGE_BEATS = ["cold", "clinic-mirror", "agent-guard", "close"];
// The same loosened delivery for every candidate (the technique: compare voices, not settings).
const SETTINGS = { stability: 0.35, similarity_boost: 0.8, style: 0.4 };
const MODEL = "eleven_multilingual_v2";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const film = JSON.parse(await readFile(path.join(FILM, "film.json"), "utf8"));
const passage = PASSAGE_BEATS.map((id) => film.beats.find((b) => b.id === id)?.line).filter(Boolean).join(" ");

if (has("--dry")) {
  console.log(`passage (${passage.length} characters, beats ${PASSAGE_BEATS.join(", ")}):\n${passage}\n`);
  console.log(`five voices would spend ${passage.length * 5} characters; settings ${JSON.stringify(SETTINGS)}, model ${MODEL}`);
  process.exit(0);
}

const env = resolveEnv(FILM);
if (!env.key) {
  console.error("no ElevenLabs key: set ELEVENLABS_API_KEY, or point ELEVENLABS_ENV_FILE at a file that holds it");
  process.exit(2);
}
console.error(`key: from ${env.keySource === "environment" ? "the environment" : env.keySource}`);

async function voices() {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": env.key }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`GET /v1/voices: ${res.status} ${res.statusText}`);
  const list = (await res.json()).voices ?? [];
  return list.map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels ?? {}, category: v.category, score: narratorScore(v) })).sort((a, b) => b.score - a.score);
}

const all = await voices();
if (has("--list")) {
  for (const v of all) console.log(`${String(v.score).padStart(3)}  ${v.id}  ${v.name}  ${JSON.stringify(v.labels)}`);
  process.exit(0);
}

let chosen;
if (has("--voices")) {
  const ids = args[args.indexOf("--voices") + 1].split(",");
  chosen = ids.map((id) => all.find((v) => v.id === id) ?? { id, name: id, labels: {} });
} else {
  // the top-ranked narrators, at most two of one gender, so the owner hears a range of register
  chosen = [];
  const perGender = {};
  for (const v of all) {
    const g = v.labels.gender ?? "?";
    if ((perGender[g] ?? 0) >= 3) continue;
    chosen.push(v);
    perGender[g] = (perGender[g] ?? 0) + 1;
    if (chosen.length === 5) break;
  }
}
const spend = passage.length * chosen.length;
if (!has("--yes")) {
  console.log(`would synthesise ${chosen.length} voices x ${passage.length} characters = ${spend}: ${chosen.map((v) => v.name).join(", ")}. Add --yes.`);
  process.exit(4);
}

await mkdir(OUT, { recursive: true });
const rows = [];
for (const [i, v] of chosen.entries()) {
  const file = path.join(OUT, `${i + 1}-${v.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/-+$/, "")}.mp3`);
  await postAudio({ url: `${API}/text-to-speech/${v.id}?output_format=mp3_44100_128`, apiKey: env.key, body: { text: passage, model_id: MODEL, voice_settings: SETTINGS }, file });
  const ms = await ffprobeMs(file);
  rows.push({ n: i + 1, ...v, file: path.basename(file), ms });
  console.log(`${i + 1}. ${v.name} (${v.id}) ${(ms / 1000).toFixed(1)} s, ${Math.round(passage.split(/\s+/).length / (ms / 60000))} words a minute`);
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
await writeFile(
  path.join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Plumbline film: narrator audition</title>
<style>body{font:16px/1.5 system-ui;margin:2rem;max-width:56rem}li{margin:1rem 0}code{font-size:13px}</style>
<h1>Narrator audition</h1><p>One passage, five voices, the same settings (${esc(JSON.stringify(SETTINGS))}). Pick by ear.</p>
<blockquote>${esc(passage)}</blockquote><ol>${rows
    .map((r) => `<li><b>${esc(r.name)}</b> <code>${esc(r.id)}</code> ${esc(JSON.stringify(r.labels))} · ${(r.ms / 1000).toFixed(1)} s<br><audio controls preload="none" src="${esc(r.file)}"></audio></li>`)
    .join("")}</ol>`,
);
await writeFile(path.join(OUT, "audition.json"), JSON.stringify({ passage, settings: SETTINGS, model: MODEL, spentCharacters: spend, voices: rows }, null, 2) + "\n");
console.log(`spent ${spend} characters; listen: ${path.join(OUT, "index.html")}`);
