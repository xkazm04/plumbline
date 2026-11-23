// The declared files under the text rule (src/agent/text-hash.ts, build.ts hashDeclaredFiles, check-files.ts): a CRLF
// working tree and an LF checkout lock the same; a file with a NUL byte is exact; a version 1 lock is still checked by
// exact bytes and its first version 2 relock reports re-hashed files, not changed ones.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Hex } from "../core/canonical.js";
import { AGENT_FILE, AGENT_LOCK_FILE, AGENT_LOCK_TYPE, type AgentLock, type AgentReport } from "../core/types.js";
import { buildLock, lockText } from "../agent/build.js";
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
