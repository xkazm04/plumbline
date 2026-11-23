#!/usr/bin/env node
// The UAT world driver: materialise a fixture world into a throwaway folder, serve it, play its events, take it down.
// Plain Node ESM, no dependency. The contract is uat/env.md; uat/fixtures/README.md lists each world's sites and acts.
//
//   node uat/driver/world.mjs up <world> [--port-base <n>] [--no-start]
//   node uat/driver/world.mjs act <world> <act>
//   node uat/driver/world.mjs status <world>
//   node uat/driver/world.mjs down <world>
//   node uat/driver/world.mjs list
//
// `up` copies uat/fixtures/<world>/ into <OS temp>/plumbline-uat-<world>-<random>/ (never edits the fixtures),
// replaces every {{site:<name>}} placeholder with that site's address (http://127.0.0.1:<port>), starts one detached
// server process (uat/driver/serve.mjs) that serves each site on 127.0.0.1 at portBase + index and the built Desk
// (site/) at portBase + 99, records the server's pid and the folder in <OS temp>/plumbline-uat-<world>.state.json, then
// plays the journey's starting act (setup, fresh, signed, portfolio, onboarded) with the real built CLI
// (node dist/cli/index.js) and throwaway keys made by keygen inside <temp>/keys/. --no-start skips that act.
// Every command prints ONE JSON document on stdout; progress and CLI transcripts go to <temp>/_world/cli.log.
// Exit: 0 done (an act already in place is done too, with "already": true), 1 an act refused (its precondition is not
// met; the reason is in the JSON), 2 usage or environment error.
//
// Keys: only keys this driver makes in the temp folder are used. Nothing under the repository's keys/ is ever read.

import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(REPO, "uat", "fixtures");
const CLI = path.join(REPO, "dist", "cli", "index.js");
const DESK = path.join(REPO, "site");
const SERVE = path.join(HERE, "serve.mjs");
const DESK_OFFSET = 99;
const TEXT_EXT = new Set([".json", ".html", ".htm", ".md", ".txt", ".js", ".mjs", ".css", ".hocon", ".yml", ".yaml", ""]);

class Refused extends Error {}
class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------- io

function print(doc) {
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      // Windows: the server may hold the file open for a moment while it reads it
      if (i >= 50) throw error;
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},20)"]);
    }
  }
}

function stateFile(world) {
  return path.join(os.tmpdir(), `plumbline-uat-${world}.state.json`);
}

function worlds() {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(FIXTURES, d.name, "world.json")))
    .map((d) => d.name)
    .sort();
}

function worldDef(world) {
  if (!worlds().includes(world)) throw new UsageError(`unknown world "${world}"; known: ${worlds().join(", ")}`);
  return readJson(path.join(FIXTURES, world, "world.json"));
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Waits on a predicate, polling; never a fixed sleep. Throws with the label when the deadline passes. */
async function until(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function walk(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------- world

/** The world as it is now: the state file, with helpers for acts. */
function load(world) {
  const file = stateFile(world);
  if (!existsSync(file)) throw new UsageError(`${world} is not up (no ${file}); run: node uat/driver/world.mjs up ${world}`);
  const state = readJson(file);
  if (!existsSync(state.dir)) throw new UsageError(`${world}'s folder ${state.dir} is gone; run down, then up`);
  return state;
}

function saveState(state) {
  writeAtomic(stateFile(state.world), JSON.stringify(state, null, 2));
}

function context(state) {
  const worldDir = path.join(state.dir, "_world");
  const ran = [];
  const changed = [];
  const site = (name) => {
    const s = state.sites.find((x) => x.name === name);
    if (!s) throw new Error(`no site ${name} in ${state.world}`);
    return s;
  };
  const rel = (file) => path.relative(state.dir, file).split(path.sep).join("/");
  const ctx = {
    state,
    ran,
    changed,
    site,
    keysDir: path.join(state.dir, "keys"),
    /** Runs the real built CLI and records the transcript. `ok` lists the exit codes that are expected. */
    cli(args, { cwd = state.dir, ok = [0] } = {}) {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
      const shown = args.map((a) => (path.isAbsolute(a) && a.startsWith(state.dir) ? `<world>/${rel(a)}` : a));
      const entry = { cmd: `plumbline ${shown.join(" ")}`, cwd: cwd === state.dir ? "<world>" : `<world>/${rel(cwd)}`, exit: r.status };
      ran.push(entry);
      writeFileSync(
        path.join(worldDir, "cli.log"),
        `$ (cd ${entry.cwd}) ${entry.cmd}\n${r.stdout}${r.stderr ? `[stderr]\n${r.stderr}` : ""}[exit ${r.status}]\n\n`,
        { flag: "a" },
      );
      if (!ok.includes(r.status)) {
        throw new Error(`${entry.cmd} exited ${r.status}, expected ${ok.join(" or ")}: ${(r.stderr || r.stdout).trim().split("\n").slice(0, 3).join(" / ")}`);
      }
      return { code: r.status, out: r.stdout, err: r.stderr };
    },
    /** keygen into <world>/keys/<name>; returns the private file, the record file and the kid. Reuses one already made. */
    keygen(name) {
      const dir = path.join(state.dir, "keys", name);
      const privateFile = path.join(dir, "plumbline.private.json");
      const recordFile = path.join(dir, ".well-known", "plumbline-key.json");
      if (!existsSync(privateFile)) ctx.cli(["keygen", "--out", dir]);
      const kid = readJson(recordFile).kid;
      state.keyFiles[name] = { private: privateFile, record: recordFile, kid };
      return state.keyFiles[name];
    },
    /** Publishes a key's record at a site's .well-known/plumbline-key.json, as keygen's next step says. */
    publishKey(keyName, siteName) {
      const target = path.join(site(siteName).folder, ".well-known", "plumbline-key.json");
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(state.keyFiles[keyName].record, target);
      changed.push(rel(target));
    },
    sign(siteName, keyName, extra = []) {
      const s = site(siteName);
      return ctx.cli(["sign", "--root", s.folder, "--key", state.keyFiles[keyName].private, "--origin", s.origin, ...extra]);
    },
    file(siteName, relPath) {
      return path.join(site(siteName).folder, ...relPath.split("/"));
    },
    read(siteName, relPath) {
      return readFileSync(ctx.file(siteName, relPath), "utf8");
    },
    /** Writes a site file, keeping the bytes it replaces under _world/history/ (the world's record, not the site's). */
    write(siteName, relPath, text) {
      const target = ctx.file(siteName, relPath);
      if (existsSync(target)) {
        const keep = path.join(worldDir, "history", `${String(state.played.length).padStart(2, "0")}-${state.currentAct}`, siteName, ...relPath.split("/"));
        mkdirSync(path.dirname(keep), { recursive: true });
        cpSync(target, keep);
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
      changed.push(rel(target));
    },
    /** Replaces exactly one occurrence; a fixture that no longer holds the text is an error, never a silent no-op. */
    replaceOnce(siteName, relPath, from, to) {
      const text = ctx.read(siteName, relPath);
      const n = text.split(from).length - 1;
      if (n !== 1) throw new Error(`${siteName}/${relPath}: expected the text once, found it ${n} times: ${from}`);
      ctx.write(siteName, relPath, text.replace(from, to));
    },
    async behave(siteName, behaviour) {
      const control = readJson(path.join(worldDir, "control.json"));
      control.generation += 1;
      // merged: a state change keeps a site's per-path settings (notFound, noCors) and the reverse
      behaviour = { state: "up", ...(control.sites[siteName] ?? {}), ...behaviour };
      control.sites[siteName] = behaviour;
      writeAtomic(path.join(worldDir, "control.json"), JSON.stringify(control, null, 2));
      await until(() => {
        try {
          const st = readJson(path.join(worldDir, "status.json"));
          if (st.error) throw new Error(`server: ${st.error}`);
          return st.generation === control.generation;
        } catch (error) {
          if (String(error.message).startsWith("server:")) throw error;
          return false;
        }
      }, `the server to apply ${siteName} -> ${behaviour.state}`);
      site(siteName).behaviour = behaviour;
      changed.push(`server: ${siteName} ${JSON.stringify(behaviour)}`);
    },
    behaviourOf(siteName) {
      return readJson(path.join(worldDir, "control.json")).sites[siteName] ?? { state: "up" };
    },
  };
  return ctx;
}

// -------------------------------------------------------------------------------------------------------------- acts
// Each act returns { already: true, note } when it is already in place (nothing changed), or { note } after changing
// the world; it throws Refused when its precondition is not met. Acts edit only the world's temp folder or toggle a
// site's server behaviour.

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Re-serialise JSON in the file's own indentation (two spaces or a tab), so an edit does not also reformat. */
function indentOf(text) {
  return /\n\t"/.test(text) ? "\t" : 2;
}

const ACTS = {
  "larch-house": {
    setup(ctx) {
      const s = ctx.site("larch-house");
      if (existsSync(ctx.file("larch-house", "plumbline.lock.json")) && existsSync(ctx.file("larch-house", "plumbline.signature.json"))) {
        return { already: true, note: "the site is already locked and signed" };
      }
      ctx.keygen("larch-house");
      ctx.publishKey("larch-house", "larch-house");
      // Jonas's setup, from the repository root: the lock with the rooms page as a source, and the daily workflow.
      // Exit 1 is expected: the bike-rental peer is on a loopback address the watch does not contact (see env.md).
      ctx.cli(["init", "--root", "site", "--source", "rooms.html", "--workflow"], { cwd: s.repo, ok: [0, 1] });
      ctx.sign("larch-house", "larch-house");
      ctx.changed.push("larch-house/site/plumbline.lock.json", "larch-house/.github/workflows/plumbline-watch.yml", "larch-house/site/plumbline.signature.json");
      return { note: "locked (rooms.html as a source), workflow written, signed with keys/larch-house (Jonas's key)" };
    },
    // The demo film's guesthouse (film/README.md, backlog item 3): the same site without its bike-rental partner, so a
    // reading before anything changed is clean. The partner is a loopback peer the watch never contacts, so with it every
    // reading carries a pending-peer warning the film's story does not have. Needs setup; relocks and signs again.
    solo(ctx) {
      const s = ctx.site("larch-house");
      if (!existsSync(ctx.file("larch-house", "plumbline.lock.json"))) throw new Refused("solo relocks the site: play setup first");
      const netText = ctx.read("larch-house", "larch_house.network.json");
      if (!netText.includes("fellside_bikes")) return { already: true, note: "the guesthouse already links no partner" };
      const net = JSON.parse(netText);
      const peer = Object.keys(net.link_labels ?? {}).find((k) => k.endsWith("/fellside_bikes"));
      delete net.link_labels[peer];
      for (const tool of net.tools) {
        if (Array.isArray(tool.tools)) tool.tools = tool.tools.filter((t) => t !== peer);
        if (typeof tool.instructions === "string") tool.instructions = tool.instructions.replace(" For bike hire, ask Fellside Cycles.", "");
      }
      ctx.write("larch-house", "larch_house.network.json", JSON.stringify(net, null, indentOf(netText)) + "\n");
      const manText = ctx.read("larch-house", "agent-manifest.json");
      const man = JSON.parse(manText);
      man.allowed_peers = [];
      ctx.write("larch-house", "agent-manifest.json", JSON.stringify(man, null, indentOf(manText)) + "\n");
      ctx.cli(["watch", "--root", "site", "--relock"], { cwd: s.repo, ok: [0, 1] });
      ctx.sign("larch-house", "larch-house");
      ctx.changed.push("larch-house/site/larch_house.network.json", "larch-house/site/agent-manifest.json", "larch-house/site/plumbline.lock.json", "larch-house/site/plumbline.signature.json");
      return { note: "the bike-rental partner is unlinked (network and allowed_peers), the lock rewritten by watch --relock, the site signed again" };
    },
    "raise-price"(ctx) {
      const text = ctx.read("larch-house", "rooms.html");
      if (text.includes("<td>Double room</td><td>2</td><td class=\"price\">€95 per night</td>")) return { already: true, note: "the double room is already €95" };
      ctx.replaceOnce("larch-house", "rooms.html", "<td>Double room</td><td>2</td><td class=\"price\">€89 per night</td>", "<td>Double room</td><td>2</td><td class=\"price\">€95 per night</td>");
      return { note: "rooms.html: double room €89 -> €95; larch_house.network.json still says €89" };
    },
    "fix-network"(ctx) {
      const net = ctx.read("larch-house", "larch_house.network.json");
      if (net.includes("The double room costs €95 per night")) return { already: true, note: "the network already says €95" };
      if (!ctx.read("larch-house", "rooms.html").includes("€95 per night")) throw new Refused("fix-network corrects the network to the page's €95: play raise-price first");
      ctx.replaceOnce("larch-house", "larch_house.network.json", "The double room costs €89 per night", "The double room costs €95 per night");
      return { note: "larch_house.network.json: €89 -> €95. Nothing was relocked or signed: the network is a signed file, so the signature no longer matches until someone relocks and signs" };
    },
    "cosmetic-edit"(ctx) {
      const text = ctx.read("larch-house", "rooms.html");
      if (text.includes("Six quiet rooms beneath the old larches")) return { already: true, note: "the wording is already changed" };
      ctx.replaceOnce(
        "larch-house",
        "rooms.html",
        "Six rooms under the larches, a short walk from the lake path. Every room has its own shower, and the beds are made up with linen from the mill in Kendal.",
        "Six quiet rooms beneath the old larches, five minutes on foot from the lake path. Each has its own shower, and we make the beds with linen woven at the mill in Kendal.",
      );
      ctx.replaceOnce("larch-house", "rooms.html", "served in the dining room from 08:00 to 09:30, with eggs from the farm next door.", "served in the dining room from 08:00 to 09:30, with eggs and bacon from the farm next door.");
      return { note: "rooms.html: introduction and breakfast wording changed; every price, time, phone number and e-mail address the network states is still on the page" };
    },
    async "rooms-no-cors"(ctx) {
      const b = ctx.behaviourOf("larch-house");
      if ((b.noCors ?? []).includes("/rooms.html")) return { already: true, note: "rooms.html is already served without Access-Control-Allow-Origin" };
      await ctx.behave("larch-house", { noCors: [...(b.noCors ?? []), "/rooms.html"] });
      return { note: "rooms.html is now served WITHOUT Access-Control-Allow-Origin (an ordinary host's default); every other file keeps it" };
    },
    async "rooms-cors"(ctx) {
      const b = ctx.behaviourOf("larch-house");
      if (!(b.noCors ?? []).includes("/rooms.html")) return { already: true, note: "rooms.html is already served with Access-Control-Allow-Origin: *" };
      await ctx.behave("larch-house", { noCors: b.noCors.filter((p) => p !== "/rooms.html") });
      return { note: "rooms.html is served with Access-Control-Allow-Origin: * again" };
    },
  },

  "meridian-trips": {
    fresh() {
      return { already: true, note: "the fresh checkout is the state up creates: no lock, no key, no workflow" };
    },
    "partner-adds-agent"(ctx) {
      const file = "coinbridge_fx.network.json";
      const text = ctx.read("coinbridge", file);
      const net = JSON.parse(text);
      if (net.tools.some((a) => a.name === "fee_estimator")) return { already: true, note: "fee_estimator is already in the partner's network" };
      net.tools[0].tools.push("fee_estimator");
      net.tools.push({
        name: "fee_estimator",
        function: { description: "Estimates the card and transfer fees on a converted amount." },
        instructions: "Estimate the fees a visitor's bank may add to a converted amount: a 0.5% conversion margin plus the Ledgerline transfer fee from the Ledgerline fees service. Say it is an estimate.",
        tools: ["https://mcp.ledgerline.example/mcp"],
      });
      ctx.write("coinbridge", file, `${JSON.stringify(net, null, indentOf(text))}\n`);
      return { note: "coinbridge_fx.network.json: agent fee_estimator added (fx_front now calls it); new outbound host mcp.ledgerline.example" };
    },
    "partner-adds-links"(ctx) {
      if (existsSync(ctx.file("coinbridge", "links.json"))) return { already: true, note: "Coinbridge already serves a links.json" };
      ctx.write(
        "coinbridge",
        "links.json",
        `${JSON.stringify({ version: 1, networks: { coinbridge_fx: { settlement_partner: "https://agents.ledgerline.example/ledger_settlement" } } }, null, 2)}\n`,
      );
      return { note: "Coinbridge now serves links.json with one slot (settlement_partner -> agents.ledgerline.example)" };
    },
    "partner-changes-again"(ctx) {
      const file = "coinbridge_fx.network.json";
      const text = ctx.read("coinbridge", file);
      const net = JSON.parse(text);
      const fee = net.tools.find((a) => a.name === "fee_estimator");
      if (!fee) throw new Refused("partner-changes-again changes the partner while its first change is unaccepted: play partner-adds-agent first");
      if (fee.instructions.includes("0.9%")) return { already: true, note: "the second change is already in place" };
      fee.instructions = fee.instructions.replace("a 0.5% conversion margin", "a 0.9% conversion margin");
      const rate = net.tools.find((a) => a.name === "rate_lookup");
      rate.instructions = "Return today's mid-market rate between the two currencies from the Coinbridge rates service, with the time it was published. If the service does not answer, use yesterday's rate and say so.";
      ctx.write("coinbridge", file, `${JSON.stringify(net, null, indentOf(text))}\n`);
      return { note: "coinbridge_fx.network.json: fee_estimator's margin 0.5% -> 0.9%; rate_lookup now falls back to yesterday's rate" };
    },
    "partner-reformats"(ctx) {
      const file = "coinbridge_fx.network.json";
      const text = ctx.read("coinbridge", file);
      if (indentOf(text) === "\t") return { already: true, note: "the partner's file is already tab-indented" };
      ctx.write("coinbridge", file, `${JSON.stringify(JSON.parse(text), null, "\t")}\n`);
      return { note: "coinbridge_fx.network.json re-serialised with tabs: different bytes, same agents, hosts and front agent" };
    },
    // Added after run 2026-11-18-first-five (Dev's walker had to edit the served file by hand): a change to partner
    // code that keeps every outline count the same, so only the bytes (and the agent's hash) move.
    "partner-changes-fee"(ctx) {
      const file = "coinbridge_fx.network.json";
      const text = ctx.read("coinbridge", file);
      const net = JSON.parse(text);
      const fee = net.tools.find((a) => a.name === "fee_estimator");
      if (!fee) throw new Refused("partner-changes-fee edits the fee_estimator agent: play partner-adds-agent first");
      if (fee.instructions.includes("a 1.1% conversion margin")) return { already: true, note: "fee_estimator's margin is already 1.1%" };
      const before = /a (\d+(?:\.\d+)?)% conversion margin/.exec(fee.instructions);
      if (!before) throw new Error("fixture changed: fee_estimator's instructions name no conversion margin");
      fee.instructions = fee.instructions.replace(before[0], "a 1.1% conversion margin");
      ctx.write("coinbridge", file, `${JSON.stringify(net, null, indentOf(text))}\n`);
      return {
        note: `coinbridge_fx.network.json: fee_estimator's margin ${before[1]}% -> 1.1%; no agent or outbound host added or removed and the front agent unchanged, so every outline count against the lock is what it was before this act`,
      };
    },
    async "partner-down"(ctx) {
      if (ctx.behaviourOf("coinbridge").state === "down") return { already: true, note: "Coinbridge is already down" };
      await ctx.behave("coinbridge", { state: "down" });
      return { note: "Coinbridge's port now refuses connections" };
    },
    async "partner-back"(ctx) {
      if (ctx.behaviourOf("coinbridge").state === "up") return { already: true, note: "Coinbridge is already answering" };
      await ctx.behave("coinbridge", { state: "up" });
      return { note: "Coinbridge answers again" };
    },
  },

  "northgate-clinic": {
    signed(ctx) {
      if (existsSync(ctx.file("northgate-clinic", "plumbline.signature.json"))) return { already: true, note: "the clinic is already signed" };
      ctx.keygen("clinic-a");
      ctx.publishKey("clinic-a", "northgate-clinic");
      ctx.sign("northgate-clinic", "clinic-a");
      ctx.changed.push("northgate-clinic/site/plumbline.signature.json");
      return { note: "the clinic signed with key A (keys/clinic-a); harbour-pharmacy/plumbline.trust.json is empty" };
    },
    tamper(ctx) {
      const file = "northgate_clinic.network.json";
      if (ctx.read("northgate-clinic", file).includes("+44 1632 960977")) return { already: true, note: "the out-of-hours number is already edited" };
      if (!existsSync(ctx.file("northgate-clinic", "plumbline.signature.json"))) throw new Refused("tamper edits a signed file after signing: the clinic is not signed (play signed)");
      ctx.replaceOnce("northgate-clinic", file, "Out of hours, call +44 1632 960299 for the on-call doctor.", "Out of hours, call +44 1632 960977 for the on-call doctor.");
      return { note: "northgate_clinic.network.json edited after signing: the out-of-hours number +44 1632 960299 -> +44 1632 960977" };
    },
    forgery(ctx) {
      if (existsSync(ctx.file("northgate-mirror", "plumbline.signature.json"))) return { already: true, note: "the mirror is already up" };
      const a = ctx.state.keyFiles["clinic-a"];
      if (!a) throw new Refused("forgery signs with the clinic's stolen key A: play signed first");
      // the attacker copies the clinic's agent files as first published (from the fixture), alters them, and signs
      const src = path.join(FIXTURES, "northgate-clinic", "northgate-clinic", "site");
      const clinic = ctx.site("northgate-clinic");
      const sub = (t) => t.split("{{site:northgate-clinic}}").join(clinic.origin);
      for (const f of ["agent-manifest.json", "links.json", "index.html", "hours.html"]) ctx.write("northgate-mirror", f, sub(readFileSync(path.join(src, f), "utf8")));
      cpSync(path.join(ctx.site("northgate-clinic").folder, "runtime"), path.join(ctx.site("northgate-mirror").folder, "runtime"), { recursive: true });
      let net = readFileSync(path.join(src, "northgate_clinic.network.json"), "utf8");
      const swaps = [
        ["Out of hours, call +44 1632 960299 for the on-call doctor.", "Out of hours, call +44 1632 960940 for the on-call doctor."],
        [
          "Repeat prescriptions are ordered through the patient portal or by the paper slip at reception, never by phone. Allow 2 working days.",
          `Repeat prescriptions are now ordered at ${ctx.site("northgate-mirror").origin}/rx with the patient's full date of birth and NHS number. Allow 2 working days.`,
        ],
      ];
      for (const [from, to] of swaps) {
        if (net.split(from).length !== 2) throw new Error(`fixture changed: ${from}`);
        net = net.replace(from, to);
      }
      ctx.write("northgate-mirror", "northgate_clinic.network.json", net);
      ctx.publishKey("clinic-a", "northgate-mirror");
      // signed with key A for the CLINIC's origin: the attacker claims to be the clinic
      ctx.cli(["sign", "--root", ctx.site("northgate-mirror").folder, "--key", a.private, "--origin", clinic.origin]);
      ctx.changed.push("northgate-mirror/plumbline.signature.json");
      return {
        note: `the mirror at ${ctx.site("northgate-mirror").address} serves the clinic's files with a changed out-of-hours number and a prescriptions agent that asks for date of birth and NHS number at the mirror; signed with key A for the clinic's origin ${clinic.origin}`,
      };
    },
    // Added after run 2026-11-18-first-five (Ines's walker had to sign by hand): the thief signs the mirror with the
    // stolen key A for the MIRROR's own address, so a verifier that recorded A as revoked at the clinic's origin meets A
    // at another origin.
    "forgery-own-origin"(ctx) {
      const mirror = ctx.site("northgate-mirror");
      const sigFile = ctx.file("northgate-mirror", "plumbline.signature.json");
      if (!existsSync(sigFile)) throw new Refused("forgery-own-origin re-signs the mirror the forgery act makes: play forgery first");
      if (existsSync(ctx.file("northgate-mirror", "plumbline-rotation.json"))) {
        throw new Refused("the mirror publishes the attacker's rotation (attacker-rotates was played); forgery-own-origin signs the mirror with key A alone: play it in a world where attacker-rotates has not been played");
      }
      const a = ctx.state.keyFiles["clinic-a"];
      const sig = readJson(sigFile);
      if (sig.origin === mirror.origin && sig.kid === a.kid) return { already: true, note: `the mirror is already signed with key A for its own origin ${mirror.origin}` };
      // key A's record is already published on the mirror by forgery; sign refuses only a key the MIRROR's own folder revokes
      ctx.cli(["sign", "--root", mirror.folder, "--key", a.private, "--origin", mirror.origin]);
      ctx.changed.push("northgate-mirror/plumbline.signature.json");
      return { note: `the mirror (the forgery's altered files) is now signed with key A (${a.kid}) for the mirror's own origin ${mirror.origin}, not the clinic's` };
    },
    expire(ctx) {
      const sigFile = ctx.file("northgate-clinic", "plumbline.signature.json");
      if (!existsSync(sigFile)) throw new Refused("expire re-signs the clinic with key A: the clinic is not signed (play signed)");
      const sig = readJson(sigFile);
      const a = ctx.state.keyFiles["clinic-a"];
      if (Date.parse(sig.expiresAt) < Date.now()) return { already: true, note: `the clinic's signature already expired at ${sig.expiresAt}` };
      if (!a || sig.kid !== a.kid) throw new Refused(`the clinic is now signed by ${sig.kid}, not key A (${a?.kid}); expire re-signs with key A only, and would undo that`);
      try {
        ctx.sign("northgate-clinic", "clinic-a", ["--now", daysAgo(31), "--days", "30"]);
      } catch (error) {
        throw new Refused(`sign refused to re-sign with key A (${String(error.message).slice(0, 300)})`);
      }
      ctx.changed.push("northgate-clinic/site/plumbline.signature.json");
      return { note: `re-signed with key A dated ${daysAgo(31)} for 30 days: expiresAt is one day past. It signs the clinic's files as they are now (a tamper played before is now covered)` };
    },
    "attacker-rotates"(ctx) {
      if (existsSync(ctx.file("northgate-mirror", "plumbline-rotation.json"))) return { already: true, note: "the mirror already publishes a rotation" };
      if (!existsSync(ctx.file("northgate-mirror", "plumbline.signature.json"))) throw new Refused("attacker-rotates acts on the mirror: play forgery first");
      const a = ctx.state.keyFiles["clinic-a"];
      const evil = ctx.keygen("attacker");
      const mirror = ctx.site("northgate-mirror");
      ctx.cli(["rotate", "--root", mirror.folder, "--old-key", a.private, "--new-key", evil.private]);
      ctx.publishKey("attacker", "northgate-mirror");
      ctx.cli(["sign", "--root", mirror.folder, "--key", evil.private, "--origin", ctx.site("northgate-clinic").origin]);
      ctx.changed.push("northgate-mirror/plumbline-rotation.json", "northgate-mirror/plumbline.signature.json");
      return { note: `the mirror publishes a rotation ${a.kid} -> ${evil.kid} (the attacker's key, keys/attacker), the attacker's key record, and is signed with it for the clinic's origin` };
    },
  },

  "tallow-finch": {
    async portfolio(ctx) {
      if (existsSync(ctx.file("alder-bakery", "plumbline.signature.json"))) return { already: true, note: "the portfolio is already in place" };
      const lock = (name, extra = []) => ctx.cli(["init", "--root", ctx.site(name).folder, ...extra], { ok: [0, 1] });
      const signed = (name, extra = []) => {
        ctx.keygen(name);
        ctx.publishKey(name, name);
        ctx.sign(name, name, extra);
      };
      lock("alder-bakery");
      signed("alder-bakery");
      lock("brightwater-swim");
      lock("copperleaf-dental");
      lock("dunmore-books");
      // elm-street-vets: no lock, a missing network file (the fixture has none)
      lock("fernhill-hotel");
      signed("fernhill-hotel", ["--now", daysAgo(60), "--days", "30"]);
      lock("glenrock-gym");
      signed("glenrock-gym");
      ctx.replaceOnce("glenrock-gym", "glenrock_gym.network.json", "Membership is £34 a month", "Membership is £39 a month");
      lock("harbourlight-cafe", ["--source", "menu.html"]);
      ctx.replaceOnce("harbourlight-cafe", "menu.html", "Fish soup £9.50.", "Fish soup £10.50.");
      // ivy-lane-florist: no lock, not signed
      lock("juniper-yoga");
      signed("juniper-yoga");
      await ctx.behave("juniper-yoga", { state: "slow", delayMs: 12000 });
      lock("kestrel-plumbing");
      signed("kestrel-plumbing");
      await ctx.behave("kestrel-plumbing", { state: "down" });
      // lumen-opticians: the manifest is not JSON (the fixture); no lock
      return { note: "twelve clients in their states; each site's `state` in the map says which" };
    },
    "fix-launch"(ctx) {
      const file = "dunmore_books.network.json";
      const text = ctx.read("dunmore-books", file);
      const dup = `  "commondefs": {
    "replacement_strings": {
      "return_policy": "All sales are final: we do not take returns or give refunds."
    }
  },
`;
      if (!text.includes(dup)) return { already: true, note: "the repeated commondefs key is already gone" };
      ctx.write("dunmore-books", file, text.replace(dup, ""));
      return { note: "dunmore_books.network.json: the repeated commondefs key removed; one commondefs states the 30-day returns policy the page states. The lock was not rewritten" };
    },
  },

  "kiln-row": {
    onboarded(ctx) {
      if (existsSync(ctx.file("kiln-row", "plumbline.lock.json"))) return { already: true, note: "the marketplace is already locked" };
      for (const [seller, key] of [["ashgrove-pottery", "ashgrove-1"], ["brackenfold-ceramics", "brackenfold-1"]]) {
        ctx.keygen(key);
        ctx.publishKey(key, seller);
        ctx.sign(seller, key);
      }
      // the earlier setup: a lock over the four sellers, with the daily workflow; the Agent Card is not in it.
      // Exit 1 is expected: the sellers are on loopback addresses the watch does not contact (see env.md).
      ctx.cli(["init", "--root", "site", "--workflow"], { cwd: ctx.site("kiln-row").repo, ok: [0, 1] });
      ctx.changed.push("kiln-row/site/plumbline.lock.json", "kiln-row/.github/workflows/plumbline-watch.yml");
      return { note: "sellers ashgrove-pottery (ashgrove-1) and brackenfold-ceramics (brackenfold-1) signed; copperwick-glass unsigned; the marketplace locked by init" };
    },
    "seller-rotates"(ctx) {
      if (existsSync(ctx.file("ashgrove-pottery", "plumbline-rotation.json"))) return { already: true, note: "ashgrove-pottery already published its rotation" };
      const old = ctx.state.keyFiles["ashgrove-1"];
      if (!old) throw new Refused("seller-rotates rotates from ashgrove-1: play onboarded first");
      const next = ctx.keygen("ashgrove-2");
      ctx.cli(["rotate", "--root", ctx.site("ashgrove-pottery").folder, "--old-key", old.private, "--new-key", next.private]);
      ctx.publishKey("ashgrove-2", "ashgrove-pottery");
      ctx.sign("ashgrove-pottery", "ashgrove-2");
      ctx.changed.push("ashgrove-pottery/plumbline-rotation.json", "ashgrove-pottery/plumbline.signature.json");
      return { note: `ashgrove-pottery: rotation ${old.kid} -> ${next.kid} published, new key record published, signed with ashgrove-2` };
    },
    "seller-signer-swapped"(ctx) {
      const other = ctx.state.keyFiles["brackenfold-other"];
      if (other && readJson(ctx.file("brackenfold-ceramics", "plumbline.signature.json")).kid === other.kid) {
        return { already: true, note: "brackenfold-ceramics is already signed by the other key" };
      }
      if (!ctx.state.keyFiles["brackenfold-1"]) throw new Refused("seller-signer-swapped changes brackenfold-ceramics' signer: play onboarded first");
      ctx.keygen("brackenfold-other");
      ctx.publishKey("brackenfold-other", "brackenfold-ceramics");
      ctx.sign("brackenfold-ceramics", "brackenfold-other");
      ctx.changed.push("brackenfold-ceramics/plumbline.signature.json");
      return { note: `brackenfold-ceramics: signed by ${ctx.state.keyFiles["brackenfold-other"].kid} instead of ${ctx.state.keyFiles["brackenfold-1"].kid}, with that key's record; no rotation file` };
    },
    async "seller-offline"(ctx) {
      if (ctx.behaviourOf("dovetail-weaving").state === "down") return { already: true, note: "dovetail-weaving is already offline" };
      await ctx.behave("dovetail-weaving", { state: "down" });
      return { note: "dovetail-weaving's port now refuses connections" };
    },
    async "seller-back"(ctx) {
      if (ctx.behaviourOf("dovetail-weaving").state === "up") return { already: true, note: "dovetail-weaving is already answering" };
      await ctx.behave("dovetail-weaving", { state: "up" });
      return { note: "dovetail-weaving answers again" };
    },
    // Added after run 2026-11-18-first-five (Tomasz's walker had to construct it): the flaky seller comes back CHANGED
    // (an agent added, which the front agent calls) and signed under a key it never had. Played while it is offline,
    // it brings the seller back up with the change in place.
    async "seller-back-changed"(ctx) {
      const file = "dovetail_loom.network.json";
      const text = ctx.read("dovetail-weaving", file);
      const net = JSON.parse(text);
      const key = ctx.state.keyFiles["dovetail-new"];
      if (net.tools.some((a) => a.name === "deposit_taker") && key && existsSync(ctx.file("dovetail-weaving", "plumbline.signature.json"))) {
        return { already: true, note: "dovetail-weaving already came back with deposit_taker and a signature" };
      }
      if (ctx.behaviourOf("dovetail-weaving").state !== "down") {
        throw new Refused("seller-back-changed brings dovetail-weaving back changed from an outage: play seller-offline first");
      }
      net.tools[0].tools.push("deposit_taker");
      net.tools.push({
        name: "deposit_taker",
        function: { description: "Takes a deposit on a commission." },
        instructions: "Take a 30% deposit on any commissioned throw or rug before the loom is set up. Send the shopper the payment link from Dovetail's payments page.",
        tools: [],
      });
      ctx.write("dovetail-weaving", file, `${JSON.stringify(net, null, indentOf(text))}\n`);
      const fresh = ctx.keygen("dovetail-new");
      ctx.publishKey("dovetail-new", "dovetail-weaving");
      ctx.sign("dovetail-weaving", "dovetail-new");
      ctx.changed.push("dovetail-weaving/plumbline.signature.json");
      await ctx.behave("dovetail-weaving", { state: "up" });
      return { note: `dovetail-weaving answers again, changed: agent deposit_taker added (loom_keeper now calls it), and signed for the first time, with a new key dovetail-new (${fresh.kid})` };
    },
    "card-skills-change"(ctx) {
      const file = ".well-known/agent-card.json";
      const text = ctx.read("tidewater-studio", file);
      const card = JSON.parse(text);
      if (card.skills.some((s) => s.id === "glaze-matcher")) return { already: true, note: "the card already lists glaze-matcher" };
      const quote = card.skills.find((s) => s.id === "commission-quote");
      quote.description = "Collects what a commission needs (pieces, quantities, glaze, deadline, delivery address region) and returns a provisional price band and the studio's current lead time. A deposit link follows by e-mail.";
      quote.tags = ["ceramics", "commission", "quote", "pricing"];
      card.skills.push({
        id: "glaze-matcher",
        name: "Glaze matcher",
        description: "Matches a photo of an existing piece to the studio's glaze library, for replacements and additions to a set.",
        tags: ["ceramics", "glaze", "image"],
        examples: ["Can you match the glaze on this plate from my grandmother's set?"],
        inputModes: ["image/jpeg", "image/png", "text/plain"],
        outputModes: ["text/plain"],
      });
      card.version = "2.4.0";
      ctx.write("tidewater-studio", file, `${JSON.stringify(card, null, 2)}\n`);
      return { note: "the Agent Card: skill glaze-matcher added; commission-quote's description and tags changed; version 2.3.0 -> 2.4.0" };
    },
    async "card-offline"(ctx) {
      if (ctx.behaviourOf("tidewater-studio").state === "down") return { already: true, note: "tidewater-studio is already offline" };
      await ctx.behave("tidewater-studio", { state: "down" });
      return { note: "tidewater-studio's port (and so the Agent Card) now refuses connections" };
    },
    async "card-back"(ctx) {
      if (ctx.behaviourOf("tidewater-studio").state === "up") return { already: true, note: "tidewater-studio is already answering" };
      await ctx.behave("tidewater-studio", { state: "up" });
      return { note: "tidewater-studio answers again" };
    },
    "seller-signs"(ctx) {
      if (existsSync(ctx.file("copperwick-glass", "plumbline.signature.json"))) return { already: true, note: "copperwick-glass already publishes a signature" };
      ctx.keygen("copperwick-1");
      ctx.publishKey("copperwick-1", "copperwick-glass");
      ctx.sign("copperwick-glass", "copperwick-1");
      ctx.changed.push("copperwick-glass/plumbline.signature.json");
      return { note: `copperwick-glass: signed with copperwick-1 (${ctx.state.keyFiles["copperwick-1"].kid}), key record published` };
    },
  },
};

async function playAct(state, act) {
  const def = worldDef(state.world);
  if (!Object.hasOwn(def.acts, act) || !Object.hasOwn(ACTS[state.world], act)) {
    throw new UsageError(`unknown act "${act}" for ${state.world}; acts: ${Object.keys(def.acts).join(", ")}`);
  }
  if (!alive(state.pid)) throw new UsageError(`${state.world}'s server (pid ${state.pid}) is not running; run down, then up`);
  state.currentAct = act;
  const ctx = context(state);
  let result;
  try {
    result = await ACTS[state.world][act](ctx);
  } finally {
    delete state.currentAct;
    saveState(state);
  }
  if (!result.already) {
    state.played.push(act);
    saveState(state);
  }
  return { world: state.world, act, already: result.already === true, note: result.note, changed: ctx.changed, ran: ctx.ran };
}

// ---------------------------------------------------------------------------------------------------------- commands

function mapOf(state) {
  const def = worldDef(state.world);
  return {
    world: state.world,
    journey: def.journey,
    character: def.character,
    dir: state.dir,
    stateFile: stateFile(state.world),
    serverPid: state.pid,
    sites: state.sites.map((s) => ({
      name: s.name,
      role: s.role,
      ...(s.state ? { state: s.state } : {}),
      folder: s.folder,
      ...(s.repo ? { repo: s.repo } : {}),
      address: s.address,
      origin: s.origin,
      port: s.port,
      behaviour: s.behaviour ?? { state: "up" },
    })),
    ...(state.extras.length ? { extras: state.extras } : {}),
    desk: { address: `http://127.0.0.1:${state.deskPort}/`, port: state.deskPort, folder: DESK, note: "the built Desk from this repository's site/, served read-only" },
    keys: path.join(state.dir, "keys"),
    keyFiles: state.keyFiles,
    played: state.played,
    acts: def.acts,
    logs: { requests: path.join(state.dir, "_world", "requests.log"), cli: path.join(state.dir, "_world", "cli.log"), history: path.join(state.dir, "_world", "history") },
  };
}

async function up(world, options) {
  const def = worldDef(world);
  const file = stateFile(world);
  if (existsSync(file)) {
    const old = readJson(file);
    if (alive(old.pid)) throw new UsageError(`${world} is already up in ${old.dir} (server pid ${old.pid}); run: node uat/driver/world.mjs down ${world}`);
    rmSync(old.dir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(file, { force: true });
  }
  if (!existsSync(CLI)) throw new UsageError(`the CLI is not built (${CLI} is missing); run: npm run build`);
  if (!existsSync(path.join(DESK, "lib", "plumbline"))) throw new UsageError("the Desk is not built (site/lib/plumbline/ is missing); run: npm run build:site");
  const portBase = options.portBase ?? def.portBase;
  const ports = [...def.sites.map((_, i) => portBase + i), portBase + DESK_OFFSET];
  for (const p of ports) if (!(await portFree(p))) throw new UsageError(`port ${p} on 127.0.0.1 is in use; free it or pass --port-base <n>`);

  const dir = mkdtempSync(path.join(os.tmpdir(), `plumbline-uat-${world}-`));
  try {
    const worldDir = path.join(dir, "_world");
    mkdirSync(worldDir, { recursive: true });
    const sites = def.sites.map((s, i) => {
      const port = portBase + i;
      const top = path.join(dir, s.name);
      return {
        name: s.name,
        role: s.role,
        ...(s.state ? { state: s.state } : {}),
        port,
        origin: `http://127.0.0.1:${port}`,
        address: `http://127.0.0.1:${port}/`,
        folder: s.repo ? path.join(top, "site") : top,
        ...(s.repo ? { repo: top } : {}),
        runtime: s.runtime,
      };
    });
    for (const s of def.sites) cpSync(path.join(FIXTURES, world, s.name), path.join(dir, s.name), { recursive: true });
    for (const s of sites) if (s.runtime) cpSync(path.join(FIXTURES, "_runtime", s.runtime), path.join(s.folder, "runtime"), { recursive: true });
    const extras = (def.extras ?? []).map((e) => {
      cpSync(path.join(FIXTURES, world, e.name), path.join(dir, e.name), { recursive: true });
      return { name: e.name, role: e.role, folder: path.join(dir, e.name) };
    });
    // addresses are known only now: {{site:<name>}} -> http://127.0.0.1:<port>
    const byName = new Map(sites.map((s) => [s.name, s.origin]));
    for (const f of walk(dir)) {
      if (f.startsWith(worldDir) || !TEXT_EXT.has(path.extname(f).toLowerCase())) continue;
      const text = readFileSync(f, "utf8");
      if (!text.includes("{{site:")) continue;
      writeFileSync(
        f,
        text.replace(/\{\{site:([a-z0-9-]+)\}\}/g, (_, name) => {
          if (!byName.has(name)) throw new Error(`${f}: unknown site placeholder {{site:${name}}}`);
          return byName.get(name);
        }),
      );
    }
    mkdirSync(path.join(dir, "keys"), { recursive: true });
    writeFileSync(path.join(worldDir, "layout.json"), JSON.stringify({ sites: sites.map(({ name, folder, port }) => ({ name, root: folder, port })), desk: { root: DESK, port: portBase + DESK_OFFSET } }, null, 2));
    writeFileSync(path.join(worldDir, "control.json"), JSON.stringify({ generation: 1, sites: {} }, null, 2));
    writeFileSync(path.join(worldDir, "cli.log"), "");
    writeFileSync(path.join(worldDir, "requests.log"), "");

    const child = spawn(process.execPath, [SERVE, dir], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    await until(() => {
      try {
        const st = readJson(path.join(worldDir, "status.json"));
        if (st.error) throw new Error(`the server could not start: ${st.error}`);
        return st.generation === 1 && Object.values(st.listening).every(Boolean);
      } catch (error) {
        if (String(error.message).startsWith("the server")) throw error;
        if (!alive(child.pid)) throw new Error("the server process exited at start");
        return false;
      }
    }, "the world's servers to listen");

    const state = { world, dir, pid: child.pid, portBase, deskPort: portBase + DESK_OFFSET, sites, extras, keyFiles: {}, played: [], startedAt: new Date().toISOString() };
    saveState(state);
    let start;
    if (!options.noStart) {
      start = await playAct(state, def.start);
    }
    return { ...mapOf(state), ...(start ? { start: { act: start.act, note: start.note, ran: start.ran } } : { start: { act: def.start, skipped: "--no-start" } }) };
  } catch (error) {
    // never leave a half-made world behind
    try {
      const st = readJson(path.join(dir, "_world", "status.json"));
      if (alive(st.pid)) process.kill(st.pid);
    } catch {
      // no server was started
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(stateFile(world), { force: true });
    throw error;
  }
}

async function down(world) {
  worldDef(world);
  const file = stateFile(world);
  const leftovers = () =>
    readdirSync(os.tmpdir())
      .filter((n) => n.startsWith(`plumbline-uat-${world}-`))
      .map((n) => path.join(os.tmpdir(), n));
  if (!existsSync(file)) return { world, stopped: false, note: `${world} was not up`, leftovers: leftovers() };
  const state = readJson(file);
  const worldDir = path.join(state.dir, "_world");
  if (alive(state.pid) && existsSync(path.join(worldDir, "control.json"))) {
    const control = readJson(path.join(worldDir, "control.json"));
    control.generation += 1;
    control.shutdown = true;
    writeAtomic(path.join(worldDir, "control.json"), JSON.stringify(control, null, 2));
    try {
      await until(() => !alive(state.pid), "the server to exit", 5000);
    } catch {
      process.kill(state.pid);
      await until(() => !alive(state.pid), "the server to be killed", 5000);
    }
  } else if (alive(state.pid)) {
    process.kill(state.pid);
  }
  const ports = [...state.sites.map((s) => s.port), state.deskPort];
  const busy = [];
  for (const p of ports) if (!(await portFree(p))) busy.push(p);
  rmSync(state.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const removed = !existsSync(state.dir);
  rmSync(file, { force: true });
  return { world, stopped: true, serverPid: state.pid, portsChecked: ports, portsStillInUse: busy, removed: state.dir, folderGone: removed, leftovers: leftovers() };
}

function list() {
  return {
    worlds: worlds().map((w) => {
      const def = worldDef(w);
      return {
        world: w,
        journey: def.journey,
        character: def.character,
        portBase: def.portBase,
        deskPort: def.portBase + DESK_OFFSET,
        up: existsSync(stateFile(w)),
        start: def.start,
        sites: def.sites.map((s, i) => ({ name: s.name, port: def.portBase + i, role: s.role, ...(s.state ? { state: s.state } : {}) })),
        acts: def.acts,
      };
    }),
  };
}

const USAGE = `usage:
  node uat/driver/world.mjs up <world> [--port-base <n>] [--no-start]
  node uat/driver/world.mjs act <world> <act>
  node uat/driver/world.mjs status <world>
  node uat/driver/world.mjs down <world>
  node uat/driver/world.mjs list`;

async function main(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--port-base") {
      const n = Number(rest[++i]);
      if (!Number.isInteger(n) || n < 1024 || n > 65000) throw new UsageError("--port-base takes a port number from 1024 to 65000");
      options.portBase = n;
    } else if (rest[i] === "--no-start") options.noStart = true;
    else if (rest[i].startsWith("--")) throw new UsageError(`unknown option ${rest[i]}`);
    else positional.push(rest[i]);
  }
  const need = (n) => {
    if (positional.length !== n) throw new UsageError(USAGE);
  };
  switch (command) {
    case "up":
      need(1);
      return up(positional[0], options);
    case "act": {
      need(2);
      worldDef(positional[0]);
      return playAct(load(positional[0]), positional[1]);
    }
    case "status":
      need(1);
      worldDef(positional[0]);
      return { ...mapOf(load(positional[0])), serverRunning: alive(load(positional[0]).pid) };
    case "down":
      need(1);
      return down(positional[0]);
    case "list":
      need(0);
      return list();
    default:
      throw new UsageError(USAGE);
  }
}

try {
  print(await main(process.argv.slice(2)));
  process.exitCode = 0;
} catch (error) {
  if (error instanceof Refused) {
    print({ refused: error.message });
    process.exitCode = 1;
  } else {
    print({ error: error.message });
    if (error instanceof UsageError) process.stderr.write(`${error.message}\n`);
    else process.stderr.write(`${error.stack}\n`);
    process.exitCode = 2;
  }
}
