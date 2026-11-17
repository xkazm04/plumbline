// The `validator` adapter: fetches the target's manifest and network definitions and runs Plumbline's port of the
// reference runtime's validation rules (see validator.ts: a port, NOT the reference code, and the summary says so).

import type { GateFinding, GateState } from "../core/types.js";
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
    const manifestIssues = [
      ...validateManifestEntries(located.manifest, located.requestedName),
      ...(located.manifestText !== undefined ? duplicateKeyIssues(located.manifestText) : []),
    ];
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
    const networkIssues = [...validateNetworkDefinition(parsed), ...duplicateKeyIssues(text)];
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
