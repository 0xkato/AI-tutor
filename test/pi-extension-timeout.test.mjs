import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAdaptiveLearningCli } from "../.pi/extensions/adaptive-learning.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pi-runner.mjs",
);
const root = path.join(os.tmpdir(), "adaptive-learning-pi-runner");

function runFixture(mode, options = {}) {
  return runAdaptiveLearningCli(mode, [], root, {
    cliPath: fixture,
    timeoutMs: 1_000,
    ...options,
  });
}

test("Pi runner returns successful JSON without blocking the event loop", async () => {
  let turnAdvanced = false;
  const pending = runFixture("wait");
  setImmediate(() => {
    turnAdvanced = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(turnAdvanced, true);
  assert.deepEqual(await pending, { ok: true, mode: "wait" });
});

test("Pi runner times out and terminates only its invocation", async () => {
  await assert.rejects(
    runFixture("wait", { timeoutMs: 25 }),
    (error) => error.code === "CLI_TIMEOUT" && /timed out/i.test(error.message),
  );
});

test("Pi runner follows an explicit cancellation signal", async () => {
  const controller = new AbortController();
  const pending = runFixture("wait", { signal: controller.signal });
  setTimeout(() => controller.abort(), 25);

  await assert.rejects(
    pending,
    (error) => error.code === "CLI_ABORTED" && /cancelled/i.test(error.message),
  );
});

test("Pi runner rejects malformed and excessive child output", async () => {
  await assert.rejects(
    runFixture("malformed"),
    (error) => error.code === "INVALID_CLI_OUTPUT",
  );
  await assert.rejects(
    runFixture("overflow", { maxOutputBytes: 1_024 }),
    (error) => error.code === "CLI_OUTPUT_LIMIT",
  );
});

test("Pi runner preserves structured CLI failure codes", async () => {
  await assert.rejects(
    runFixture("failure"),
    (error) => error.code === "FIXTURE_FAILURE" && /Fixture command failed/.test(error.message),
  );
});

test("Pi runner distinguishes a committed state from a render warning", async () => {
  await assert.rejects(
    runFixture("render-warning"),
    (error) =>
      error.code === "RENDER_FAILED" &&
      error.stateCommitted === true &&
      error.stateRevision === 7 &&
      error.repair?.command === "repair-render" &&
      error.repair?.root === root &&
      /state revision 7 was committed/i.test(error.message) &&
      /repair-render/i.test(error.message),
  );
});
