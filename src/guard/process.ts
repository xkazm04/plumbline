// The guard's I/O: spawn the server (no shell), split both directions into newline-delimited messages, feed them to
// the GuardFilter one at a time through one queue, write what it says, and end when the server ends. Node only.
//
// - A message (line) larger than GUARD_MAX_MESSAGE_BYTES from either side closes both sides with a stderr line: the
//   guard does not buffer without bound, and a cut message would be a different message.
// - A line that is not UTF-8 is a protocol error like one that is not JSON.
// - The host closing the guard's stdin closes the server's stdin; a server still running after a grace period is
//   stopped (the MCP stdio shutdown: close stdin, then SIGTERM, then SIGKILL).
// - Exit: the server's exit code (1 if a signal ended it); 1 when `--strict` stopped it or a message was too large;
//   2 when it could not be started.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { pendingFor } from "../agent/pending.js";
import type { GuardAction, GuardFilter } from "./filter.js";
import { resolveCommand } from "./spawn.js";

/**
 * The largest single JSON-RPC message (one line) the guard relays, in bytes. Provisional: the existing ceiling's
 * derivation (MAX_BODY_BYTES in src/net/fetch-types.ts: the largest network definition measured, 41,156 bytes, x10,
 * rounded up to 512 KiB) until WP1's recorded tools/list fixtures exist; the Director re-derives it from the larger
 * recorded tools/list body x10 and writes that derivation here.
 */
export const GUARD_MAX_MESSAGE_BYTES = 524_288;

/** How long a server may run after its stdin closed before SIGTERM, and again before SIGKILL. */
export const GUARD_SHUTDOWN_GRACE_MS = 2_000;

export interface GuardProcessOptions {
  command: string;
  args: readonly string[];
  filter: GuardFilter;
  /** The caller's server name and the command's target, for the pending document. */
  server: string;
  target: string;
  /** Where to write the observation; omitted: none is written. */
  pendingFile?: string;
  /** The host side: what the host writes (the guard's stdin) and where the guard answers (its stdout). */
  input: Readable;
  output: Writable;
  stderr: (line: string) => void;
  maxMessageBytes?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** Splits a byte stream into lines without holding more than `max` bytes of one line. */
class Lines {
  private parts: Buffer[] = [];
  private size = 0;
  constructor(private readonly max: number) {}

  /** The complete lines in this chunk, or "oversize" when a line passed the limit. */
  push(chunk: Buffer): Buffer[] | "oversize" {
    const out: Buffer[] = [];
    let start = 0;
    for (let nl = chunk.indexOf(0x0a, start); nl !== -1; nl = chunk.indexOf(0x0a, start)) {
      const piece = chunk.subarray(start, nl);
      if (this.size + piece.length > this.max) return "oversize";
      out.push(this.size === 0 ? piece : Buffer.concat([...this.parts, piece]));
      this.parts = [];
      this.size = 0;
      start = nl + 1;
    }
    const rest = chunk.subarray(start);
    if (this.size + rest.length > this.max) return "oversize";
    if (rest.length > 0) {
      this.parts.push(Buffer.from(rest));
      this.size += rest.length;
    }
    return out;
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true });
/** A line as text; a line that is not UTF-8 becomes text that is not JSON, so the filter counts it as a protocol error. */
function textOf(line: Buffer): string {
  try {
    return decoder.decode(line).replace(/\r$/, "");
  } catch {
    return "\u0000not utf-8";
  }
}

async function writeAtomically(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Runs one guarded server until it ends. Resolves to the guard's exit code. */
export function runGuardProcess(options: GuardProcessOptions): Promise<number> {
  const max = options.maxMessageBytes ?? GUARD_MAX_MESSAGE_BYTES;
  const now = options.now ?? (() => new Date());
  const { filter, input, output, stderr } = options;
  const resolved = resolveCommand(options.command, options.args, options.env ?? process.env);
  if (!resolved.ok) {
    stderr(`plumbline guard: ${resolved.problem}`);
    return Promise.resolve(2);
  }

  return new Promise<number>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(resolved.file, resolved.args, { stdio: ["pipe", "pipe", "inherit"], env: options.env ?? process.env, windowsHide: true });
    } catch {
      stderr("plumbline guard: the server command could not be started");
      resolve(2);
      return;
    }
    let exitOverride: number | undefined;
    let ended = false;
    let queue: Promise<void> = Promise.resolve();
    let queued = 0;
    const timers: NodeJS.Timeout[] = [];
    const fromHost = new Lines(max);
    const fromServer = new Lines(max);

    const toServer = (line: string): void => {
      if (child.stdin && !child.stdin.destroyed && child.stdin.writable) child.stdin.write(line + "\n");
    };
    const toHost = (line: string): void => {
      if (!output.destroyed && output.writable) output.write(line + "\n");
    };
    const stopServer = (): void => {
      child.stdin?.end();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    const closeInput = (): void => {
      input.removeListener("data", onHostData);
      input.pause();
    };
    const shutdownAfterStdin = (): void => {
      child.stdin?.end();
      timers.push(
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          timers.push(setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL"), GUARD_SHUTDOWN_GRACE_MS).unref());
        }, GUARD_SHUTDOWN_GRACE_MS).unref(),
      );
    };

    const perform = async (actions: GuardAction[]): Promise<void> => {
      for (const action of actions) {
        if (action.kind === "to-server") toServer(action.line);
        else if (action.kind === "to-host") toHost(action.line);
        else if (action.kind === "stderr") stderr(action.line);
        else if (action.kind === "pending") {
          if (options.pendingFile === undefined) continue;
          const doc = pendingFor(options.server, options.target, action.tools, now());
          try {
            await writeAtomically(options.pendingFile, JSON.stringify(doc, null, 2) + "\n");
          } catch {
            stderr(`plumbline guard: the observation could not be written to ${options.pendingFile}; \`plumbline agent relock\` will not see this list`);
          }
        } else {
          exitOverride = action.exitCode;
          closeInput();
          stopServer();
        }
      }
    };

    // one queue for both directions, so a call is decided against the list the host was shown
    const enqueue = (work: () => Promise<GuardAction[]> | GuardAction[]): void => {
      queued++;
      if (queued > 256) {
        input.pause();
        child.stdout?.pause();
      }
      queue = queue
        .then(async () => perform(await work()))
        .catch(() => stderr("plumbline guard: a message could not be relayed"))
        .finally(() => {
          queued--;
          if (queued < 64 && !ended && exitOverride === undefined) {
            input.resume();
            child.stdout?.resume();
          }
        });
    };

    const oversize = (side: "host" | "server"): void => {
      if (exitOverride !== undefined) return;
      stderr(`plumbline guard: a message from the ${side} is larger than ${max} bytes; both sides are closed`);
      exitOverride = 1;
      closeInput();
      stopServer();
    };

    const onHostData = (chunk: Buffer): void => {
      const lines = fromHost.push(chunk);
      if (lines === "oversize") return oversize("host");
      for (const line of lines) if (line.length > 0) enqueue(() => filter.fromHost(textOf(line)));
    };
    input.on("data", onHostData);
    input.on("end", shutdownAfterStdin);
    input.on("error", shutdownAfterStdin);
    output.on("error", () => {
      closeInput();
      shutdownAfterStdin();
    });

    child.stdin?.on("error", () => undefined); // a server that exited: its pipe is gone; 'close' below ends the run
    child.stdout?.on("data", (chunk: Buffer) => {
      if (exitOverride !== undefined) return;
      const lines = fromServer.push(chunk);
      if (lines === "oversize") return oversize("server");
      for (const line of lines) if (line.length > 0) enqueue(() => filter.fromServer(textOf(line)));
    });
    child.on("error", () => {
      if (ended) return;
      ended = true;
      stderr("plumbline guard: the server command could not be started");
      closeInput();
      resolve(2);
    });
    child.on("close", (code, signal) => {
      if (ended) return;
      ended = true;
      void queue.then(() => {
        // the host is answered for every request the server will now never answer
        for (const action of filter.answerOpen("Plumbline guard: the server exited before it answered")) if (action.kind === "to-host") toHost(action.line);
        for (const t of timers) clearTimeout(t);
        closeInput();
        resolve(exitOverride ?? (code ?? (signal !== null ? 1 : 0)));
      });
    });
  });
}
