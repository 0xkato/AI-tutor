import { LearningError } from "./errors.mjs";

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LearningError(`${label} is required`, "INVALID_PLAN");
  }
  return value.trim();
}

function normalized(plan) {
  if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    throw new LearningError("plan requires at least one node", "INVALID_PLAN");
  }
  if (!Array.isArray(plan.edges)) {
    throw new LearningError("plan edges must be an array", "INVALID_PLAN");
  }

  const nodes = plan.nodes.map((node) => ({
    ...node,
    id: text(node?.id, "node id"),
    title: text(node?.title, "node title"),
  }));
  const ids = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      throw new LearningError(`duplicate node: ${node.id}`, "INVALID_PLAN");
    }
    ids.add(node.id);
  }

  const targetNodeId = text(plan.targetNodeId, "targetNodeId");
  if (!ids.has(targetNodeId)) {
    throw new LearningError(`unknown target node: ${targetNodeId}`, "INVALID_PLAN");
  }

  const seenEdges = new Set();
  const edges = plan.edges.map((edge) => {
    const from = text(edge?.from, "edge from");
    const to = text(edge?.to, "edge to");
    if (!ids.has(from)) {
      throw new LearningError(`unknown node: ${from}`, "INVALID_PLAN");
    }
    if (!ids.has(to)) {
      throw new LearningError(`unknown node: ${to}`, "INVALID_PLAN");
    }
    if (from === to) {
      throw new LearningError(`self-edge: ${from}`, "INVALID_PLAN");
    }
    const key = `${from}\u0000${to}`;
    if (seenEdges.has(key)) {
      throw new LearningError(`duplicate edge: ${from} -> ${to}`, "INVALID_PLAN");
    }
    seenEdges.add(key);
    return { ...edge, from, to, reason: text(edge?.reason, "edge reason") };
  });

  return { ...plan, targetNodeId, nodes, edges };
}

function orderUnchecked(plan) {
  const position = new Map(plan.nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(plan.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(plan.nodes.map((node) => [node.id, []]));
  for (const edge of plan.edges) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  const ready = plan.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const result = [];
  while (ready.length > 0) {
    const id = ready.shift();
    result.push(id);
    for (const dependent of outgoing.get(id)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort((left, right) => position.get(left) - position.get(right));
      }
    }
  }
  return result;
}

export function validatePlan(value) {
  const plan = normalized(value);
  if (orderUnchecked(plan).length !== plan.nodes.length) {
    throw new LearningError("dependency cycle", "INVALID_PLAN");
  }
  const prerequisites = new Map(plan.nodes.map((node) => [node.id, []]));
  for (const edge of plan.edges) prerequisites.get(edge.to).push(edge.from);
  const reachesTarget = new Set([plan.targetNodeId]);
  const pending = [plan.targetNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    for (const prerequisite of prerequisites.get(nodeId)) {
      if (reachesTarget.has(prerequisite)) continue;
      reachesTarget.add(prerequisite);
      pending.push(prerequisite);
    }
  }
  const surplus = plan.nodes.find((node) => !reachesTarget.has(node.id));
  if (surplus) {
    throw new LearningError(
      `${surplus.id} does not lead to target ${plan.targetNodeId}`,
      "INVALID_PLAN",
    );
  }
  return plan;
}

export function topologicalOrder(value) {
  return orderUnchecked(validatePlan(value));
}

function demonstrated(entry) {
  return entry?.status === "developing" || entry?.status === "strong";
}

export function nextFrontier(value, knowledge = {}) {
  const plan = validatePlan(value);
  const prerequisites = new Map(plan.nodes.map((node) => [node.id, []]));
  for (const edge of plan.edges) prerequisites.get(edge.to).push(edge.from);
  return orderUnchecked(plan).filter(
    (id) =>
      !demonstrated(knowledge[id]) &&
      prerequisites.get(id).every((prerequisite) => demonstrated(knowledge[prerequisite])),
  );
}

function mermaidText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\|/g, "&#124;");
}

export function mermaidForPlan(value) {
  const plan = validatePlan(value);
  const lines = ["flowchart TD"];
  for (const node of plan.nodes) {
    lines.push(`  ${node.id}["${mermaidText(node.title)}"]`);
  }
  for (const edge of plan.edges) {
    lines.push(`  ${edge.from} -->|"${mermaidText(edge.reason)}"| ${edge.to}`);
  }
  lines.push("  classDef target stroke-width:3px,stroke:#7c3aed");
  lines.push(`  class ${plan.targetNodeId} target`);
  return `${lines.join("\n")}\n`;
}
