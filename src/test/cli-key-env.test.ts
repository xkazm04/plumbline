// D10: `sign --key-env <NAME>`: the private key file's JSON from an environment variable (a CI secret). It must never
// reach stdout, stderr, the signature, a report or the disk; a refusal names the variable, never its content.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
const ORIGIN = "https://site.example";
let tmp: string;
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "plumbline-key-env-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(env: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Every file under a folder, relative. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]));
}

test("sign --key-env signs with the key from the environment, which reaches no output, no file and no report", () => {
  const keys = path.join(tmp, "keys");
  assert.equal(run({}, "keygen", "--out", keys).code, 0);
  const keyText = readFileSync(path.join(keys, "plumbline.private.json"), "utf8");
  const secret = (JSON.parse(keyText) as { privateKey: string }).privateKey;
  rmSync(path.join(keys, "plumbline.private.json")); // the key now lives only in the environment
  const site = path.join(tmp, "site");
  mkdirSync(site);
  writeFileSync(path.join(site, "agent-manifest.json"), '{"networks":[]}');
  const before = filesUnder(tmp).sort();

  for (const json of [false, true]) {
    const r = run({ PLUMBLINE_SIGNING_KEY: keyText }, "sign", "--root", site, "--key-env", "PLUMBLINE_SIGNING_KEY", "--origin", ORIGIN, ...(json ? ["--json"] : []));
    assert.equal(r.code, 0, r.err);
    for (const text of [r.out, r.err, readFileSync(path.join(site, "plumbline.signature.json"), "utf8")]) {
      assert.ok(!text.includes(secret), "the private key never appears");
      assert.ok(!text.includes(secret.slice(10, 40)), "not even a part of it");
    }
    if (json) {
      const report = JSON.parse(r.out) as { keyFrom: string; custody: string[] };
      assert.equal(report.keyFrom, "env");
      assert.match(report.custody.join(" "), /CI's secret store/);
    } else {
      assert.match(r.out, /^NOTE: The signing key came from the environment: keep it in the CI's secret store/m);
    }
  }
  // nothing was written but the signature: no key file, no temporary copy
  assert.deepEqual(filesUnder(tmp).sort(), [...before, "site/plumbline.signature.json"].sort());

  // the signature verifies under the key's record, as one made from the file would
  const record = JSON.parse(readFileSync(path.join(keys, ".well-known", "plumbline-key.json"), "utf8")) as { kid: string; publicKey: string };
  const trust = path.join(tmp, "plumbline.trust.json");
  writeFileSync(trust, JSON.stringify({ version: 1, entries: [{ kid: record.kid, origin: ORIGIN, publicKey: record.publicKey }] }));
  assert.equal(run({}, "verify", "--root", site, "--trust", trust, "--origin", ORIGIN).code, 0);
});

test("sign --key-env refuses an unset, empty or malformed variable by its name, never quoting what it holds", () => {
  const site = path.join(tmp, "site-refuse");
  mkdirSync(site);
  writeFileSync(path.join(site, "agent-manifest.json"), '{"networks":[]}');
  const garbage = "s3cr3t-not-a-key-0123456789";
  const cases: [Record<string, string>, string[], RegExp, number][] = [
    [{}, ["--key-env", "PLUMBLINE_UNSET_FOR_TEST"], /PLUMBLINE_UNSET_FOR_TEST is not set or is empty/, 2],
    [{ PLUMBLINE_K: "  " }, ["--key-env", "PLUMBLINE_K"], /PLUMBLINE_K is not set or is empty/, 2],
    [{ PLUMBLINE_K: garbage }, ["--key-env", "PLUMBLINE_K"], /PLUMBLINE_K does not hold a Plumbline private key file \(it is not JSON\)/, 2],
    [{ PLUMBLINE_K: JSON.stringify({ privateKey: garbage }) }, ["--key-env", "PLUMBLINE_K"], /PLUMBLINE_K does not hold a Plumbline private key file$/m, 2],
    [{}, ["--key-env", "bad name"], /--key-env takes the NAME of an environment variable/, 2],
    [{}, ["--key", "k.json", "--key-env", "X"], /give exactly one of --key and --key-env/, 2],
    [{}, [], /give exactly one of --key and --key-env/, 2],
  ];
  for (const [env, args, message, code] of cases) {
    const r = run(env, "sign", "--root", site, "--origin", ORIGIN, ...args);
    assert.equal(r.code, code, args.join(" "));
    assert.match(r.err, message, args.join(" "));
    assert.ok(!r.err.includes(garbage) && !r.out.includes(garbage), "the variable's content is never printed");
  }
});
