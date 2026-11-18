// `plumbline gate --root <folder>` (UAT-22, PRI-L1-06): the validator's rules over a site's files before it is
// published, a build output or a branch in CI. The gate's runner is given a fetcher that reads files under the folder
// (exact bytes, through the watch's readUnderRoot, so nothing outside the folder's real path is read) at a base address
// that is never contacted (`.invalid` is reserved and never resolves). Only the validator runs: Agent Atlas and Agent
// Customs check a published address, so nothing is sent to a third party. The report's `target` is the folder as given.

import type { GateReport } from "../core/types.js";
import { runGateWith } from "../gate/run.js";
import type { Fetcher } from "../net/locate.js";
import { DEFAULT_TIMEOUT_MS } from "../net/safe-fetch.js";
import type { SafeFetchResponse } from "../net/fetch-types.js";
import { ReadProblem, readUnderRoot } from "../watch/lock.js";

/** The address the folder is read at: a reserved name, so a fetch of it can only be this fetcher's. */
export const ROOT_BASE = "https://files.plumbline.invalid/";

function answer(url: string, status: number, bytes: Uint8Array = new Uint8Array(0)): SafeFetchResponse {
  return { status, ok: status >= 200 && status < 300, url, redirects: 0, headers: {}, bytes, text: () => new TextDecoder("utf-8").decode(bytes) };
}

/**
 * A fetcher over the files under `root`: an address under ROOT_BASE is the file at that path (404 when it is not there),
 * anything else is refused, so a manifest that names another site's network file is never fetched from here.
 */
export function folderFetcher(root: string): Fetcher {
  return async (url: string) => {
    if (!url.startsWith(ROOT_BASE)) throw new Error("it is not a file under the folder given with --root");
    const rel = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    if (rel === "" || rel.endsWith("/")) return answer(url, 404);
    try {
      return answer(url, 200, await readUnderRoot(root, rel));
    } catch (error) {
      if (error instanceof ReadProblem && error.missing) return answer(url, 404);
      throw new Error(error instanceof ReadProblem ? `it ${error.message}` : "it could not be read");
    }
  };
}

/** The validator over the files under `root`; the report's `target` is `shown` (the folder as the caller named it). */
export async function gateFolder(root: string, shown: string, options: { timeoutMs?: number; now?: () => Date } = {}): Promise<GateReport> {
  const report = await runGateWith(
    { target: ROOT_BASE, adapters: ["validator"], ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) },
    { fetch: folderFetcher(root), defaultTimeoutMs: DEFAULT_TIMEOUT_MS, ...(options.now !== undefined ? { now: options.now } : {}) },
  );
  return { ...report, target: shown };
}
