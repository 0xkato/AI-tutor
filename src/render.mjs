import fs from "node:fs";
import path from "node:path";

import { mermaidForPlan } from "./graph.mjs";

export function slugify(value) {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

function heading(value) {
  return String(value || "Untitled").replace(/[\r\n]+/g, " ").trim();
}

function titleCase(value) {
  const text = String(value ?? "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function list(values, empty = "None recorded.") {
  if (!values?.length) return empty;
  return values.map((value) => `- ${value}`).join("\n");
}

function sessionName(session) {
  return `${slugify(session.topic)}-${slugify(session.id)}`;
}

export function renderSessionNote(session) {
  const lines = [
    `# ${heading(session.topic)}`,
    "",
    `- **Session:** \`${session.id}\``,
    `- **Phase:** ${titleCase(session.phase)}`,
    `- **Created:** ${session.createdAt ?? "Unknown"}`,
    `- **Updated:** ${session.updatedAt ?? "Unknown"}`,
    `- **Completed:** ${session.completedAt ?? "Not completed"}`,
    "",
    "## Learning target",
    "",
    session.target || "Not recorded.",
    "",
    "## Learner context",
    "",
    session.learnerContext || "Not recorded.",
    "",
    "## Probe conclusion",
    "",
    session.probeSummary || "Probe is not complete.",
    "",
    "## Dependency plan",
    "",
  ];

  if (session.plan) {
    lines.push("```mermaid", mermaidForPlan(session.plan).trimEnd(), "```");
  } else {
    lines.push("No dependency plan recorded.");
  }

  lines.push("", "## Sources and verification", "");
  if (session.sources?.length) {
    for (const source of session.sources) {
      lines.push(
        `### [${heading(source.title)}](${source.url})`,
        "",
        `- **Class:** ${source.sourceClass}`,
        `- **Supports:** ${source.supports}`,
        `- **Verification:** ${source.verification}`,
        "",
      );
    }
  } else {
    lines.push("No sources recorded.", "");
  }

  lines.push("## Teaching steps", "");
  if (session.steps?.length) {
    session.steps.forEach((step, index) => {
      lines.push(
        `### ${index + 1}. ${heading(step.nodeId)}`,
        "",
        `- **Foundation:** ${step.foundation}`,
        `- **Motivation:** ${step.motivation}`,
        `- **Explanation:** ${step.explanation}`,
        `- **Checkpoint:** ${step.checkpointQuestion}`,
        "",
      );
    });
  } else {
    lines.push("No teaching steps recorded.", "");
  }

  lines.push("## Assessments", "");
  if (session.assessments?.length) {
    for (const assessment of session.assessments) {
      lines.push(
        `### ${titleCase(assessment.grade)} — ${heading(assessment.nodeId)}`,
        "",
        `- **Kind:** ${assessment.kind}`,
        `- **Evidence:** ${assessment.evidence}`,
        `- **Contaminated:** ${assessment.contaminated ? "Yes — excluded from knowledge evidence" : "No"}`,
        "",
      );
    }
  } else {
    lines.push("No assessments recorded.", "");
  }

  lines.push("## Retention", "");
  const knowledge = Object.entries(session.knowledge ?? {});
  if (knowledge.length) {
    for (const [nodeId, entry] of knowledge) {
      lines.push(
        `- **${heading(nodeId)}:** ${entry.status ?? "unknown"}; level ${entry.review?.level ?? 0}; due ${entry.review?.dueAt ?? "not scheduled"}`,
      );
    }
  } else {
    lines.push("No retention evidence recorded.");
  }

  lines.push("", "## Visuals", "");
  if (session.visuals?.length) {
    for (const visual of session.visuals) {
      lines.push(
        `![[${visual.path}]]`,
        "",
        `- **Description:** ${visual.description}`,
        `- **Verification:** ${visual.verification}`,
        "",
      );
    }
  } else {
    lines.push("No visuals recorded.", "");
  }

  lines.push(
    "## Whole-system synthesis",
    "",
    session.synthesis || "Not completed yet.",
    "",
    "## Unresolved gaps",
    "",
    list(session.unresolvedGaps),
    "",
  );
  return lines.join("\n");
}

function renderHome(state) {
  const sessions = Object.values(state.sessions ?? {}).sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt)),
  );
  return [
    "# Adaptive Learning",
    "",
    `State updated: ${state.updatedAt}`,
    "",
    "## Sessions",
    "",
    sessions.length
      ? sessions.map((session) => `- [[Sessions/${sessionName(session)}|${heading(session.topic)}]] — ${titleCase(session.phase)}`).join("\n")
      : "No sessions yet.",
    "",
  ].join("\n");
}

function renderTopic(topic, sessions) {
  return [
    `# ${heading(topic)}`,
    "",
    "## Session history",
    "",
    ...sessions.map((session) => `- [[../Sessions/${sessionName(session)}|${session.createdAt}]] — ${titleCase(session.phase)}`),
    "",
    "## Current knowledge",
    "",
    ...sessions.flatMap((session) =>
      Object.entries(session.knowledge ?? {}).map(
        ([nodeId, entry]) => `- **${heading(nodeId)}:** ${entry.status ?? "unknown"}; due ${entry.review?.dueAt ?? "not scheduled"}`,
      ),
    ),
    "",
  ].join("\n");
}

function renderReviews(state) {
  const items = Object.values(state.sessions ?? {}).flatMap((session) =>
    Object.entries(session.knowledge ?? {})
      .filter(([, entry]) => entry.review?.dueAt)
      .map(([nodeId, entry]) => ({ session, nodeId, entry })),
  );
  items.sort((a, b) => a.entry.review.dueAt.localeCompare(b.entry.review.dueAt));
  return [
    "# Review queue",
    "",
    items.length
      ? items.map(({ session, nodeId, entry }) => `- ${entry.review.dueAt} — [[Sessions/${sessionName(session)}|${heading(session.topic)}]] / ${heading(nodeId)}`).join("\n")
      : "No reviews scheduled.",
    "",
  ].join("\n");
}

function safeVault(root, vaultDir) {
  const base = path.resolve(root);
  const target = path.resolve(base, vaultDir || "vault");
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error("vaultDir must stay inside the learning root");
  }
  return target;
}

export function renderVault(root, state) {
  const vault = safeVault(root, state.settings?.vaultDir ?? "vault");
  const sessionsDir = path.join(vault, "Sessions");
  const topicsDir = path.join(vault, "Topics");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(topicsDir, { recursive: true });

  fs.writeFileSync(path.join(vault, "Home.md"), renderHome(state));
  fs.writeFileSync(path.join(vault, "Reviews.md"), renderReviews(state));

  const topics = new Map();
  for (const session of Object.values(state.sessions ?? {})) {
    fs.writeFileSync(path.join(sessionsDir, `${sessionName(session)}.md`), renderSessionNote(session));
    if (!topics.has(session.topic)) topics.set(session.topic, []);
    topics.get(session.topic).push(session);
  }
  for (const [topic, sessions] of topics) {
    fs.writeFileSync(path.join(topicsDir, `${slugify(topic)}.md`), renderTopic(topic, sessions));
  }
  return vault;
}
