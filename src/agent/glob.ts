// The declaration's file globs. Pure: no node:* import, no dependency.
//
// A glob is a repository path (`/` separators) whose segments may hold `*`, matching any run of characters inside one
// segment (a leading `.` included: `.claude/*` matches `.claude/settings.json`), or be `**`, matching any number of
// whole segments, none included. Nothing else is special: no `?`, no braces, no classes, no negation.

/** True when `path` (repository-relative, `/` separators) matches `glob`. */
export function globMatch(glob: string, path: string): boolean {
  const g = glob.split("/");
  const p = path.split("/");
  // memo over (glob segment, path segment): `**` would otherwise try every split again and again
  const seen = new Map<number, boolean>();
  const at = (i: number, j: number): boolean => {
    const key = i * (p.length + 1) + j;
    const cached = seen.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === g.length) result = j === p.length;
    else if (g[i] === "**") result = at(i + 1, j) || (j < p.length && at(i, j + 1));
    else result = j < p.length && segmentMatch(g[i] as string, p[j] as string) && at(i + 1, j + 1);
    seen.set(key, result);
    return result;
  };
  return at(0, 0);
}

/** One segment against a pattern whose only special character is `*`. */
function segmentMatch(pattern: string, segment: string): boolean {
  const pieces = pattern.split("*");
  if (pieces.length === 1) return pattern === segment;
  const first = pieces[0] as string;
  const last = pieces[pieces.length - 1] as string;
  if (segment.length < first.length + last.length || !segment.startsWith(first) || !segment.endsWith(last)) return false;
  let from = first.length;
  const end = segment.length - last.length;
  for (const piece of pieces.slice(1, -1)) {
    const found = segment.indexOf(piece, from);
    if (found < 0 || found + piece.length > end) return false;
    from = found + piece.length;
  }
  return true;
}

/** The paths any glob matches, sorted, each once. */
export function expandGlobs(globs: readonly string[], paths: readonly string[]): string[] {
  return paths.filter((path) => globs.some((glob) => globMatch(glob, path))).sort(byPath);
}

/** Code-unit order, so a lock written on any machine lists files the same way. */
export const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
