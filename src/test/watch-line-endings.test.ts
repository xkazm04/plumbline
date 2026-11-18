// UAT-13 (DEV-L2-1): line endings are not "different facts". The lock hashes exact bytes (guardrail 11): a file that
// differs in line endings only is still a finding with its severity, but it says what the difference is; and a lock
// written from CRLF bytes is warned about at capture, naming the .gitattributes line. No network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sha256Hex } from "../core/canonical.js";
import { LF_PIN_LINE, lineEndingWarning, lfPinned } from "../watch/capture.js";
import { groundingFinding, lineEndingChange, runtimeFinding } from "../watch/decide.js";
import { copySite } from "./net-helpers.js";
import { baseRoutes, ofKind, watch } from "./watch-helpers.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const scratch: string[] = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function repoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-eol-"));
  scratch.push(dir);
  mkdirSync(join(dir, ".git")); // bounds the .gitattributes walk at this folder
  return dir;
}

test("lineEndingChange: CRLF where the locked copy had LF, the reverse, and anything else is null", async () => {
  const lf = "a\nb\nc\n";
  const crlf = "a\r\nb\r\nc\r\n";
  assert.equal(await lineEndingChange(bytes(crlf), await sha256Hex(bytes(lf))), "crlf");
  assert.equal(await lineEndingChange(bytes(lf), await sha256Hex(bytes(crlf))), "lf");
  assert.equal(await lineEndingChange(bytes("a\r\nb\r\nX\r\n"), await sha256Hex(bytes(lf))), null, "another byte differs too");
  assert.equal(await lineEndingChange(bytes("abc"), await sha256Hex(bytes("abd"))), null, "no line ending at all");
});

test("a grounding or runtime file that differs in line endings only says so, with its severity, never 'different facts'", () => {
  const seen = { ok: true as const, sha256: "b".repeat(64) };
  const g = groundingFinding({ ref: "agent-manifest.json", sha256: "a".repeat(64) }, seen, undefined, "agent", "lf");
  assert.equal(g?.severity, "warn");
  assert.match(g?.summary ?? "", /^A grounding source changed since the lock was written, in line endings only: it now ends its lines with LF where the locked copy had CRLF, and no other byte differs\./);
  assert.match(g?.summary ?? "", /`\* text=auto eol=lf` in \.gitattributes/);
  assert.doesNotMatch(g?.summary ?? "", /different facts/);
  const r = runtimeFinding("runtime/engine.js", "a".repeat(64), seen, "crlf");
  assert.equal(r?.severity, "block", "the runtime stays copy-do-not-change: exact bytes, same severity");
  assert.match(r?.summary ?? "", /^A vendored runtime file differs from the locked copy in line endings only: it now ends its lines with CRLF where the locked copy had LF/);
});

test("the watch of a checkout: a network file checked out with CRLF reads as line endings only; a real edit still reads as different facts", async () => {
  const root = copySite();
  assert.deepEqual((await watch(root, baseRoutes(), { init: true })).findings, []);
  const net = join(root, "fixture_guesthouse.network.json");
  const original = readFileSync(net, "utf8");
  writeFileSync(net, original.replace(/\n/g, "\r\n"));
  writeFileSync(join(root, "runtime/engine.js"), readFileSync(join(root, "runtime/engine.js"), "utf8").replace(/\n/g, "\r\n"));
  const { findings } = await watch(root, baseRoutes());
  const grounding = ofKind(findings, "grounding").find((f) => f.ref === "fixture_guesthouse.network.json");
  assert.match(grounding?.summary ?? "", /in line endings only: it now ends its lines with CRLF where the locked copy had LF/);
  assert.doesNotMatch(grounding?.summary ?? "", /different facts/);
  assert.equal(grounding?.severity, "warn");
  const runtime = ofKind(findings, "runtime");
  assert.deepEqual(runtime.map((f) => [f.severity, f.ref]), [["block", "runtime/engine.js"]]);
  assert.match(runtime[0]?.summary ?? "", /in line endings only/);
  // a real edit, in CRLF or not, is not "line endings only"
  writeFileSync(net, original.replace(/\n/g, "\r\n").replace("}", ' , "x": 1 }'));
  const edited = ofKind((await watch(root, baseRoutes())).findings, "grounding").find((f) => f.ref === "fixture_guesthouse.network.json");
  assert.doesNotMatch(edited?.summary ?? "", /line endings/);
});

test("capture: files locked with CRLF are a warning that names the .gitattributes line; a pin changes the advice; LF files are not", async () => {
  const root = repoDir();
  writeFileSync(join(root, "a.json"), "{\r\n}\r\n");
  writeFileSync(join(root, "b.json"), "{\n}\n");
  const warned = await lineEndingWarning(root, ["a.json", "b.json"]);
  assert.equal(warned?.severity, "warn");
  assert.equal(warned?.ref, ".gitattributes");
  assert.match(warned?.summary ?? "", /^1 of the 2 files this lock hashes end their lines with CRLF \(a\.json\), and no \.gitattributes pins LF\./);
  assert.ok(warned?.summary.includes(`Add the line "${LF_PIN_LINE}" to .gitattributes at the repository root`), warned?.summary);
  assert.equal(await lineEndingWarning(root, ["b.json"]), null);
  writeFileSync(join(root, ".gitattributes"), "*.png binary\n* text=auto eol=lf\n");
  assert.equal(await lfPinned(root), true);
  assert.match((await lineEndingWarning(root, ["a.json"]))?.summary ?? "", /although \.gitattributes pins LF: they were checked out before the pin/);
  writeFileSync(join(root, ".gitattributes"), "*.json text\n");
  assert.equal(await lfPinned(root), false, "a pin for some files only is not a pin for all");
});

test("DEV-L2-1: init in a Git checkout made with core.autocrlf=true and no LF pin warns and names the .gitattributes line", async (t) => {
  let git: (cwd: string, ...args: string[]) => string;
  try {
    execFileSync("git", ["--version"], { encoding: "utf8" });
    git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" });
  } catch {
    t.skip("git is not installed");
    return;
  }
  const origin = repoDir();
  rmSync(join(origin, ".git"), { recursive: true });
  git(origin, "init", "-q");
  git(origin, "config", "core.autocrlf", "false");
  const site = copySite();
  for (const name of ["agent-manifest.json", "fixture_guesthouse.network.json", "links.json"]) writeFileSync(join(origin, name), readFileSync(join(site, name)));
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "site");
  const parent = mkdtempSync(join(tmpdir(), "plumbline-eol-clone-"));
  scratch.push(parent);
  git(parent, "-c", "core.autocrlf=true", "clone", "-q", origin, "checkout");
  const checkout = join(parent, "checkout");
  assert.match(readFileSync(join(checkout, "agent-manifest.json"), "utf8"), /\r\n/, "the checkout converted LF to CRLF");
  const { findings } = await watch(checkout, baseRoutes(), { init: true });
  const warned = findings.find((f) => f.ref === ".gitattributes");
  assert.equal(warned?.severity, "warn", JSON.stringify(findings));
  assert.match(warned?.summary ?? "", /end their lines with CRLF .*, and no \.gitattributes pins LF\./);
  assert.ok(warned?.summary.includes(LF_PIN_LINE));
});
