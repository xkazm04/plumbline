// How the guard starts the server's command without a shell. On POSIX the command is spawned as given. On Windows,
// Node refuses to spawn a `.cmd` or `.bat` without a shell (CVE-2024-27980), and `npx`, the most common MCP server
// launcher, is `npx.cmd`; a shell would re-parse every argument. So a batch file that is a known npm shim is resolved to
// the node script it starts, and run with node directly; any other batch file is refused with a sentence. The lock's
// target is always computed from the command as the host's config wrote it, never from what it resolves to.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type Resolved = { ok: true; file: string; args: string[] } | { ok: false; problem: string };

export const BATCH_REFUSED =
  "the server command is a Windows batch file that is not an npm shim; the guard runs no shell, so give the program it starts as the command (for example node and the script)";

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The file a Windows command name runs: as given when it has a folder or an extension, else searched on PATH with PATHEXT. */
export function whichWindows(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "");
  const named = (base: string): string | undefined => {
    if (path.win32.extname(base) !== "" && isFile(base)) return base;
    for (const ext of exts) if (isFile(base + ext.toLowerCase())) return base + ext.toLowerCase(); // NTFS: case-insensitive
    return undefined;
  };
  if (/[\\/]/.test(command)) return named(command);
  const dirs = (env.Path ?? env.PATH ?? "").split(";").filter((d) => d !== "");
  for (const dir of dirs) {
    const found = named(path.win32.join(dir, command));
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The file and arguments to spawn for `command args` on this platform. On Windows a `.cmd`/`.bat` is run only when it is
 * npm's npx/npm shim (the node script beside it, `node_modules/npm/bin/<name>-cli.js`) or an npm cmd-shim of a package
 * bin (`"%dp0%\<script>" %*`); node is the `node.exe` beside the shim when there is one, else this node.
 */
export function resolveCommand(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Resolved {
  if (platform !== "win32") return { ok: true, file: command, args: [...args] };
  const found = whichWindows(command, env);
  if (found === undefined) return { ok: true, file: command, args: [...args] }; // spawn reports ENOENT
  const ext = path.win32.extname(found).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return { ok: true, file: found, args: [...args] };
  const dir = path.win32.dirname(found);
  const localNode = path.win32.join(dir, "node.exe");
  const node = existsSync(localNode) ? localNode : process.execPath;
  const base = path.win32.basename(found, path.win32.extname(found)).toLowerCase();
  if (base === "npx" || base === "npm") {
    const cli = path.win32.join(dir, "node_modules", "npm", "bin", `${base}-cli.js`);
    if (isFile(cli)) return { ok: true, file: node, args: [cli, ...args] };
  }
  let text: string;
  try {
    text = readFileSync(found, "utf8");
  } catch {
    return { ok: false, problem: BATCH_REFUSED };
  }
  // npm's cmd-shim: `"%_prog%"  "%dp0%\node_modules\pkg\bin\x.js" %*`
  const m = /"%dp0%\\([^"%]+\.(?:js|cjs|mjs))"\s+%\*/i.exec(text);
  if (m !== null && /%_prog%|node/i.test(text)) {
    const script = path.win32.resolve(dir, m[1] as string);
    if (isFile(script) && script.toLowerCase().startsWith(dir.toLowerCase() + "\\")) return { ok: true, file: node, args: [script, ...args] };
  }
  return { ok: false, problem: BATCH_REFUSED };
}
