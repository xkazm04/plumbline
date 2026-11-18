// The CLI's help (UAT-28: DEV-L1-09, INE-L1-06, PRI-L1-15): `plumbline --help`, `plumbline help [<command>]` and
// `plumbline <command> --help` print to stdout and exit 0. The top level groups the commands by who runs them
// (publisher, verifier, operator, CI), each with one line on what it does and what it writes, so a person on a bad day
// can tell which side a command belongs to without the format document. A command's help is that line, its role, its
// usage (the same string a usage error prints) and the exit codes.

import { BADGE_USAGE } from "./badge-command.js";
import { DIFF_USAGE } from "./diff-command.js";
import { USAGE as SIGNING_USAGE } from "./commands.js";
import { USAGE as GATE_USAGE } from "./gate-command.js";
import { USAGE as INIT_USAGE } from "./init-command.js";
import { USAGE as SCAN_USAGE } from "./scan-command.js";
import { DNS_USAGE } from "./trust-command.js";
import { USAGE as WATCH_USAGE } from "./watch-command.js";

export type Role = "publisher" | "verifier" | "operator" | "ci";

interface CommandHelp {
  role: Role;
  /** What it does and what it writes, in one line. */
  line: string;
  usage: string;
  /** Further lines for the command's own help: what a person most often needs next. */
  more?: readonly string[];
}

const ROLE_TITLES: Record<Role, string> = {
  publisher: "Publisher: your own site (the watch needs no key; signing is the upgrade)",
  verifier: "Verifier: a partner's or a stranger's site (nothing is trusted until you say --yes)",
  operator: "Operator: many sites, or one site before launch",
  ci: "CI: the same commands in a workflow",
};

/** Every command, in the order the help lists them. The watch comes first: a publisher gets value with no key. */
export const COMMAND_HELP: Record<string, CommandHelp> = {
  init: {
    role: "publisher",
    line: "write plumbline.lock.json for your site (and, with --workflow, the daily CI workflow); no key, no trust decision",
    usage: INIT_USAGE,
    more: ["Run it from your site repository's root. It prints what to commit and what to run next."],
  },
  watch: {
    role: "publisher",
    line: "drift against the lock: exit 0 no drift, 1 findings; --relock accepts a change you reviewed; --url checks a published lock",
    usage: WATCH_USAGE,
    more: [
      "--relock rewrites the lock and prints what changed; a signed site is signed again after it (the lock is a signed file).",
      "--allow-local takes http and loopback addresses, for a rehearsal on this machine; private ranges stay refused.",
    ],
  },
  diff: {
    role: "publisher",
    line: "show a partner's change by name from the copy the lock kept (--peer), or compare two network files",
    usage: DIFF_USAGE,
  },
  keygen: {
    role: "publisher",
    line: "make a signing key pair in a folder: the private file (keep it out of git) and the public key record",
    usage: SIGNING_USAGE.keygen,
  },
  sign: {
    role: "publisher",
    line: "sign the agent files and the lock with your key: writes plumbline.signature.json",
    usage: SIGNING_USAGE.sign,
  },
  rotate: {
    role: "publisher",
    line: "a planned change of key: the old key signs the new one (not after a leak: use revoke)",
    usage: SIGNING_USAGE.rotate,
  },
  revoke: {
    role: "publisher",
    line: "after a leak: publish that a key must no longer be trusted (writes plumbline-revocation.json)",
    usage: SIGNING_USAGE.revoke,
    more: ["The bad day, in order: revoke the leaked key, keygen a new one, publish its key record, sign again, replace the DNS record (plumbline dns), and tell each verifier the new kid out of band."],
  },
  dns: {
    role: "publisher",
    line: "print the DNS TXT record that names your key, a second channel for first contact",
    usage: DNS_USAGE,
  },
  "export-jws": {
    role: "publisher",
    line: "the same signature as a detached JWS (EdDSA), for tools that read JWS",
    usage: SIGNING_USAGE["export-jws"],
  },
  trust: {
    role: "verifier",
    line: "add a publisher's key to your trust file; without --yes it prints the kid to confirm out of band and adds nothing",
    usage: SIGNING_USAGE.trust,
  },
  verify: {
    role: "verifier",
    line: "verified, invalid or unverifiable, against your own trust file only (a key inside the site is never trusted)",
    usage: SIGNING_USAGE.verify,
  },
  adopt: {
    role: "verifier",
    line: "follow a key rotation a site publishes, from a key your trust file already holds (needs --yes)",
    usage: SIGNING_USAGE.adopt,
  },
  gate: {
    role: "operator",
    line: "the validator's rules, Agent Atlas and Agent Customs on one address: pass, fail or unavailable (never a pass); --root checks a folder",
    usage: GATE_USAGE,
    more: ["The quickest first result: plumbline gate https://your-site.example/ (Atlas is sent the address; --adapters validator sends it nowhere)."],
  },
  scan: {
    role: "operator",
    line: "a portfolio report for a list of sites, worst first: report.json and report.html",
    usage: SCAN_USAGE,
  },
  badge: {
    role: "operator",
    line: "an SVG badge from a gate report (gate --json)",
    usage: BADGE_USAGE,
  },
};

/** What the CI role runs: the same commands, named here so the role has its own door. */
const CI_LINES = [
  "init --workflow          writes .github/workflows/plumbline-watch.yml: a daily watch that keeps one drift issue",
  "the Action               uses: xkazm04/plumbline/action@<commit sha> (command: gate or watch; action/README.md)",
  "gate --root <folder>     gates a build folder before deployment: the validator only, nothing sent to a third party",
  "watch --json, gate --json  one JSON document for a script; every finding carries a code (docs/gate-and-watch.md)",
];

export const COMMANDS = Object.keys(COMMAND_HELP);

const EXIT_CODES = "Exit codes: 0 clean, 1 findings (for trust without --yes: nothing added), 2 usage or I/O error.";

/** The top-level help: the commands grouped by role, one line each. */
export function topHelp(): string {
  const width = Math.max("watch --url".length, ...COMMANDS.map((c) => c.length)) + 2;
  const lines = ["plumbline: keep an agentic website true after it ships. Needs Node 22 or later.", "", "usage: plumbline <command> [options]", ""];
  for (const role of ["publisher", "verifier", "operator"] as const) {
    lines.push(`${ROLE_TITLES[role]}:`);
    for (const [name, help] of Object.entries(COMMAND_HELP)) if (help.role === role) lines.push(`  ${name.padEnd(width)}${help.line}`);
    if (role === "verifier") lines.push(`  ${"watch --url".padEnd(width)}re-check the lock a site publishes, from its address, as the Desk does`);
    lines.push("");
  }
  lines.push(`${ROLE_TITLES.ci}:`, ...CI_LINES.map((l) => `  ${l}`), "");
  lines.push(EXIT_CODES, "plumbline <command> --help shows a command's options. The README has one entry per role.");
  return `${lines.join("\n")}\n`;
}

/** A command's own help, or undefined for a name that is not a command. */
export function commandHelp(command: string): string | undefined {
  if (!Object.hasOwn(COMMAND_HELP, command)) return undefined;
  const help = COMMAND_HELP[command] as CommandHelp;
  const usage = help.usage.replace(/\n+$/, "");
  const more = (help.more ?? []).map((l) => `${l}\n`).join("");
  return `plumbline ${command}: ${help.line}.\nRole: ${ROLE_TITLES[help.role]}.\n\n${usage}\n\n${more}${EXIT_CODES}\n`;
}
