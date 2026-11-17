// Shared helpers for the signing CLI's end-to-end tests: a temp dir under the OS temp folder, the built CLI run as a
// child process, a fixture site, keys made by keygen and a trust file. No network, no key ever written into the repo.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlumblineKey, TrustEntry } from "../core/index.js";

// dist/test/cli-helpers.js -> dist/cli/index.js
export const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));
/** Preloaded into every spawned CLI: any name lookup fails, so nothing here can reach the internet. */
export const NO_NETWORK = new URL("./no-network.js", import.meta.url).href;
export const ORIGIN = "https://site.example";

export interface Run {
  code: number | null;
  out: string;
  err: string;
}

/** Runs the CLI and waits. Do not use it against a server in this process: the child would wait on a blocked loop. */
export function run(...args: string[]): Run {
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Runs the CLI without blocking this process, so a loopback server in this process can answer it. */
export function runAsync(...args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, CLI, ...args]);
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

const scratch: string[] = [];
process.on("exit", () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A fresh scratch folder, removed when the test process exits. */
export function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plumbline-cli-"));
  scratch.push(dir);
  return dir;
}

export function writeSite(dir: string): void {
  mkdirSync(path.join(dir, "networks"), { recursive: true });
  writeFileSync(path.join(dir, "agent-manifest.json"), JSON.stringify({ name: "Fixture", networks: [{ hocon: "networks/helper.hocon" }] }));
  writeFileSync(path.join(dir, "networks", "helper.hocon"), JSON.stringify({ agents: [{ name: "helper", tools: ["a"] }] }));
  writeFileSync(path.join(dir, "links.json"), JSON.stringify({ links: [{ href: "https://site.example/docs" }] }));
}

export interface Keys {
  dir: string;
  privateFile: string;
  recordFile: string;
  record: PlumblineKey;
}

export function keygen(dir: string): Keys {
  const r = run("keygen", "--out", dir);
  if (r.code !== 0) throw new Error(`keygen failed: ${r.err}`);
  const recordFile = path.join(dir, ".well-known", "plumbline-key.json");
  return { dir, privateFile: path.join(dir, "plumbline.private.json"), recordFile, record: JSON.parse(readFileSync(recordFile, "utf8")) as PlumblineKey };
}

export function writeTrust(file: string, entries: TrustEntry[], extra: Record<string, unknown> = {}): string {
  writeFileSync(file, JSON.stringify({ version: 1, ...extra, entries }, null, 2));
  return file;
}

export function readTrust(file: string): { version: number; entries: (TrustEntry & Record<string, unknown>)[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8"));
}
