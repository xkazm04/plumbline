// The declared files (src/agent/text-hash.ts, discover.ts walk, build.ts hashDeclaredFiles, check-files.ts): the text
// rule (a CRLF working tree and an LF checkout lock the same; a file with a NUL byte is exact; a version 1 lock is still
// checked by exact bytes and its first version 2 relock reports re-hashed files, not changed ones), and links (followed,
// recorded by path, never by target; a cycle and the walk bound refused; an absent link is `link-absent`, not removed).
//
// Links: a Windows junction needs no privilege, so every link test has a junction form that runs everywhere (on POSIX
// `symlinkSync(..., "junction")` makes an ordinary symbolic link). A symbolic link to a file or a folder needs a
// privilege on Windows (Developer Mode or an elevated shell); those two tests skip on Windows only when creating the link
// is refused with EPERM. A file cannot be a junction, so the file link has no junction form.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../core/canonical.js";
import { AGENT_FILE, AGENT_LOCK_FILE, AGENT_LOCK_TYPE, type AgentLock, type AgentReport } from "../core/types.js";
import { CliError } from "../cli/args.js";
import { buildLock, lockText } from "../agent/build.js";
import { matchFiles, MAX_DECLARED_FILES } from "../agent/discover.js";
import { parseAgentLock, parseDeclaration } from "../agent/lock.js";
import { declaredFileHash, textLfBytes } from "../agent/text-hash.js";
import { agent, json, read, repo, spy, write } from "./agent-helpers.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const locked = (dir: string): AgentLock => JSON.parse(read(dir, AGENT_LOCK_FILE)) as AgentLock;
const crlf = (s: string): string => s.replace(/\n/g, "\r\n");

/** A binary file: holds a NUL byte, and a CRLF that must not be read as LF. */
const BINARY = "PNG\0\r\n\x1a\r\n";

/** The same tree as text: every text file with LF, or with CRLF (a Windows working tree under core.autocrlf). */
function tree(eol: "lf" | "crlf"): Record<string, string> {
  const t = (s: string): string => (eol === "crlf" ? crlf(s) : s);
  return {
    "CLAUDE.md": t("# rules\nbe careful\n"),
    ".claude/skills/review/SKILL.md": t("---\nname: review\n---\nRead the diff.\n"),
    ".claude/skills/review/logo.bin": BINARY,
    ".claude/settings.json": t(json({ model: "claude-opus-5-5" }) + "\n"),
  };
}

async function check(dir: string): Promise<AgentReport> {
  const { out } = await agent(spy().deps, "check", "--root", dir, "--json", "--offline");
  return JSON.parse(out) as AgentReport;
}

/** The file and link findings of a report, as `severity code ref`. */
const fileCodes = (r: AgentReport): string[] => r.findings.filter((f) => f.code.startsWith("file-") || f.code === "link-absent").map((f) => `${f.severity} ${f.code} ${f.ref}`);

/** A junction (a symbolic link on POSIX) at `at` (repository-relative) to the folder `target`. */
function junction(dir: string, at: string, target: string): void {
  const full = path.join(dir, ...at.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  symlinkSync(target, full, "junction");
}

/** A symbolic link, or undefined when Windows refuses it for want of the privilege (EPERM). */
function trySymlink(target: string, at: string, type: "file" | "dir"): true | undefined {
  try {
    symlinkSync(target, at, type);
    return true;
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return undefined;
    throw error;
  }
}

// ---- the text rule ----

test("text rule: CRLF reads as LF; a lone CR is kept; a file with a NUL byte is exact; no rule is exact", async () => {
  assert.equal(await declaredFileHash(enc("a\r\nb\r\n"), "text-lf"), await sha256Hex("a\nb\n"));
  assert.equal(await declaredFileHash(enc("a\rb\r\r\n"), "text-lf"), await sha256Hex("a\rb\r\n"));
  assert.equal(await declaredFileHash(enc("a\r\n\0"), "text-lf"), await sha256Hex(enc("a\r\n\0")));
  assert.equal(await declaredFileHash(enc("a\r\nb"), undefined), await sha256Hex("a\r\nb"));
  const lf = enc("no change\n");
  assert.equal(textLfBytes(lf), lf, "bytes without a CRLF are not copied");
});

test("a CRLF working tree and an LF checkout of the same files produce byte-identical version 2 locks; a NUL file is exact in both", async () => {
  const windows = repo(tree("crlf"));
  const linux = repo(tree("lf"));
  for (const dir of [windows, linux]) assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  assert.equal(read(windows, AGENT_FILE), read(linux, AGENT_FILE));
  assert.equal(read(windows, AGENT_LOCK_FILE), read(linux, AGENT_LOCK_FILE));
  const lock = locked(windows);
  assert.equal(lock.version, 2);
  assert.equal(lock.hashing, "text-lf");
  assert.equal(lock.links, undefined, "no link followed: links is omitted");
  assert.deepEqual(Object.keys(lock.files), [".claude/settings.json", ".claude/skills/review/SKILL.md", ".claude/skills/review/logo.bin", "CLAUDE.md"]);
  assert.equal(lock.files["CLAUDE.md"], await sha256Hex("# rules\nbe careful\n"));
  assert.equal(lock.files[".claude/skills/review/logo.bin"], await sha256Hex(enc(BINARY)), "a file with a NUL byte is hashed exactly");
  assert.equal(parseAgentLock(read(windows, AGENT_LOCK_FILE)).ok, true);
});

test("check on a version 2 lock: only line endings differ -> no file-changed; a real change still blocks", async () => {
  const dir = repo(tree("crlf"));
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  write(dir, tree("lf")); // the same commit checked out on Linux
  assert.deepEqual(fileCodes(await check(dir)), []);
  write(dir, { ".claude/skills/review/logo.bin": "PNG\0\n\x1a\n" }); // a binary file's CRLF is content
  write(dir, { "CLAUDE.md": "# rules\nbe reckless\n" });
  assert.deepEqual(fileCodes(await check(dir)), ["block file-changed .claude/skills/review/logo.bin", "block file-changed CLAUDE.md"]);
});

/** A version 1 lock of `dir` as it is now: exact bytes, no hashing, no links (as a 2026-11-21 build wrote it). */
async function v1Lock(dir: string): Promise<AgentLock> {
  const files: Record<string, string> = {};
  for (const rel of Object.keys(locked(dir).files)) files[rel] = await sha256Hex(enc(read(dir, rel)));
  const lock: AgentLock = { type: AGENT_LOCK_TYPE, version: 1, declaration: await sha256Hex(enc(read(dir, AGENT_FILE))), files, lockedAt: "2026-11-21T10:00:00.000Z" };
  write(dir, { [AGENT_LOCK_FILE]: lockText(lock) });
  return lock;
}

test("a version 1 lock is checked by exact bytes: clean as written, a line-ending change is file-changed", async () => {
  const dir = repo(tree("crlf"));
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  await v1Lock(dir);
  assert.deepEqual(fileCodes(await check(dir)), []);
  write(dir, { "CLAUDE.md": "# rules\nbe careful\n" });
  assert.deepEqual(fileCodes(await check(dir)), ["block file-changed CLAUDE.md"]);
});

test("the first version 2 relock of a version 1 lock: CRLF files are re-hashed, not changed; a real change is changed", async () => {
  const dir = repo(tree("crlf"));
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  const v1 = await v1Lock(dir);
  write(dir, { ".claude/skills/review/SKILL.md": crlf("---\nname: review\n---\nRead the diff twice.\n") });
  const declarationText = read(dir, AGENT_FILE);
  const declaration = parseDeclaration(declarationText);
  assert.ok(declaration.ok);
  const lockBytes = enc(read(dir, AGENT_LOCK_FILE));
  const built = await buildLock(dir, declaration.value, enc(declarationText), spy().deps, { lock: v1, bytes: lockBytes });
  assert.equal(built.lock.version, 2);
  assert.equal(built.lock.hashing, "text-lf");
  assert.equal(built.lock.previous, await sha256Hex(lockBytes));
  // CLAUDE.md and settings.json held CRLF: their hash moved with the rule, their contents did not. logo.bin (a NUL) and
  // nothing else kept its exact hash, so it is in neither list.
  assert.deepEqual(built.rehashed, [".claude/settings.json", "CLAUDE.md"]);
  const changed = Object.keys(built.lock.files).filter((k) => v1.files[k] !== built.lock.files[k] && !built.rehashed.includes(k));
  assert.deepEqual(changed, [".claude/skills/review/SKILL.md"]);
  // a version 2 lock replaced by another: nothing is re-hashed
  const again = await buildLock(dir, declaration.value, enc(declarationText), spy().deps, { lock: built.lock, bytes: enc(lockText(built.lock)) });
  assert.deepEqual(again.rehashed, []);
  // the relock command writes the version 2 lock
  assert.equal((await agent(spy().deps, "relock", "--root", dir)).code, 0);
  assert.equal(locked(dir).version, 2);
  assert.equal(locked(dir).hashing, "text-lf");
});

// ---- links ----

/** A shared registry outside the repository: two skills, one with a nested folder. */
function registry(): string {
  return repo({ "skill-x/SKILL.md": "x\n", "skill-x/refs/notes.md": "notes\n", "skill-y/SKILL.md": "y\n" });
}

test("a junction under a declared glob is followed: its files sit under the link's path, links lists it, the target is never written", async () => {
  const reg = registry();
  const dir = repo({ "CLAUDE.md": "# rules\n", ".claude/skills/own/SKILL.md": "own\n" });
  junction(dir, ".claude/skills/x", path.join(reg, "skill-x"));
  junction(dir, ".claude/skills/y", path.join(reg, "skill-y"));
  const { code, out } = await agent(spy().deps, "init", "--root", dir);
  assert.equal(code, 0);
  const lock = locked(dir);
  assert.deepEqual(Object.keys(lock.files), [".claude/skills/own/SKILL.md", ".claude/skills/x/SKILL.md", ".claude/skills/x/refs/notes.md", ".claude/skills/y/SKILL.md", "CLAUDE.md"]);
  assert.deepEqual(lock.links, [".claude/skills/x", ".claude/skills/y"]);
  assert.match(out, /3 files through 2 links/);
  const text = read(dir, AGENT_LOCK_FILE);
  for (const needle of [reg, JSON.stringify(reg).slice(1, -1), path.basename(reg), "skill-x", "skill-y"]) assert.equal(text.includes(needle), false, `the lock holds ${needle}`);
  assert.equal(parseAgentLock(text).ok, true);
  assert.deepEqual(fileCodes(await check(dir)), []);
});

test("a default folder that is itself a junction is declared and followed; a link in a glob's literal prefix is recorded", async () => {
  const reg = registry();
  const dir = repo({ "CLAUDE.md": "# rules\n" });
  junction(dir, ".claude/skills", reg);
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  const declaration = JSON.parse(read(dir, AGENT_FILE)) as { files: string[] };
  assert.ok(declaration.files.includes(".claude/skills/**"));
  const lock = locked(dir);
  assert.deepEqual(lock.links, [".claude/skills"]);
  assert.ok(Object.hasOwn(lock.files, ".claude/skills/skill-y/SKILL.md"));
});

test("a symbolic link to a folder is followed like a junction", async (t) => {
  const reg = registry();
  const dir = repo({ "CLAUDE.md": "# rules\n", ".claude/skills/own/SKILL.md": "own\n" });
  if (trySymlink(path.join(reg, "skill-y"), path.join(dir, ".claude", "skills", "y"), "dir") === undefined) {
    t.skip("Windows refused a folder symbolic link (EPERM: no Developer Mode or elevation); the junction tests cover following a folder link");
    return;
  }
  const matched = await matchFiles(dir, [".claude/skills/**"]);
  assert.deepEqual(matched.paths, [".claude/skills/own/SKILL.md", ".claude/skills/y/SKILL.md"]);
  assert.deepEqual(matched.links, [".claude/skills/y"]);
});

test("a symbolic link to a file is followed, by a glob and by a literal file name", async (t) => {
  const reg = registry();
  const dir = repo({ ".claude/skills/own/SKILL.md": "own\n" });
  if (trySymlink(path.join(reg, "skill-x", "SKILL.md"), path.join(dir, "CLAUDE.md"), "file") === undefined) {
    t.skip("Windows refused a file symbolic link (EPERM: no Developer Mode or elevation); a file cannot be a junction, so there is no junction form");
    return;
  }
  trySymlink(path.join(reg, "skill-y", "SKILL.md"), path.join(dir, ".claude", "skills", "own", "linked.md"), "file");
  const matched = await matchFiles(dir, ["CLAUDE.md", ".claude/skills/**"]);
  assert.deepEqual(matched.paths, [".claude/skills/own/SKILL.md", ".claude/skills/own/linked.md", "CLAUDE.md"]);
  assert.deepEqual(matched.links, [".claude/skills/own/linked.md", "CLAUDE.md"]);
});

test("links outside a declared glob's reach are not followed, and a link that leads to no locked file is not recorded", async () => {
  const reg = registry();
  const dir = repo({ "CLAUDE.md": "# rules\n", "docs/a.md": "a\n" });
  junction(dir, "vendor/skills", reg); // outside every glob
  junction(dir, "docs/linked", path.join(reg, "skill-x")); // reached by docs/*.md's walk, but holds no file it matches
  const matched = await matchFiles(dir, ["CLAUDE.md", "docs/*.md"]);
  assert.deepEqual(matched.paths, ["CLAUDE.md", "docs/a.md"]);
  assert.deepEqual(matched.links, []);
});

test("a link to a folder that holds it is a cycle: refused with a sentence, not followed forever", async () => {
  const dir = repo({ "CLAUDE.md": "# rules\n", ".claude/skills/own/SKILL.md": "own\n" });
  junction(dir, ".claude/skills/own/loop", path.join(dir, ".claude"));
  await assert.rejects(agent(spy().deps, "init", "--root", dir), (e: unknown) => e instanceof CliError && /^\.claude\/skills\/own\/loop is a link to a folder that holds it, so following it would never end/.test(e.message));
  // to the repository itself, from a glob that starts at the root
  const top = repo({ "a.md": "a\n" });
  junction(top, "sub/up", top);
  await assert.rejects(matchFiles(top, ["**"]), (e: unknown) => e instanceof CliError && /^sub\/up is a link to a folder that holds it/.test(e.message));
});

test(`a walk over ${MAX_DECLARED_FILES} files is refused with a sentence naming the bound`, async () => {
  // 101 files reached through 100 links: 10,100 files, over the bound, with 101 files on disk
  const files: Record<string, string> = {};
  for (let i = 0; i < 101; i++) files[`f${i}.md`] = "x";
  const reg = repo(files);
  const dir = repo({ "CLAUDE.md": "# rules\n" });
  for (let i = 0; i < 100; i++) junction(dir, `.claude/skills/s${i}`, reg);
  await assert.rejects(matchFiles(dir, [".claude/skills/**"]), (e: unknown) => e instanceof CliError && e.message.includes(`more than ${MAX_DECLARED_FILES} files, the most one walk reads`));
});

test("a recorded link absent from the checkout is link-absent (warn), and its files are not reported removed", async () => {
  const reg = registry();
  const dir = repo({ "CLAUDE.md": "# rules\n" });
  junction(dir, ".claude/skills/x", path.join(reg, "skill-x"));
  junction(dir, ".claude/skills/y", path.join(reg, "skill-y"));
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  unlinkSync(path.join(dir, ".claude", "skills", "x")); // a CI checkout: the untracked link is not there
  const report = await check(dir);
  assert.deepEqual(fileCodes(report), ["warn link-absent .claude/skills/x"]);
  assert.equal(report.findings.find((f) => f.code === "link-absent")?.summary, "A link the lock records is not in the checkout, so the files under it were not checked.");
  // a dangling link (its target gone) is absent too
  rmSync(path.join(reg, "skill-y"), { recursive: true, force: true });
  assert.deepEqual(fileCodes(await check(dir)), ["warn link-absent .claude/skills/x", "warn link-absent .claude/skills/y"]);
});

test("a recorded link replaced by a real folder holding the same files is clean; a different file there is changed", async () => {
  const reg = registry();
  const dir = repo({ "CLAUDE.md": "# rules\n" });
  junction(dir, ".claude/skills/x", path.join(reg, "skill-x"));
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  unlinkSync(path.join(dir, ".claude", "skills", "x"));
  write(dir, { ".claude/skills/x/SKILL.md": "x\r\n", ".claude/skills/x/refs/notes.md": "notes\n" }); // vendored, CRLF on Windows
  assert.deepEqual(fileCodes(await check(dir)), []);
  write(dir, { ".claude/skills/x/SKILL.md": "x, edited\n" });
  assert.deepEqual(fileCodes(await check(dir)), ["block file-changed .claude/skills/x/SKILL.md"]);
});

test("an agent file reached through a link is locked by hash, but its model is not read into the declaration", async () => {
  const reg = repo({ "agents/helper.md": "---\nmodel: claude-opus-5-5\n---\nhelp\n" });
  const dir = repo({ ".claude/agents/own.md": "---\nmodel: claude-sonnet-5\n---\nown\n" });
  junction(dir, ".claude/agents/linked", path.join(reg, "agents"));
  assert.equal((await agent(spy().deps, "init", "--root", dir)).code, 0);
  const declaration = JSON.parse(read(dir, AGENT_FILE)) as { models?: Record<string, string> };
  assert.deepEqual(declaration.models, { own: "claude-sonnet-5" });
  assert.ok(Object.hasOwn(locked(dir).files, ".claude/agents/linked/helper.md"));
  // the agents folder itself a link: no model read from it either
  const top = repo({ "CLAUDE.md": "# rules\n" });
  junction(top, ".claude/agents", path.join(reg, "agents"));
  assert.equal((await agent(spy().deps, "init", "--root", top)).code, 0);
  assert.equal((JSON.parse(read(top, AGENT_FILE)) as { models?: unknown }).models, undefined);
  assert.deepEqual(locked(top).links, [".claude/agents"]);
});
