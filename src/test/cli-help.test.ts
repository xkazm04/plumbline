// UAT-28 (DEV-L1-09, INE-L1-06, PRI-L1-13, PRI-L1-11, PRI-L2-4, PRI-L1-15, DEV-L2-2, DEV-L1-07): one way in. The help
// answers on every form and groups the commands by role; a clean watch says "no drift"; an http address names
// --allow-local; the rate-limit time is a date; init refuses Plumbline's own Desk; and (MC-3) the README's "Use it"
// commands run as printed, from the folder each block names, against a loopback copy of the site they build. Every
// spawned CLI runs with the no-network preload.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import type http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../cli/help.js";
import { resetWords } from "../watch/detectors.js";
import { CLI, NO_NETWORK, run, runAsync, writeSite } from "./cli-helpers.js";
import { loopbackServer, type TestServer } from "./net-helpers.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

let tmp: string;
let server: TestServer;
/** The folder the loopback server serves, as a site at its root. */
let servedRoot = "";
const handler: http.RequestListener = (req, res) => {
  const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
  const file = path.join(servedRoot, rel === "" ? "index.html" : rel);
  if (servedRoot === "" || !file.startsWith(servedRoot) || !existsSync(file) || !statSync(file).isFile()) res.writeHead(404).end();
  else res.writeHead(200).end(readFileSync(file));
};

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-uat28-"));
  server = await loopbackServer(handler);
});
after(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** The help's sections: each role heading with the command names listed under it. */
function sections(help: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of help.split("\n")) {
    const heading = /^(Agent owner|Publisher|Verifier|Operator|CI):/.exec(line);
    if (heading) out.set(heading[1] as string, (current = []));
    else if (line.startsWith("  ") && current) current.push(line.trim().split(/\s{2,}/)[0] as string);
    else if (line.trim() === "") current = undefined;
  }
  return out;
}

test("UAT-28: --help, -h, help and help <command> answer on stdout with exit 0, the commands grouped by role", () => {
  for (const form of [["--help"], ["-h"], ["help"]]) {
    const r = run(...form);
    assert.equal(r.code, 0, form.join(" "));
    assert.match(r.out, /Needs Node 22 or later/);
    const roles = sections(r.out);
    // since 2026-11-21 (agent change control leads): the agent owner's commands come first
    assert.deepEqual([...roles.keys()], ["Agent owner", "Publisher", "Verifier", "Operator", "CI"]);
    for (const c of ["agent", "approve", "audit", "approver", "guard"]) assert.ok(roles.get("Agent owner")?.includes(c), c);
    // the bad-day commands are the publisher's; trust, verify and adopt the verifier's (INE-L1-06)
    for (const c of ["init", "watch", "sign", "rotate", "revoke", "keygen", "dns"]) assert.ok(roles.get("Publisher")?.includes(c), c);
    for (const c of ["trust", "verify", "adopt", "watch --url"]) assert.ok(roles.get("Verifier")?.includes(c), c);
    for (const c of ["gate", "scan", "badge"]) assert.ok(roles.get("Operator")?.includes(c), c);
    assert.ok(roles.get("CI")?.some((l) => l.startsWith("init --workflow")));
    // every command is listed once, under one role
    const listed = [...roles.values()].flat().filter((c) => COMMANDS.includes(c));
    assert.deepEqual([...listed].sort(), [...COMMANDS].sort());
  }
  const one = run("help", "revoke");
  assert.equal(one.code, 0);
  assert.match(one.out, /^plumbline revoke: after a leak/);
  assert.match(one.out, /usage: plumbline revoke --root/);
  assert.equal(run("help", "nonsense").code, 2);
});

test("UAT-28: <command> --help (and -h) is that command's help on every command, never an unknown option", () => {
  for (const command of COMMANDS) {
    for (const flag of ["--help", "-h"]) {
      const r = run(command, flag);
      assert.equal(r.code, 0, `${command} ${flag}: ${r.err}`);
      assert.match(r.out, new RegExp(`^plumbline ${command}: `), command);
      assert.match(r.out, new RegExp(`usage: plumbline ${command}`), command);
      assert.match(r.out, /^Role: (Agent owner|Publisher|Verifier|Operator)/m, command);
      assert.equal(r.err, "", command);
    }
  }
  // after other options too
  assert.equal(run("watch", "--root", ".", "--help").code, 0);
  // an unknown command still exits 2, and points at the help
  const unknown = run("nonsense");
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /plumbline --help lists the commands by role/);
});

test("UAT-28 (PRI-L1-15): the scan is a CLI command, and the script under its old name answers --help too", () => {
  const script = path.join(REPO, "scripts", "scan-ecosystem.mjs");
  const help = spawnSyncNode([script, "--help"]);
  assert.equal(help.code, 0, help.err);
  assert.match(help.out, /plumbline scan: a portfolio report/);
  assert.match(help.out, /usage: node scripts\/scan-ecosystem\.mjs/);
  const bare = run("scan");
  assert.equal(bare.code, 2);
  assert.match(bare.err, /usage: plumbline scan <list file> --out <dir>/);
});

test("UAT-28 (PRI-L2-4): a clean watch says no drift even when info notes follow; an http address names --allow-local", async () => {
  const root = mkdtempSync(path.join(tmp, "clean-"));
  writeSite(root);
  assert.notEqual((await runAsync("init", "--root", root)).code, 2);
  // the only finding is an info: the upstream check cannot be asked here (no network)
  const clean = await runAsync("watch", "--root", root);
  assert.equal(clean.code, 0, clean.out + clean.err);
  assert.match(clean.out, /^watch: no drift \(nothing at warn or block\); \d+ notes? follows?$/m);
  assert.match(clean.out, /^info /m);

  const url = await runAsync("watch", "--url", `${server.url}/`);
  assert.equal(url.code, 1);
  assert.match(url.out, /the address is not https/);
  assert.match(url.err, /note: an http address is refused without --allow-local; for a site on this machine \(localhost, \*\.localhost, 127\.0\.0\.1\), run it again with --allow-local/);
  const gate = await runAsync("gate", `${server.url}/`, "--adapters", "validator");
  assert.match(gate.err, /run it again with --allow-local/);
  const withFlag = await runAsync("watch", "--url", `${server.url}/`, "--allow-local");
  assert.doesNotMatch(withFlag.err, /note: an http address/);
  const listFile = path.join(tmp, "http-list.txt");
  writeFileSync(listFile, `${server.url}/\n`);
  const scan = await runAsync("scan", listFile, "--out", path.join(tmp, "http-scan"));
  assert.equal(scan.code, 2);
  assert.match(scan.err, /for sites on this machine \(localhost, \*\.localhost, 127\.0\.0\.1\), add --allow-local/);
});

test("UAT-28 (DEV-L2-2): GitHub's rate-limit reset is said as a UTC time, never as an epoch", () => {
  assert.equal(resetWords("1794929636"), " until 2026-11-17 15:33:56 UTC");
  assert.equal(resetWords(undefined), "");
  assert.equal(resetWords("soon"), "", "a header that is not a number of seconds is left out");
  assert.equal(resetWords("99999999999"), "");
});

test("UAT-28 (PRI-L1-13): init refuses Plumbline's own Desk, and writes nothing into the tool's checkout", () => {
  const cwd = mkdtempSync(path.join(tmp, "cwd-"));
  const r = spawnSyncNode([CLI, "init", "--root", path.join(REPO, "site"), "--json"], cwd);
  assert.equal(r.code, 2);
  assert.match(r.err, /--root names Plumbline's own Desk \(site\/ in the Plumbline clone\), not your site: run init from your site repository's root/);
  assert.deepEqual(readdirSync(cwd), []);
});

/** Runs node synchronously with the no-network preload (a script, or the CLI in another folder). */
function spawnSyncNode(args: string[], cwd?: string): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, ...args], { encoding: "utf8", ...(cwd !== undefined ? { cwd } : {}) });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ---- MC-3: the README's "Use it" runs as printed -------------------------------------------------------------------

interface Block {
  heading: string;
  lines: string[];
}

/** The sh blocks under "## Use it", each with the `###` heading it sits under. */
function readmeBlocks(): Block[] {
  const text = readFileSync(path.join(REPO, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("## Use it");
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end);
  const blocks: Block[] = [];
  let heading = "";
  let inBlock: string[] | undefined;
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) heading = line.slice(4);
    else if (line === "```sh") inBlock = [];
    else if (line === "```" && inBlock) {
      blocks.push({ heading, lines: inBlock });
      inBlock = undefined;
    } else if (inBlock) inBlock.push(line);
  }
  return blocks;
}

/** Runs one README command line through the built CLI, as `plumbline` would after `npm link`, in `cwd`. */
function runLine(line: string, cwd: string, site: string): Promise<{ code: number | null; out: string; err: string }> {
  const words = line.split(/\s+/).filter(Boolean);
  // the documented substitution: the placeholder addresses become the loopback copy, with the flag the README names
  const placeholders = /^https:\/\/(your-site|partner)\.example\/?$/;
  const local = words.some((w) => placeholders.test(w));
  const args = words.slice(1).map((w) => (placeholders.test(w) ? (w.endsWith("/") ? `${site}/` : site) : w));
  const fetches = ["gate", "trust", "verify", "watch", "adopt", "scan"].includes(args[0] as string);
  // the scan reads its addresses from the list, which holds the loopback copy too
  if ((local && fetches) || args[0] === "scan") args.push("--allow-local");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, CLI, ...args], { cwd });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

/** `mkdir -p <dir> && cp <file> <dir>/` and `cp <file> <dir>/`, the two shell lines the README uses, done in `cwd`. */
function shellLine(line: string, cwd: string): void {
  for (const part of line.split("&&").map((p) => p.trim())) {
    const words = part.split(/\s+/);
    if (words[0] === "mkdir" && words[1] === "-p") mkdirSync(path.join(cwd, words[2] as string), { recursive: true });
    else if (words[0] === "cp" && words.length === 3) {
      const from = path.join(cwd, words[1] as string);
      const to = path.join(cwd, words[2] as string);
      copyFileSync(from, (words[2] as string).endsWith("/") ? path.join(to, path.basename(from)) : to);
    } else assert.fail(`the README uses a shell line this test does not run: ${part}`);
  }
}

test("UAT-28 (MC-3): every command in the README's Use it runs as printed, from the folder its block names", async () => {
  const blocks = readmeBlocks();
  assert.deepEqual(
    blocks.map((b) => b.heading),
    ["Install, once (Node 22 or later)", "The quickest first result: gate one address", "Publisher: publish and watch your own site", "Publisher: publish and watch your own site", "Verifier: check a partner or a stranger", "Operator: run a portfolio", "The bad day: your signing key leaked"],
  );
  // the folders the blocks name: a site repository (with ../ beside it for the keys) and any other folder
  const work = mkdtempSync(path.join(tmp, "readme-"));
  const repo = path.join(work, "repo");
  const anywhere = path.join(work, "anywhere");
  mkdirSync(path.join(repo, "site"), { recursive: true });
  mkdirSync(anywhere);
  writeSite(path.join(repo, "site"));
  servedRoot = path.join(repo, "site");
  const site = server.url;
  writeFileSync(path.join(anywhere, "sites.txt"), "https://your-site.example/\n".replace("https://your-site.example/", `${site}/`));

  const ran: string[] = [];
  for (const block of blocks) {
    if (block.heading.startsWith("Install")) {
      // the install block is clone, npm ci, npm link: run by the live rehearsal, not here; its last line is the help
      assert.deepEqual(block.lines.map((l) => l.split(/\s+#/)[0]?.trim()), ["git clone https://github.com/xkazm04/plumbline.git", "cd plumbline", "npm ci", "npm link", "plumbline --help"]);
      continue;
    }
    const cwd = block.heading.startsWith("Publisher") || block.heading.startsWith("The bad day") ? repo : anywhere;
    for (const raw of block.lines) {
      const line = raw.replace(/\s{2,}#.*$/, "").trim();
      if (line === "" || line.startsWith("#")) continue;
      if (!line.startsWith("plumbline ")) {
        shellLine(line, cwd);
        continue;
      }
      const command = line.split(/\s+/)[1] as string;
      assert.ok(COMMANDS.includes(command), `${line}: ${command} is a command`);
      const r = await runLine(line, cwd, site);
      ran.push(`${r.code} ${line}`);
      // as printed: never a usage or I/O error; the first trust adds nothing (exit 1), as its comment says
      assert.notEqual(r.code, 2, `${line}\n${r.out}\n${r.err}`);
      if (/^plumbline trust .*--yes$/.test(line) || /^plumbline (init|keygen|sign|revoke|dns) /.test(line)) assert.equal(r.code, 0, `${line}\n${r.out}\n${r.err}`);
      if (/^plumbline trust /.test(line) && !line.endsWith("--yes")) assert.equal(r.code, 1, `${line}\n${r.out}`);
      if (/^plumbline watch --root site$/.test(line)) assert.match(r.out, /^watch: no drift/m, `${line} (exit ${r.code})\nstdout: ${r.out}\nstderr: ${r.err}`);
      if (/^plumbline verify /.test(line)) assert.match(r.out, /verified/, `${line} (exit ${r.code})\nstdout: ${r.out}\nstderr: ${r.err}`);
      if (/^plumbline scan /.test(line)) assert.ok(existsSync(path.join(anywhere, "scan-report", "report.html")));
    }
  }
  // the blocks wrote what they say
  assert.ok(existsSync(path.join(repo, "site", "plumbline.lock.json")));
  assert.ok(existsSync(path.join(repo, ".github", "workflows", "plumbline-watch.yml")));
  assert.ok(existsSync(path.join(work, "plumbline-keys", "plumbline.private.json")), "the key is outside the repository");
  assert.ok(existsSync(path.join(repo, "site", "plumbline-revocation.json")));
  assert.ok(ran.length >= 14, ran.join("\n"));
});
