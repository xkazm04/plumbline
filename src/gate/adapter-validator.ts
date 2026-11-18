// The `validator` adapter: fetches the target's manifest and network definitions and runs Plumbline's port of the
// reference runtime's validation rules (see validator.ts: a port, NOT the reference code, and the summary says so).

import type { GateFinding, GateState } from "../core/types.js";
import { duplicateKeys } from "../core/json-keys.js";
import { describeFetchError, finding, worst, type Adapter, type GateContext } from "./context.js";
import {
  describeIssues,
  duplicateKeyIssues,
  frontManAgrees,
  mergeIssues,
  validateManifestEntries,
  validateNetworkDefinition,
  type Issue,
} from "./validator.js";

const NAME = "validator";

/**
 * UAT-24 (PRI-L1-12): the keys of the agentic-web spec a duplicate may be named by. A key is the file's own word, so only
 * one of these is shown; any other repeated key is counted, never quoted (guardrail 2).
 */
const SPEC_KEYS = new Set([
  "commondefs", "replacement_strings", "replacement_values", "tools", "name", "function", "instructions", "description",
  "parameters", "properties", "type", "required", "llm_config", "link_labels", "metadata", "networks", "front_man",
  "hocon", "brand", "class", "args", "toolbox", "allow", "max_iterations", "max_execution_seconds", "verbose",
]);

/**
 * Which file a rule is about, in the gate's own words: its path under the site base the gate read it from, when that path
 * is plain (letters, digits, `.`, `_`, `-`, `/`, at most 120 characters); else its last path segment when that is plain;
 * else "a network definition". Never a character the address rule would not take.
 */
export function fileLabel(fileUrl: string, base: string): string {
  const plain = (s: string) => /^[A-Za-z0-9._/-]{1,120}$/.test(s) && !s.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (fileUrl.startsWith(base) && plain(fileUrl.slice(base.length))) return fileUrl.slice(base.length);
  let last = "";
  try {
    last = new URL(fileUrl).pathname.split("/").pop() ?? "";
  } catch {
    last = "";
  }
  return plain(last) ? last : "a network definition";
}

/** The repeated keys of one file, named when they are spec keys and counted otherwise (UAT-24). */
function repeatedKeys(text: string): string {
  let keys: string[];
  try {
    keys = duplicateKeys(text);
  } catch {
    return "";
  }
  const named = [...new Set(keys.filter((k) => SPEC_KEYS.has(k)))];
  const others = keys.filter((k) => !SPEC_KEYS.has(k)).length;
  const parts = [...named.map((k) => `"${k}"`), ...(others > 0 ? [`${others} other key${others === 1 ? "" : "s"} (not named: not a key of the spec)`] : [])];
  return parts.join(", ");
}
const LEAD = "Plumbline's port of the reference validation rules (not the reference code)";

export const validatorAdapter: Adapter = async (ctx: GateContext): Promise<GateFinding> => {
  let located;
  try {
    located = await ctx.locate();
  } catch (error) {
    return finding(NAME, "unavailable", `${LEAD} could not run: the target could not be reached (${describeFetchError(error)}).`);
  }
  if (!located.ok) {
    if (located.reason === "bad-target") return finding(NAME, "unavailable", `${LEAD} could not run: the target is not a valid URL.`);
    if (located.reason === "no-manifest") {
      return finding(NAME, "fail", `${LEAD}: no agent-manifest.json is published at the target (HTTP ${located.status ?? "error"}).`);
    }
    const status = located.status ?? 0;
    if (status >= 200 && status < 300) return finding(NAME, "fail", `${LEAD}: the agent-manifest.json is not valid JSON.`);
    return finding(NAME, "unavailable", `${LEAD} could not run: the manifest request answered HTTP ${status}.`);
  }

  const issues: Issue[][] = [];
  const states: GateState[] = [];
  const notes: string[] = [];
  if (located.manifest !== undefined) {
    const manifestDuplicates = located.manifestText !== undefined ? duplicateKeyIssues(located.manifestText) : [];
    const manifestIssues = [...validateManifestEntries(located.manifest, located.requestedName), ...manifestDuplicates];
    if (manifestDuplicates.some((i) => i.code === "duplicate-keys") && located.manifestText !== undefined) {
      notes.push(`agent-manifest.json repeats ${repeatedKeys(located.manifestText)}`);
    }
    issues.push(manifestIssues);
    if (manifestIssues.length > 0) states.push("fail");
  } else {
    notes.push("the address named a network file directly, so the manifest rules were skipped");
  }
  if (located.networks.length === 0 && located.manifest !== undefined && located.requestedName !== undefined) {
    states.push("fail");
    notes.push("the manifest has no network with the requested name");
  }

  let checked = 0;
  for (const network of located.networks) {
    let response;
    try {
      response = await ctx.fetch(network.fileUrl);
    } catch (error) {
      states.push("unavailable");
      notes.push(`a network definition could not be fetched (${describeFetchError(error)})`);
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      states.push("fail");
      notes.push("a network definition named by the manifest is not published (HTTP 404)");
      continue;
    }
    if (!response.ok) {
      states.push("unavailable");
      notes.push(`a network definition request answered HTTP ${response.status}`);
      continue;
    }
    let parsed: unknown;
    const text = response.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      states.push("fail");
      notes.push("a network definition is not valid JSON");
      continue;
    }
    checked += 1;
    const duplicates = duplicateKeyIssues(text);
    const networkIssues = [...validateNetworkDefinition(parsed), ...duplicates];
    // UAT-24: which file repeats which key, in the gate's own words, beside the rule
    if (duplicates.some((i) => i.code === "duplicate-keys")) notes.push(`${fileLabel(network.fileUrl, located.base)} repeats ${repeatedKeys(text)}`);
    if (!frontManAgrees(network.frontMan, parsed)) networkIssues.push({ code: "manifest-front-man-mismatch", count: 1 });
    issues.push(networkIssues);
    if (networkIssues.length > 0) states.push("fail");
  }

  const merged = mergeIssues(...issues);
  const state = worst(states);
  const parts: string[] = [];
  if (merged.length > 0) parts.push(describeIssues(merged));
  parts.push(...notes);
  const checkedText = `${checked} network definition${checked === 1 ? "" : "s"} checked`;
  if (state === "pass") {
    if (checked === 0) {
      return finding(NAME, "unavailable", `${LEAD} found no network definition to check${notes.length ? ` (${notes.join("; ")})` : ""}.`);
    }
    return finding(NAME, "pass", `${LEAD} found no problem: ${checkedText}${notes.length ? `; ${notes.join("; ")}` : ""}.`);
  }
  return finding(NAME, state, `${LEAD}: ${parts.join("; ")} (${checkedText}).`);
};
