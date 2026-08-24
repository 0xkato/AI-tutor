import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "release-check.yml");

test("CI runs the complete release check on the supported uncached macOS matrix", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /runs-on:\s*macos-14/);
  assert.match(workflow, /node-version:\s*\["20\.x", "22\.x"\]/);
  assert.match(workflow, /uses:\s*actions\/checkout@v4/);
  assert.match(workflow, /uses:\s*actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*\$\{\{ matrix\.node-version \}\}/);
  assert.match(workflow, /run:\s*npm run release-check/);
  assert.match(workflow, /run:\s*git diff --exit-code/);
  assert.doesNotMatch(workflow, /^\s*cache:/m);
});
