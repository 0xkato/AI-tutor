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

function formatResponseTime(value) {
  return Number.isFinite(value) ? `${value} ms` : "Not recorded";
}

function activityLabel(value) {
  return titleCase(String(value ?? "not recorded").replaceAll("-", " "));
}

function masteryLines(concept) {
  const entries = Object.entries(concept.mastery ?? {});
  if (!entries.length) return ["No multidimensional mastery evidence recorded."];
  return entries.map(([dimension, record]) =>
    `- **${listValue(titleCase(dimension))}:** ${listValue(`level ${record.level}; ${record.correct}/${record.attempts} correct; last assessed ${record.lastAssessedAt ?? "never"}`)}`,
  );
}

function misconceptionLines(state, concept) {
  const misconceptions = (concept.misconceptionIds ?? [])
    .map((id) => state.misconceptions?.[id])
    .filter(Boolean);
  if (!misconceptions.length) return ["None recorded."];
  return misconceptions.map((misconception) =>
    `- **${listValue(titleCase(misconception.status))}:** ${listValue(misconception.statement)} — confidence ${listValue(`${misconception.confidence}%`)}; occurrences ${listValue(misconception.occurrences)}; relapses ${listValue(misconception.relapses)}; counterexample: ${listValue(misconception.counterexample ?? "not recorded")}; repair: ${listValue(misconception.repair ?? "not recorded")}`,
  );
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
    `- **Restarted:** ${listValue(session.restartedAt ?? "No")}`,
    `- **Restart reason:** ${listValue(session.restartReason ?? "None")}`,
    `- **Replaced by:** ${session.replacedBySessionId ? inlineCode(session.replacedBySessionId) : "None"}`,
    `- **Restarted from:** ${session.restartedFromSessionId ? inlineCode(session.restartedFromSessionId) : "None"}`,
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

  lines.push("## Supplied learning materials", "");
  const sourceGuidance = session.sourceGuidance ?? {
    mode: session.materials?.length ? "anchored" : "open",
    reason: null,
  };
  lines.push(
    `- **Source-guidance mode:** ${listValue(titleCase(sourceGuidance.mode.replaceAll("-", " ")))}`,
    `- **Continuation reason:** ${listValue(sourceGuidance.reason ?? "None")}`,
    "",
  );
  if (sourceGuidance.history?.length) {
    lines.push("### Guidance transition history", "");
    for (const entry of sourceGuidance.history) {
      lines.push(
        `- **${listValue(entry.createdAt)} — ${listValue(titleCase(entry.mode.replaceAll("-", " ")))}:** ${listValue(entry.reason ?? "No reason recorded")}`,
      );
    }
    lines.push("");
  }
  if (session.materials?.length) {
    for (const material of session.materials) {
      lines.push(
        `### ${headingText(material.title ?? material.reference)}`,
        "",
        `- **Reference:** ${listValue(material.reference)}`,
        `- **Kind:** ${listValue(titleCase(material.kind))}`,
        `- **Status:** ${listValue(titleCase(material.status))}`,
        `- **Resolution:** ${listValue(material.resolution ?? "Pending host inspection")}`,
        "",
      );
    }
  } else {
    lines.push("No learner-supplied anchor material recorded.", "");
  }

  lines.push("", "## Sources and verification", "");
  if (session.sources?.length) {
    for (const source of session.sources) {
      lines.push(
        `### ${markdownLink(source.title, source.url)}`,
        "",
        `- **Class:** ${listValue(source.sourceClass)}`,
        `- **Role:** ${listValue(titleCase(source.role ?? "supplemental"))}`,
        `- **Locator:** ${listValue(source.locator ?? "Whole source")}`,
        `- **Material:** ${source.materialId ? inlineCode(source.materialId) : "None — external or general research"}`,
        `- **Supports:** ${listValue(source.supports)}`,
        `- **Verification:** ${listValue(source.verification)}`,
        "",
      );
    }
  } else {
    lines.push("No sources recorded.", "");
  }

  lines.push("## Source coverage and understanding", "");
  if (session.sourceCoverage?.length) {
    const concepts = conceptsForSession(state, session);
    for (const coverage of session.sourceCoverage) {
      const source = session.sources?.find((candidate) => candidate.id === coverage.sourceId);
      const concept = concepts.find((candidate) => candidate.key === coverage.nodeId);
      const latestAssessment = [...(session.assessments ?? [])]
        .reverse()
        .find((assessment) => assessment.conceptId === concept?.id && !assessment.contaminated);
      lines.push(
        `### ${headingText(coverage.nodeId)}`,
        "",
        `- **Source:** ${listValue(source?.title ?? coverage.sourceId)}`,
        `- **Role:** ${listValue(titleCase(source?.role ?? "supplemental"))}`,
        `- **Locator:** ${listValue(source?.locator ?? "Whole source")}`,
        `- **Coverage:** ${listValue(coverage.summary)}`,
        `- **Understanding status:** ${listValue(concept ? titleCase(concept.status) : "Not demonstrated")}`,
        `- **Latest learner evidence:** ${listValue(latestAssessment?.evidence ?? "None recorded")}`,
        "",
      );
    }
  } else {
    lines.push("No plan-node source coverage recorded.", "");
  }

  lines.push("## Teaching steps", "");
  if (session.steps?.length) {
    session.steps.forEach((step, index) => {
      const sourceBasis = (session.sourceCoverage ?? [])
        .filter((coverage) => coverage.nodeId === step.nodeId)
        .map((coverage) => {
          const source = session.sources?.find((candidate) => candidate.id === coverage.sourceId);
          return `${source?.title ?? coverage.sourceId} — ${source?.locator ?? "Whole source"}`;
        })
        .join("; ");
      lines.push(
        `### ${index + 1}\. ${headingText(step.nodeId)}`,
        "",
        `- **Activity:** ${listValue(activityLabel(step.activityType))}`,
        `- **Strategy reason:** ${listValue(step.strategyReason ?? "Not recorded")}`,
        `- **Support level:** ${listValue(step.supportLevel ?? "Not recorded")}`,
        `- **Transfer level:** ${listValue(step.transferLevel ?? "Not recorded")}`,
        `- **Foundation:** ${listValue(step.foundation)}`,
        `- **Motivation:** ${listValue(step.motivation)}`,
        `- **Explanation:** ${listValue(step.explanation)}`,
        `- **Checkpoint:** ${listValue(step.checkpointQuestion)}`,
        `- **Source basis:** ${listValue(sourceBasis || "No source coverage recorded")}`,
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
      const choices = question.choices ?? [];
      const labelsByValue = new Map(choices.map((choice) => [choice.value, choice.label]));
      const linkedAssessment = latest?.assessmentId
        ? session.assessments?.find((assessment) => assessment.id === latest.assessmentId)
        : null;
      let outcome = titleCase(question.status.replaceAll("-", " "));
      if (question.status === "resolved" && latest) {
        outcome = linkedAssessment
          ? titleCase(linkedAssessment.grade)
          : latest.correct === null
            ? "Ungraded productive attempt"
            : latest.correct
              ? "Correct"
              : "Incorrect";
      }
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
        `- **Activity:** ${listValue(activityLabel(question.activityType))}`,
        `- **Strategy reason:** ${listValue(question.strategyReason ?? "Not recorded")}`,
        `- **Support level:** ${listValue(question.supportLevel ?? "Not recorded")}`,
        `- **Transfer level:** ${listValue(question.transferLevel ?? "Not recorded")}`,
        `- **Outcome:** ${listValue(outcome)}`,
      );
      if (question.mode === "free-response") {
        lines.push(`- **Learner answer:** ${listValue(latest?.textAnswer ?? "Not answered")}`);
      } else {
        lines.push(`- **Selected:** ${listValue(selected)}`);
      }
      lines.push(
        `- **Confidence:** ${listValue(latest?.confidence === null || latest?.confidence === undefined ? "Not recorded" : `${latest.confidence}%`)}`,
        `- **Response time:** ${listValue(formatResponseTime(latest?.responseTimeMs))}`,
      );
      const questionSourceBasis = (session.sourceCoverage ?? [])
        .filter((coverage) => coverage.nodeId === question.nodeId)
        .map((coverage) => {
          const source = session.sources?.find((candidate) => candidate.id === coverage.sourceId);
          return `${source?.title ?? coverage.sourceId} — ${source?.locator ?? "Whole source"}`;
        })
        .join("; ");
      lines.push(`- **Source basis:** ${listValue(questionSourceBasis || "No source coverage recorded")}`);
      if (question.parentQuestionId) {
        lines.push(
          `- **Parent question:** ${inlineCode(question.parentQuestionId)}`,
          `- **Adaptive reason:** ${listValue(question.adaptationReason)}`,
        );
      }
      if (choices.length) {
        lines.push("", "Choices:", "");
        for (const [choiceIndex, choice] of choices.entries()) {
          const description = choice.description ? ` — ${choice.description}` : "";
          lines.push(`${choiceIndex + 1}. ${listValue(`${choice.label}${description}`)}`);
        }
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

  lines.push("## Activity history", "");
  if (session.activityHistory?.length) {
    for (const activity of session.activityHistory) {
      lines.push(
        `- **${listValue(activityLabel(activity.type))}:** ${listValue(activity.reason)} — node ${inlineCode(activity.nodeId)}; support level ${listValue(activity.supportLevel ?? "not recorded")}; transfer level ${listValue(activity.transferLevel ?? "not recorded")}`,
      );
    }
    lines.push("");
  } else {
    lines.push("No adaptive activity history recorded.", "");
  }

  lines.push("## Productive-failure attempts", "");
  if (session.productiveAttempts?.length) {
    lines.push("These attempts are diagnostic and are not graded as mastery evidence.", "");
    for (const attempt of session.productiveAttempts) {
      lines.push(
        `- **${listValue(attempt.prompt)}:** ${listValue(attempt.answer)} — rationale: ${listValue(attempt.rationale ?? "not recorded")}; confidence ${listValue(attempt.confidence === null || attempt.confidence === undefined ? "not recorded" : `${attempt.confidence}%`)}; response time ${listValue(formatResponseTime(attempt.responseTimeMs))}`,
      );
    }
    lines.push("");
  } else {
    lines.push("None recorded.", "");
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
        `- **Learner answer:** ${listValue(assessment.answer)}`,
        `- **Activity:** ${listValue(activityLabel(assessment.activityType))}`,
        `- **Confidence:** ${listValue(assessment.confidence === null || assessment.confidence === undefined ? "Not recorded" : `${assessment.confidence}%`)}`,
        `- **Response time:** ${listValue(formatResponseTime(assessment.responseTimeMs))}`,
        `- **Support level:** ${listValue(assessment.supportLevel ?? "Not recorded")}`,
        `- **Transfer level:** ${listValue(assessment.transferLevel ?? "Not recorded")}`,
        `- **Misconceptions:** ${listValue(assessment.misconceptionIds?.join(", ") || "None")}`,
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
        `### ${headingText(concept.title)}`,
        "",
        `- **Status:** ${listValue(concept.status)}`,
        `- **Transfer:** ${listValue(`highest level ${concept.highestTransferLevel ?? 0}; current support level ${concept.supportLevel ?? "not recorded"}`)}`,
        `- **Scheduling:** ${listValue(`level ${review?.level ?? 0}; due ${review?.dueAt ?? "not scheduled"}; stability ${review?.stabilityDays ?? 0} days; difficulty ${review?.difficulty ?? 50}; lapses ${review?.lapses ?? 0}`)}`,
        "",
        "#### Mastery by ability",
        "",
        ...masteryLines(concept),
        "",
        "#### Active misconceptions",
        "",
        ...misconceptionLines(state, concept).filter((line) => !line.startsWith("- **Resolved")),
        "",
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
      `- **Transfer and support:** ${listValue(`highest transfer level ${concept.highestTransferLevel ?? 0}; support level ${concept.supportLevel ?? "not recorded"}`)}`,
      `- **Review:** ${listValue(`level ${review?.level ?? 0}; due ${review?.dueAt ?? "not scheduled"}; stability ${review?.stabilityDays ?? 0} days; difficulty ${review?.difficulty ?? 50}; lapses ${review?.lapses ?? 0}`)}`,
      "",
      "#### Mastery by ability",
      "",
      ...masteryLines(concept),
      "",
      "#### Misconceptions",
      "",
      ...misconceptionLines(state, concept),
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
            const activeMisconceptions = (concept.misconceptionIds ?? [])
              .filter((id) => state.misconceptions?.[id]?.status === "active").length;
            return `- ${listValue(review.dueAt)} — ${link} / ${listValue(concept.title)} — stability ${listValue(review.stabilityDays ?? 0)} days; difficulty ${listValue(review.difficulty ?? 50)}; lapses ${listValue(review.lapses ?? 0)}; active misconceptions ${listValue(activeMisconceptions)}`;
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
