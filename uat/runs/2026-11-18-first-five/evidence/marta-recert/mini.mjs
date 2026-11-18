// Recertify break-arms (marta recert). Builds small copies of the pristine larch-house fixture site in the world folder,
// runs the REAL built CLI (init --source rooms.html, edit, watch), prints init's facts lines and the rooms.html finding.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const [world, repo] = process.argv.slice(2);
const FIX = path.join(repo, "uat/fixtures/larch-house/larch-house/site");
const CLI = path.join(repo, "dist/cli/index.js");
const cli = (args, cwd) => { const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); return { code: r.status, out: (r.stdout + r.stderr).trim() }; };
const arms = [
  { id: "M1-twin-same-price", why: "a twin room at the same price as the double; Marta raises the double only",
    page: [["<tr><td>Single room</td><td>1</td><td class=\"price\">€69 per night</td></tr>", "<tr><td>Single room</td><td>1</td><td class=\"price\">€69 per night</td></tr>\n        <tr><td>Twin room</td><td>2</td><td class=\"price\">€89 per night</td></tr>"]],
    net: [["The double room costs €89 per night and the single room €69 per night", "The double room costs €89 per night, the twin room €89 per night and the single room €69 per night"]],
    edit: [["<td>Double room</td><td>2</td><td class=\"price\">€89 per night</td>", "<td>Double room</td><td>2</td><td class=\"price\">€95 per night</td>"]] },
  { id: "M2-winter-offer-strikethrough", why: "a winter offer shown the usual way: the old price struck through, the offer beside it",
    edit: [["<td class=\"price\">€89 per night</td>", "<td class=\"price\"><del>€89</del> €79 per night this winter</td>"]] },
  { id: "M3-format-only-15-to-3pm", why: "control: check-in rewritten 15:00 -> 3pm, the same fact (must NOT read as a stale fact)",
    edit: [["Check-in is from 15:00.", "Check-in is from 3pm."]] },
  { id: "M4-intro-from-price", why: "the intro also says 'doubles from €89'; Marta changes the table only",
    page: [["Six rooms under the larches, a short walk from the lake path.", "Six rooms under the larches, a short walk from the lake path. Doubles from €89 a night."]],
    edit: [["<td>Double room</td><td>2</td><td class=\"price\">€89 per night</td>", "<td>Double room</td><td>2</td><td class=\"price\">€95 per night</td>"]] },
  { id: "M5-eur-glued", why: "the editor writes 'EUR89' (no space)",
    page: [["€89 per night", "EUR89 per night"]],
    edit: [["EUR89 per night", "EUR95 per night"]] },
  { id: "M6-price-in-words", why: "the page writes the double in words: 'eighty-nine euros'",
    page: [["€89 per night", "eighty-nine euros a night"]],
    edit: [["eighty-nine euros a night", "ninety-five euros a night"]] },
  { id: "M7-checkin-oclock", why: "check-in written '3 o'clock'; then changed to '4 o'clock'",
    page: [["Check-in is from 15:00.", "Check-in is from 3 o'clock."]],
    edit: [["Check-in is from 3 o'clock.", "Check-in is from 4 o'clock."]] },
  { id: "M8-phone-pairs", why: "the phone written in pairs '01632 96 04 18'; then a digit changes",
    page: [["Call us on +44 1632 960418", "Call us on 01632 96 04 18"]],
    edit: [["01632 96 04 18", "01632 96 04 19"]] },
  { id: "M9-price-in-js", why: "prices filled in by a script from a JSON file (the table cells are empty in the HTML)",
    page: [["<td class=\"price\">€89 per night</td>", "<td class=\"price\" data-room=\"double\"></td>"]],
    edit: [["<p class=\"intro\">", "<p class=\"intro\" data-v=\"2\">"]] },
];
const rep = (s, pairs, where) => { for (const [a, b] of pairs ?? []) { if (!s.includes(a)) throw new Error(`${where}: not found: ${a}`); s = s.replace(a, b); } return s; };
for (const arm of arms) {
  const dir = path.join(world, "mini", arm.id); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(FIX, path.join(dir, "site"), { recursive: true });
  const P = path.join(dir, "site/rooms.html"), N = path.join(dir, "site/larch_house.network.json");
  writeFileSync(P, rep(readFileSync(P, "utf8"), arm.page, arm.id + " page"));
  const netText = readFileSync(N, "utf8");
  if (arm.net) { const j = JSON.parse(netText); j.tools[0].instructions = rep(j.tools[0].instructions, arm.net, arm.id + " net"); writeFileSync(N, JSON.stringify(j, null, 2)); }
  const init = cli(["init", "--root", "site", "--source", "rooms.html"], dir);
  writeFileSync(P, rep(readFileSync(P, "utf8"), arm.edit, arm.id + " edit"));
  const watch = cli(["watch", "--root", "site"], dir);
  console.log(`\n=== ${arm.id}: ${arm.why}`);
  console.log(init.out.split("\n").filter((l) => /^(init:|facts)/.test(l)).map((l) => "  init> " + l).join("\n"));
  console.log(watch.out.split("\n").filter((l) => /grounding rooms\.html|grounding larch/.test(l)).map((l) => `  watch[${watch.code}]> ` + l).join("\n") || `  watch[${watch.code}]> (no grounding finding)`);
}
