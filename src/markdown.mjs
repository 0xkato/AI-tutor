function singleLine(value, fallback = "") {
  const text = String(value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || String(fallback);
}

function escapeInline(value, fallback = "") {
  return singleLine(value, fallback)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]<>])/g, "\\$1");
}

export function headingText(value, fallback = "Untitled") {
  return escapeInline(value, fallback);
}

export function plainParagraph(value, fallback = "") {
  return escapeInline(value, fallback)
    .replace(/^([#>+-])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

export function listValue(value, fallback = "") {
  return escapeInline(value, fallback);
}

export function inlineCode(value) {
  return `\`${singleLine(value).replace(/`/g, "&#96;")}\``;
}

export function markdownLink(label, destination) {
  const safeDestination = singleLine(destination)
    .replace(/\\/g, "%5C")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s/g, "%20");
  return `[${escapeInline(label, "Untitled")}](${safeDestination})`;
}

function encodeObsidianTarget(value) {
  return singleLine(value)
    .replace(/\\/g, "/")
    .replace(/[\[\]|#^]/g, (character) =>
      `%${character.codePointAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    );
}

export function obsidianEmbed(target) {
  return `![[${encodeObsidianTarget(target)}]]`;
}

export function obsidianLink(target, label) {
  const safeLabel = escapeInline(label, "Untitled").replace(/\|/g, "&#124;");
  return `[[${encodeObsidianTarget(target)}|${safeLabel}]]`;
}

export function mermaidLabel(value) {
  return singleLine(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;");
}
