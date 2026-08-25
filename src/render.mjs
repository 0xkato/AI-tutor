import { createHash } from "node:crypto";
import path from "node:path";

import { mermaidForPlan } from "./graph.mjs";
import {
  headingText,
  inlineCode,
  listValue,
  markdownLink,
  obsidianEmbed,
  obsidianLink,
  plainParagraph,
} from "./markdown.mjs";
import { reconcileRender } from "./render-manifest.mjs";
import { mutateState, readState } from "./store.mjs";

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

function titleCase(value) {
  const text = String(value ?? "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function list(values, empty = "None recorded.") {
  if (!values?.length) return empty;
  return values.map((value) => `- ${listValue(value)}`).join("\n");
}

function sessionName(session) {
  return `${slugify(session.topic)}-${stableSuffix(session.id)}`;
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
    `# ${headingText(session.topic)}`,
    "",
    `- **Session:** ${inlineCode(session.id)}`,
    `- **Phase:** ${listValue(titleCase(session.phase))}`,
    `- **Created:** ${listValue(session.createdAt ?? "Unknown")}`,
    `- **Updated:** ${listValue(session.updatedAt ?? "Unknown")}`,
    `- **Completed:** ${listValue(session.completedAt ?? "Not completed")}`,
    "",
    "## Learning target",
    "",
    plainParagraph(session.target, "Not recorded."),
    "",
    "## Learner context",
    "",
    plainParagraph(session.learnerContext, "Not recorded."),
    "",
    "## Probe conclusion",
    "",
    plainParagraph(session.probeSummary, "Probe is not complete."),
    "",
    "## Dependency plan",
    "",
  ];

  if (session.plan) {
    lines.push("```mermaid", mermaidForPlan(session.plan).trimEnd(), "```");
  } else {
    lines.push("No dependency plan recorded.");
  }

  lines.push("", "## Admitted gaps", "");
  if (session.admittedGaps?.length) {
    for (const gap of session.admittedGaps) {
      lines.push(
        `### ${headingText(gap.nodeId)}`,
        "",
        `- **Learner statement:** ${listValue(gap.statement)}`,
        `- **Diagnostic evidence:** ${listValue(gap.evidence)}`,
        "- **Classification:** Not an assessment; no grade or retry was created.",
        "",
      );
    }
  } else {
    lines.push("None recorded.", "");
  }

  lines.push("", "## Sources and verification", "");
  if (session.sources?.length) {
    for (const source of session.sources) {
      lines.push(
        `### ${markdownLink(source.title, source.url)}`,
        "",
        `- **Class:** ${listValue(source.sourceClass)}`,
        `- **Supports:** ${listValue(source.supports)}`,
        `- **Verification:** ${listValue(source.verification)}`,
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
        `### ${index + 1}\. ${headingText(step.nodeId)}`,
        "",
        `- **Foundation:** ${listValue(step.foundation)}`,
        `- **Motivation:** ${listValue(step.motivation)}`,
        `- **Explanation:** ${listValue(step.explanation)}`,
        `- **Checkpoint:** ${listValue(step.checkpointQuestion)}`,
        "",
      );
    });
  } else {
    lines.push("No teaching steps recorded.", "");
  }

  if (session.checkpoint) {
    const checkpoint = session.checkpoint;
    lines.push(
      session.kind === "review" ? "## Active review checkpoint" : "## Active learning checkpoint",
      "",
      `- **Status:** ${listValue(titleCase(checkpoint.status.replaceAll("-", " ")))}`,
      `- **Node:** ${inlineCode(checkpoint.nodeId)}`,
      `- **Question ID:** ${inlineCode(checkpoint.questionId)}`,
      `- **Kind:** ${listValue(checkpoint.kind)}`,
      `- **Question:** ${listValue(checkpoint.question)}`,
      `- **Attempts:** ${listValue(checkpoint.attempts)}`,
      `- **Prior question ID:** ${checkpoint.priorQuestionId ? inlineCode(checkpoint.priorQuestionId) : "None"}`,
      `- **Resolved evidence:** ${checkpoint.resolvedEvidenceId ? inlineCode(checkpoint.resolvedEvidenceId) : "None"}`,
      `- **Mistake type:** ${listValue(checkpoint.mistakeType || "None")}`,
      "",
    );
  }

  if (session.checkpointGaps?.length) {
    lines.push("## Admitted checkpoint gaps", "");
    session.checkpointGaps.forEach((gap, index) => {
      lines.push(
        `### ${index + 1}\. ${headingText(gap.nodeId)}`,
        "",
        `- **Stage:** ${listValue(titleCase(gap.stage))}`,
        `- **Question ID:** ${inlineCode(gap.questionId)}`,
        `- **Question:** ${listValue(gap.question)}`,
        `- **Learner statement:** ${listValue(gap.statement)}`,
        `- **Evidence:** ${listValue(gap.evidence)}`,
        "",
      );
    });
  }

  lines.push("## Questions and learner notes", "");
  if (session.questions?.length) {
    for (const [index, question] of session.questions.entries()) {
      const latest = question.responses.at(-1) ?? null;
      const labelsByValue = new Map(question.choices.map((choice) => [choice.value, choice.label]));
      let outcome = titleCase(question.status.replaceAll("-", " "));
      if (question.status === "resolved" && latest) outcome = latest.correct ? "Correct" : "Incorrect";
      if (question.status === "retry-required") outcome = "Incorrect — retry required";
      if (question.status === "gap") outcome = "I don't know";
      const selected = latest?.dontKnow
        ? "I don't know"
        : latest?.selectedChoiceValues?.map((value) => labelsByValue.get(value) ?? value).join(", ") ?? "Not answered";
      const responseNote = latest?.noteId
        ? session.notes?.find((note) => note.id === latest.noteId)
        : null;

      lines.push(
        `### ${index + 1}\. ${headingText(question.question)}`,
        "",
        `- **Question ID:** ${inlineCode(question.id)}`,
        `- **Stage:** ${listValue(titleCase(question.stage))}`,
        `- **Node:** ${inlineCode(question.nodeId)}`,
        `- **Mode:** ${listValue(titleCase(question.mode.replaceAll("-", " ")))}`,
        `- **Outcome:** ${listValue(outcome)}`,
        `- **Selected:** ${listValue(selected)}`,
      );
      if (question.parentQuestionId) {
        lines.push(
          `- **Parent question:** ${inlineCode(question.parentQuestionId)}`,
          `- **Adaptive reason:** ${listValue(question.adaptationReason)}`,
        );
      }
      lines.push("", "Choices:", "");
      for (const [choiceIndex, choice] of question.choices.entries()) {
        const description = choice.description ? ` — ${choice.description}` : "";
        lines.push(`${choiceIndex + 1}. ${listValue(`${choice.label}${description}`)}`);
      }
      if (responseNote) {
        lines.push("", `- **Learner note:** ${listValue(responseNote.body)}`);
      }
      if (question.status === "resolved") {
        lines.push("", `- **Explanation:** ${listValue(question.explanation)}`);
      }
      lines.push("");
    }
  } else {
    lines.push("No interactive questions recorded.", "");
  }

  lines.push("## Other learner notes", "");
  const otherNotes = (session.notes ?? []).filter((note) => note.targetType !== "question");
  if (otherNotes.length) {
    for (const note of otherNotes) {
      lines.push(
        `- **${listValue(titleCase(note.targetType))} ${inlineCode(note.targetId)}:** ${listValue(note.body)}`,
      );
    }
    lines.push("");
  } else {
    lines.push("None recorded.", "");
  }

  lines.push("## Assessments", "");
  if (session.assessments?.length) {
    for (const assessment of session.assessments) {
      lines.push(
        `### ${headingText(titleCase(assessment.grade))} — ${headingText(assessment.nodeId)}`,
        "",
        `- **Kind:** ${listValue(assessment.kind)}`,
        `- **Evidence:** ${listValue(assessment.evidence)}`,
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
        `- **${listValue(concept.title)}:** ${listValue(`${concept.status}; level ${review?.level ?? 0}; due ${review?.dueAt ?? "not scheduled"}`)}`,
      );
    }
  } else {
    lines.push("No retention evidence recorded.");
  }

  lines.push("", "## Visuals", "");
  if (session.visuals?.length) {
    for (const visual of session.visuals) {
      lines.push(
        obsidianEmbed(visual.path),
        "",
        `- **Description:** ${listValue(visual.description)}`,
        `- **Verification:** ${listValue(visual.verification)}`,
        "",
      );
    }
  } else {
    lines.push("No visuals recorded.", "");
  }

  lines.push("## Whole-system synthesis", "");
  if (session.synthesis) {
    lines.push(plainParagraph(session.synthesis), "");
  } else if (session.synthesisCheckpoint) {
    const checkpoint = session.synthesisCheckpoint;
    lines.push(
      "### Synthesis checkpoint",
      "",
      `- **Status:** ${listValue(titleCase(checkpoint.status.replaceAll("-", " ")))}`,
      `- **Question ID:** ${inlineCode(checkpoint.questionId)}`,
      `- **Question:** ${listValue(checkpoint.question)}`,
      `- **Attempts:** ${listValue(checkpoint.attempts)}`,
      `- **Prior question ID:** ${checkpoint.priorQuestionId ? inlineCode(checkpoint.priorQuestionId) : "None"}`,
      `- **Resolved evidence:** ${checkpoint.resolvedEvidenceId ? inlineCode(checkpoint.resolvedEvidenceId) : "None"}`,
      `- **Mistake type:** ${listValue(checkpoint.mistakeType || "None")}`,
      "",
    );
  } else {
    lines.push("Not completed yet.", "");
  }

  lines.push(
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
    `State updated: ${plainParagraph(state.updatedAt)}`,
    "",
    `- ${obsidianLink("Profile", "Learner profile")}`,
    `- ${obsidianLink("Reviews", "Review queue")}`,
    "",
    "## Sessions",
    "",
    sessions.length
      ? sessions
          .map(
            (session) =>
              `- ${obsidianLink(`Sessions/${sessionName(session)}`, session.topic)} — ${listValue(titleCase(session.phase))}`,
          )
          .join("\n")
      : "No sessions yet.",
    "",
  ].join("\n");
}

function renderProfile(state) {
  const profile = state.learnerProfile;
  const defaultStatus = "Built-in default active.";
  return [
    "# Learner profile",
    "",
    `- **Custom overrides:** ${listValue(profile.updatedAt ?? "No custom overrides")}`,
    "",
    "## Teaching philosophy",
    "",
    plainParagraph(profile.teachingPhilosophy, defaultStatus),
    "",
    "## Explanation preferences",
    "",
    plainParagraph(profile.explanationPreferences, defaultStatus),
    "",
    "## Feedback preferences",
    "",
    plainParagraph(profile.feedbackPreferences, defaultStatus),
    "",
    "## Visual preferences",
    "",
    plainParagraph(profile.visualPreferences, defaultStatus),
    "",
    "## Source preferences",
    "",
    plainParagraph(profile.sourcePreferences, defaultStatus),
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
    `# ${headingText(topic.name)}`,
    "",
    `- **Topic ID:** ${inlineCode(topic.id)}`,
    "",
    "## Session history",
    "",
    ...(sessions.length
      ? sessions.map(
          (session) =>
            `- ${obsidianLink(`../Sessions/${sessionName(session)}`, session.createdAt)} — ${listValue(titleCase(session.phase))}`,
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
      `### ${headingText(concept.title)}`,
      "",
      `- **Concept ID:** ${inlineCode(concept.id)}`,
      `- **Key:** ${inlineCode(concept.key)}`,
      `- **Status:** ${listValue(titleCase(concept.status))}`,
      `- **Latest grade:** ${listValue(concept.latestGrade ? titleCase(concept.latestGrade) : "None")}`,
      `- **Review:** ${listValue(`level ${review?.level ?? 0}; due ${review?.dueAt ?? "not scheduled"}`)}`,
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
        `- ${listValue(assessment.createdAt)} — **${listValue(titleCase(assessment.grade))}** (${listValue(assessment.kind)}) in ${obsidianLink(`../Sessions/${sessionName(session)}`, `session ${session.id}`)} — ${listValue(assessment.evidence)}`,
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
              ? obsidianLink(`Sessions/${sessionName(session)}`, topic?.name ?? session.topic)
              : listValue(topic?.name ?? "Unknown topic");
            return `- ${listValue(review.dueAt)} — ${link} / ${listValue(concept.title)}`;
          })
          .join("\n")
      : "No reviews scheduled.",
    "",
  ].join("\n");
}

export function renderVault(root, state) {
  const files = [
    { relativePath: "Home.md", contents: `${renderHome(state).trimEnd()}\n` },
    { relativePath: "Profile.md", contents: `${renderProfile(state).trimEnd()}\n` },
    { relativePath: "Reviews.md", contents: `${renderReviews(state).trimEnd()}\n` },
  ];
  for (const session of Object.values(state.sessions ?? {})) {
    files.push({
      relativePath: `Sessions/${sessionName(session)}.md`,
      contents: `${renderSessionNote(state, session).trimEnd()}\n`,
    });
  }
  for (const topic of Object.values(state.topics ?? {})) {
    files.push({
      relativePath: `Topics/${topicName(topic)}.md`,
      contents: `${renderTopic(state, topic).trimEnd()}\n`,
    });
  }
  const manifest = reconcileRender(root, {
    vaultDir: state.settings?.vaultDir ?? "vault",
    stateRevision: state.revision,
    files,
  });
  return {
    vault: path.resolve(root, manifest.vaultDir),
    manifest,
  };
}

function renderFailure(error) {
  return {
    ok: false,
    code: error instanceof Error && typeof error.code === "string" ? error.code : "RENDER_FAILED",
    error: error instanceof Error ? error.message : String(error),
  };
}

export function commitAndRender(root, mutation, { renderer = renderVault, lockTimeoutMs } = {}) {
  const state = mutateState(root, mutation, { lockTimeoutMs });
  try {
    const rendered = renderer(root, state);
    return {
      stateCommitted: true,
      stateRevision: state.revision,
      state,
      render: {
        ok: true,
        stateRevision: state.revision,
        vault: rendered?.vault ?? null,
      },
    };
  } catch (error) {
    return {
      stateCommitted: true,
      stateRevision: state.revision,
      state,
      render: renderFailure(error),
    };
  }
}

export function repairRender(root, { renderer = renderVault } = {}) {
  const state = readState(root);
  try {
    const rendered = renderer(root, state);
    return {
      ok: true,
      stateRevision: state.revision,
      vault: rendered?.vault ?? null,
    };
  } catch (error) {
    return {
      ...renderFailure(error),
      stateRevision: state.revision,
    };
  }
}
