import { createHash } from "node:crypto";
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

function stableSuffix(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
}

function topicName(topic) {
  return `${slugify(topic.name)}-${stableSuffix(topic.id)}`;
}

function conceptsForSession(state, session) {
  return (session.conceptIds ?? []).map((id) => state.concepts?.[id]).filter(Boolean);
}

export function renderSessionNote(state, session) {
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
  const concepts = conceptsForSession(state, session);
  if (concepts.length) {
    for (const concept of concepts) {
      const review = state.reviews?.[concept.reviewId];
      lines.push(
        `- **${heading(concept.title)}:** ${concept.status}; level ${review?.level ?? 0}; due ${review?.dueAt ?? "not scheduled"}`,
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

function renderTopic(state, topic) {
  const sessions = topic.sessionIds.map((id) => state.sessions[id]).filter(Boolean);
  const concepts = topic.conceptIds.map((id) => state.concepts[id]).filter(Boolean);
  const assessments = new Map(
    Object.values(state.sessions).flatMap((session) =>
      session.assessments.map((assessment) => [assessment.id, { assessment, session }]),
    ),
  );
  const lines = [
    `# ${heading(topic.name)}`,
    "",
    `- **Topic ID:** \`${topic.id}\``,
    "",
    "## Session history",
    "",
    ...(sessions.length
      ? sessions.map(
          (session) =>
            `- [[../Sessions/${sessionName(session)}|${session.createdAt}]] — ${titleCase(session.phase)}`,
        )
      : ["No sessions recorded."]),
    "",
    "## Current concept state",
    "",
  ];
  if (!concepts.length) lines.push("No concepts recorded.", "");
  for (const concept of concepts) {
    const review = state.reviews[concept.reviewId];
    lines.push(
      `### ${heading(concept.title)}`,
      "",
      `- **Concept ID:** \`${concept.id}\``,
      `- **Key:** \`${concept.key}\``,
      `- **Status:** ${titleCase(concept.status)}`,
      `- **Latest grade:** ${concept.latestGrade ? titleCase(concept.latestGrade) : "None"}`,
      `- **Review:** level ${review?.level ?? 0}; due ${review?.dueAt ?? "not scheduled"}`,
      "",
      "#### Evidence history",
      "",
    );
    const evidence = concept.evidenceIds
      .map((id) => assessments.get(id))
      .filter(Boolean)
      .sort((left, right) => left.assessment.createdAt.localeCompare(right.assessment.createdAt));
    if (!evidence.length) {
      lines.push("No assessment evidence recorded.", "");
      continue;
    }
    for (const { assessment, session } of evidence) {
      lines.push(
        `- ${assessment.createdAt} — **${titleCase(assessment.grade)}** (${assessment.kind}) in [[../Sessions/${sessionName(session)}|session ${session.id}]] — ${assessment.evidence}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderReviews(state) {
  const items = Object.values(state.reviews ?? {})
    .filter((review) => review.dueAt)
    .map((review) => ({ review, concept: state.concepts[review.conceptId] }))
    .filter((item) => item.concept);
  items.sort((a, b) => a.review.dueAt.localeCompare(b.review.dueAt));
  return [
    "# Review queue",
    "",
    items.length
      ? items
          .map(({ review, concept }) => {
            const topic = state.topics[concept.topicId];
            const session = state.sessions[concept.sourceSessionIds.at(-1)];
            const link = session
              ? `[[Sessions/${sessionName(session)}|${heading(topic?.name ?? session.topic)}]]`
              : heading(topic?.name ?? "Unknown topic");
            return `- ${review.dueAt} — ${link} / ${heading(concept.title)}`;
          })
          .join("\n")
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

  for (const session of Object.values(state.sessions ?? {})) {
    fs.writeFileSync(
      path.join(sessionsDir, `${sessionName(session)}.md`),
      renderSessionNote(state, session),
    );
  }
  for (const topic of Object.values(state.topics ?? {})) {
    fs.writeFileSync(path.join(topicsDir, `${topicName(topic)}.md`), renderTopic(state, topic));
  }
  return vault;
}
