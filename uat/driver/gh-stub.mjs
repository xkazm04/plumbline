#!/usr/bin/env node
// UAT stub for the GitHub CLI (`gh`). NOT the product, and not GitHub: it models only the calls action/action.yml makes,
// and which of them GitHub would notify a repository watcher about (create and comment notify; a body edit does not).
// First written for the marta-hollis L2 walk (run 2026-11-18-first-five, evidence/marta/gh-stub.mjs, kept there);
// moved here unchanged in behaviour as a tracked overlay tool. Used by uat/driver/run-action.mjs, which puts it first
// on PATH. Issues and pull requests live in the JSON file GH_STUB_STATE; every call is recorded under UAT_RUN_LABEL.
// Like the real gh, `pr create` names a head branch; this stub does not check that the branch exists on the remote.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = process.env.GH_STUB_STATE;
if (!file) {
  process.stderr.write("gh stub: GH_STUB_STATE is not set\n");
  process.exit(2);
}
const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { next: 1, issues: [], prs: [], calls: [] };
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);
const run = process.env.UAT_RUN_LABEL ?? "";
const record = (call, notifies, extra = {}) => state.calls.push({ run, call: argv.join(" ").slice(0, 300), what: call, notifies, ...extra });
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const [noun, verb] = argv;
const body = () => (opt("--body-file") ? readFileSync(opt("--body-file"), "utf8") : opt("--body") ?? "");

if (noun === "issue" && verb === "list") {
  const open = state.issues.filter((i) => i.state === "open").map(({ number, title, body }) => ({ number, title, body }));
  record("issue list", false);
  save();
  process.stdout.write(JSON.stringify(open));
} else if (noun === "issue" && verb === "create") {
  const n = state.next++;
  state.issues.push({ number: n, title: opt("--title"), body: body(), state: "open", comments: [], history: [{ run, did: "created" }] });
  record("issue create", true, { number: n });
  save();
  process.stdout.write(`https://github.com/stub/stub/issues/${n}\n`);
} else if (noun === "issue" && (verb === "edit" || verb === "comment" || verb === "close")) {
  const n = Number(argv[2]);
  const issue = state.issues.find((i) => i.number === n);
  if (!issue) {
    process.stderr.write(`gh stub: no issue ${n}\n`);
    process.exit(1);
  }
  if (verb === "edit" && has("--add-assignee")) {
    // UAT-30: an assignment; GitHub notifies the assignee (and, from then on, of every comment)
    const who = opt("--add-assignee");
    issue.assignees = [...new Set([...(issue.assignees ?? []), who])];
    issue.history.push({ run, did: `assigned ${who}` });
    record("issue assign", true, { number: n, assignee: who });
  } else if (verb === "edit") {
    issue.body = body();
    issue.history.push({ run, did: "body edited" });
    record("issue edit", false, { number: n });
  } else if (verb === "comment") {
    issue.comments.push({ run, body: body() });
    issue.history.push({ run, did: "commented" });
    record("issue comment", true, { number: n });
  } else {
    if (opt("--comment") !== undefined) issue.comments.push({ run, body: opt("--comment") });
    issue.state = "closed";
    issue.history.push({ run, did: "closed" });
    record("issue close", true, { number: n });
  }
  save();
} else if (noun === "pr" && verb === "list") {
  const head = opt("--head");
  const open = state.prs.filter((p) => p.state === "open" && p.head === head).map(({ number, body, isDraft }) => ({ number, body, isDraft }));
  record("pr list", false);
  save();
  process.stdout.write(JSON.stringify(open));
} else if (noun === "pr" && verb === "create") {
  const n = state.next++;
  state.prs.push({ number: n, title: opt("--title"), head: opt("--head"), body: body(), isDraft: has("--draft"), state: "open", comments: [], history: [{ run, did: "created" }] });
  record("pr create", true, { number: n });
  save();
  process.stdout.write(`https://github.com/stub/stub/pull/${n}\n`);
} else if (noun === "pr" && (verb === "edit" || verb === "ready" || verb === "close" || verb === "comment")) {
  const n = Number(argv[2]);
  const pr = state.prs.find((p) => p.number === n);
  if (!pr) {
    process.stderr.write(`gh stub: no pull request ${n}\n`);
    process.exit(1);
  }
  if (verb === "edit") {
    pr.body = body();
    pr.history.push({ run, did: "body edited" });
    record("pr edit", false, { number: n });
  } else if (verb === "comment") {
    pr.comments.push({ run, body: body() });
    pr.history.push({ run, did: "commented" });
    record("pr comment", true, { number: n });
  } else if (verb === "ready") {
    pr.isDraft = has("--undo");
    pr.history.push({ run, did: has("--undo") ? "made draft" : "made ready" });
    record("pr ready", !has("--undo"), { number: n });
  } else {
    if (opt("--comment") !== undefined) pr.comments.push({ run, body: opt("--comment") });
    pr.state = "closed";
    pr.history.push({ run, did: "closed" });
    record("pr close", true, { number: n });
  }
  save();
} else {
  process.stderr.write(`gh stub: unsupported call: gh ${argv.join(" ")}\n`);
  record("UNSUPPORTED", false);
  save();
  process.exit(2);
}
