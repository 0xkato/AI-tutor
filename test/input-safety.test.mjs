import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectVisual,
  safeIdentifier,
  safeSingleLine,
  validateSourceReference,
} from "../src/inputs.mjs";
import { addSource, addVisual, createInitialState, getActiveSession, startSession } from "../src/model.mjs";
import { dueReviews } from "../src/retention.mjs";

const now = "2026-08-24T08:00:00.000Z";

function activeState() {
  return startSession(createInitialState({ now }), {
    id: "session-1",
    topicId: "topic-1",
    topic: "Input safety",
    target: "Understand which external values can enter durable state",
    now,
  });
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-inputs-"));
}

test("single-line identifiers reject controls, line breaks, and oversized input", () => {
  assert.throws(() => safeIdentifier("node\nnext", "node id"), /single line/);
  assert.throws(() => safeIdentifier("node\u0000next", "node id"), /control character/);
  assert.throws(() => safeIdentifier("x".repeat(257), "node id"), /at most 256/);
  assert.throws(() => safeSingleLine("title\r\nheading", "title"), /single line/);
});

test("source references allow web URLs and explicit local references only", () => {
  assert.equal(validateSourceReference("https://example.test/paper?q=1"), "https://example.test/paper?q=1");
  assert.equal(validateSourceReference("http://localhost:8080/reference"), "http://localhost:8080/reference");
  assert.equal(validateSourceReference("local:docs/reference.pdf"), "local:docs/reference.pdf");
  for (const unsafe of [
    "javascript:alert(1)",
    "data:text/plain,secret",
    "file:///tmp/reference",
    "local:",
    "https://example.test/ok\njavascript:alert(1)",
  ]) {
    assert.throws(() => validateSourceReference(unsafe), /source reference/i);
  }
});

test("model actions reject invalid instants and unsafe source references", () => {
  assert.throws(
    () =>
      startSession(createInitialState({ now }), {
        topic: "Dates",
        target: "Reject ambiguous dates",
        now: "2026-08-24",
      }),
    /canonical ISO instant/,
  );
  assert.throws(
    () =>
      addSource(activeState(), {
        title: "Unsafe",
        url: "javascript:alert(1)",
        sourceClass: "primary",
        supports: "Nothing",
        verification: "Not verified",
        now,
      }),
    /source reference/i,
  );
  assert.throws(
    () => dueReviews(createInitialState({ now }), { now: "2026-08-24" }),
    /canonical ISO instant/,
  );
});

test("visual inspection stays inside the vault and captures deterministic identity", () => {
  const root = tempRoot();
  const vault = path.join(root, "vault");
  const assets = path.join(vault, "Assets");
  fs.mkdirSync(assets, { recursive: true });
  const contents = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n");
  fs.writeFileSync(path.join(assets, "diagram.svg"), contents);
  fs.mkdirSync(path.join(assets, "folder"));
  fs.symlinkSync(path.join(assets, "diagram.svg"), path.join(assets, "linked.svg"));
  const outside = path.join(root, "outside.svg");
  fs.writeFileSync(outside, contents);

  const state = createInitialState({ now });
  const inspected = inspectVisual(root, state, "Assets/diagram.svg");
  assert.deepEqual(inspected, {
    path: "Assets/diagram.svg",
    bytes: contents.length,
    mediaType: "image/svg+xml",
    sha256: createHash("sha256").update(contents).digest("hex"),
  });

  assert.throws(() => inspectVisual(root, state, "Assets/missing.svg"), /does not exist/);
  assert.throws(() => inspectVisual(root, state, "Assets/folder"), /regular file/);
  assert.throws(() => inspectVisual(root, state, "Assets/linked.svg"), /symlink/);
  assert.throws(() => inspectVisual(root, state, "../outside.svg"), /relative vault path/);
});

test("visual records require captured file identity", () => {
  const state = activeState();
  assert.throws(
    () =>
      addVisual(state, {
        path: "Assets/diagram.svg",
        description: "A diagram",
        verification: "Inspected all labels.",
        now,
      }),
    /visual bytes/,
  );

  const next = addVisual(state, {
    id: "visual-1",
    path: "Assets/diagram.svg",
    description: "A diagram",
    verification: "Inspected all labels.",
    bytes: 42,
    mediaType: "image/svg+xml",
    sha256: "a".repeat(64),
    now,
  });
  assert.deepEqual(
    getActiveSession(next).visuals[0],
    {
      id: "visual-1",
      path: "Assets/diagram.svg",
      description: "A diagram",
      verification: "Inspected all labels.",
      identityStatus: "verified",
      bytes: 42,
      mediaType: "image/svg+xml",
      sha256: "a".repeat(64),
      createdAt: now,
    },
  );
});
