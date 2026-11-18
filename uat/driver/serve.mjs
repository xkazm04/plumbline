// The world's static servers, one process for every site of one world plus the Desk. Started detached by
// `world.mjs up`; never run by hand. Plain Node, no dependency.
//
//   node uat/driver/serve.mjs <world temp folder>
//
// It reads <dir>/_world/layout.json (each site's served folder and port, and the Desk's) and polls
// <dir>/_world/control.json every 100 ms for each site's behaviour:
//   { "state": "up" | "down" | "slow", "delayMs": <n>, "notFound": ["/path", ...] }
// "down" closes the site's listener (connections are refused); "slow" holds every response for delayMs;
// "notFound" answers 404 for those paths; "noCors" serves those paths WITHOUT Access-Control-Allow-Origin (an ordinary
// host's default). It acknowledges each control generation in <dir>/_world/status.json, so
// world.mjs waits on that predicate instead of sleeping. `shutdown: true` closes everything and exits; so does a
// control file that has disappeared (the world folder was removed), so a server is never left behind.
// Every response carries Access-Control-Allow-Origin: * (unless "noCors" names its path) and Cache-Control: no-store. Each request is appended to
// <dir>/_world/requests.log (time, site, method, path, status), which shows what the product fetched.

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const dir = process.argv[2];
if (!dir || !existsSync(path.join(dir, "_world", "layout.json"))) {
  process.stderr.write("usage: node uat/driver/serve.mjs <world temp folder holding _world/layout.json>\n");
  process.exit(2);
}
const worldDir = path.join(dir, "_world");
const layout = JSON.parse(readFileSync(path.join(worldDir, "layout.json"), "utf8"));
const controlFile = path.join(worldDir, "control.json");
const statusFile = path.join(worldDir, "status.json");
const logFile = path.join(worldDir, "requests.log");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".hocon": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
};

/** Headers the Desk's _headers file asks of a host (site/_headers), for the paths it names. */
function deskHeaders(urlPath) {
  const h = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (urlPath === "/" || urlPath === "/index.html") h["Content-Security-Policy"] = "frame-ancestors 'none'";
  if (urlPath === "/runtime/sandbox-worker.js") {
    h["Content-Security-Policy"] = "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'";
  }
  return h;
}

let control = { generation: 0, sites: {} };
let started = false;
let missingSince = 0;
const servers = new Map(); // name -> { server, listening }
const entries = [...layout.sites.map((s) => ({ ...s, desk: false })), { name: "desk", root: layout.desk.root, port: layout.desk.port, desk: true }];

function log(site, method, urlPath, status) {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${site} ${method} ${urlPath} ${status}\n`);
  } catch {
    // the world folder is going away; the poll loop exits
  }
}

function behaviourOf(name) {
  return control.sites?.[name] ?? { state: "up" };
}

function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const full = path.resolve(root, `.${decoded}`);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    const st = statSync(full);
    if (st.isDirectory()) {
      const index = path.join(full, "index.html");
      return existsSync(index) ? index : null;
    }
    return st.isFile() ? full : null;
  } catch {
    return null;
  }
}

function handler(entry) {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const urlPath = url.pathname;
    const noCors = !entry.desk && (behaviourOf(entry.name).noCors ?? []).includes(urlPath);
    const base = { ...(noCors ? {} : { "Access-Control-Allow-Origin": "*" }), "Cache-Control": "no-store", ...(entry.desk ? deskHeaders(urlPath) : {}) };
    const answer = () => {
      if (res.destroyed) return;
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...base, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "*" });
        res.end();
        log(entry.name, req.method, urlPath, 204);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...base, Allow: "GET, HEAD, OPTIONS" });
        res.end();
        log(entry.name, req.method, urlPath, 405);
        return;
      }
      const b = entry.desk ? { state: "up" } : behaviourOf(entry.name);
      const file = (b.notFound ?? []).includes(urlPath) ? null : resolveFile(entry.root, urlPath);
      if (file === null) {
        res.writeHead(404, { ...base, "Content-Type": "text/plain; charset=utf-8" });
        res.end(req.method === "HEAD" ? undefined : "Not found\n");
        log(entry.name, req.method, urlPath, 404);
        return;
      }
      let body;
      try {
        body = readFileSync(file);
      } catch {
        res.writeHead(500, base);
        res.end();
        log(entry.name, req.method, urlPath, 500);
        return;
      }
      res.writeHead(200, { ...base, "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
      log(entry.name, req.method, urlPath, 200);
    };
    const b = entry.desk ? { state: "up" } : behaviourOf(entry.name);
    if (b.state === "slow" && Number(b.delayMs) > 0) {
      const t = setTimeout(answer, Number(b.delayMs));
      req.on("close", () => {
        if (!res.writableEnded) clearTimeout(t);
      });
    } else answer();
  };
}

function start(entry) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler(entry));
    server.keepAliveTimeout = 1000;
    server.once("error", reject);
    server.listen(entry.port, "127.0.0.1", () => {
      server.off("error", reject);
      servers.set(entry.name, server);
      resolve();
    });
  });
}

function stop(name) {
  const server = servers.get(name);
  if (!server) return Promise.resolve();
  servers.delete(name);
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function writeStatus(extra = {}) {
  const status = {
    pid: process.pid,
    generation: control.generation,
    listening: Object.fromEntries(entries.map((e) => [e.name, servers.has(e.name)])),
    ...extra,
  };
  try {
    const tmp = `${statusFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(status, null, 2));
    renameSync(tmp, statusFile);
  } catch {
    // the world folder is going away
  }
}

async function shutdown(code) {
  for (const e of entries) await stop(e.name);
  writeStatus({ stopped: true });
  process.exit(code);
}

let applying = false;
async function poll() {
  if (applying) return;
  applying = true;
  try {
    if (!existsSync(controlFile)) {
      missingSince ||= Date.now();
      if (Date.now() - missingSince > 2000) await shutdown(0);
      return;
    }
    missingSince = 0;
    let next;
    try {
      next = JSON.parse(readFileSync(controlFile, "utf8"));
    } catch {
      return; // half-written; the next poll reads it whole
    }
    if (started && next.generation === control.generation) return;
    started = true;
    control = next;
    if (control.shutdown === true) return await shutdown(0);
    for (const e of entries) {
      const want = e.desk || behaviourOf(e.name).state !== "down";
      if (want && !servers.has(e.name)) await start(e);
      if (!want && servers.has(e.name)) await stop(e.name);
    }
    writeStatus();
  } catch (error) {
    writeStatus({ error: String(error?.message ?? error) });
  } finally {
    applying = false;
  }
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
await poll();
setInterval(poll, 100);
