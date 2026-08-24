import assert from "node:assert/strict";
import test from "node:test";

import {
  mermaidForPlan,
  nextFrontier,
  topologicalOrder,
  validatePlan,
} from "../src/graph.mjs";

function plan(overrides = {}) {
  return {
    targetNodeId: "forms",
    nodes: [
      { id: "vectors", title: "Vectors" },
      { id: "covectors", title: "Covectors" },
      { id: "forms", title: "Differential forms" },
    ],
    edges: [
      { from: "vectors", to: "covectors", reason: "Covectors act on vectors" },
      { from: "covectors", to: "forms", reason: "Forms generalize covectors" },
    ],
    ...overrides,
  };
}

test("validatePlan rejects edges that reference missing nodes", () => {
  const value = plan({
    edges: [{ from: "missing", to: "forms", reason: "Broken" }],
  });
  assert.throws(() => validatePlan(value), /unknown node: missing/);
});

test("validatePlan rejects self-edges", () => {
  const value = plan({
    edges: [{ from: "forms", to: "forms", reason: "Loop" }],
  });
  assert.throws(() => validatePlan(value), /self-edge: forms/);
});

test("validatePlan rejects dependency cycles", () => {
  const value = plan({
    edges: [
      { from: "vectors", to: "covectors", reason: "First" },
      { from: "covectors", to: "forms", reason: "Second" },
      { from: "forms", to: "vectors", reason: "Cycle" },
    ],
  });
  assert.throws(() => validatePlan(value), /dependency cycle/);
});

test("validatePlan rejects a disconnected node that cannot lead to the target", () => {
  const value = plan({
    nodes: [
      { id: "vectors", title: "Vectors" },
      { id: "covectors", title: "Covectors" },
      { id: "forms", title: "Differential forms" },
      { id: "surplus", title: "Unrelated surplus" },
    ],
  });
  assert.throws(() => validatePlan(value), /surplus.*does not lead to.*forms/i);
});

test("topologicalOrder is stable and prerequisite-first", () => {
  assert.deepEqual(topologicalOrder(plan()), ["vectors", "covectors", "forms"]);
});

test("nextFrontier starts after demonstrated prerequisites", () => {
  const knowledge = {
    vectors: { status: "developing" },
  };
  assert.deepEqual(nextFrontier(plan(), knowledge), ["covectors"]);
});

test("mermaidForPlan renders every node and labeled dependency", () => {
  const mermaid = mermaidForPlan(plan());
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /vectors\["Vectors"\]/);
  assert.match(mermaid, /vectors -->\|"Covectors act on vectors"\| covectors/);
  assert.match(mermaid, /class forms target/);
});
