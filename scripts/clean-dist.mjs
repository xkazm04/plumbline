// npm's prepack: remove dist/ before the build that the package is made from, so a module whose source was deleted
// or renamed since the last build cannot ride along in the tarball. dist/ is generated and git-ignored.

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
await rm(DIST, { recursive: true, force: true });
