import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";

const DISALLOWED_CONTENT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ANY_CONTROL = /[\u0000-\u001f\u007f]/;

function inputError(message, code = "INVALID_INPUT") {
  throw new LearningError(message, code);
}

export function safeText(value, label, { allowEmpty = false, maxLength = 65_536 } = {}) {
  if (typeof value !== "string") {
    inputError(value === undefined || value === null ? `${label} is required` : `${label} must be a string`);
  }
  if (value.length > maxLength) inputError(`${label} must be at most ${maxLength} characters`);
  if (DISALLOWED_CONTENT_CONTROLS.test(value)) {
    inputError(`${label} contains a disallowed control character`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === "") inputError(`${label} is required`);
  return trimmed;
}

export function safeSingleLine(value, label, { allowEmpty = false, maxLength = 4_096 } = {}) {
  const checked = safeText(value, label, { allowEmpty, maxLength });
  if (/[\r\n]/.test(value)) inputError(`${label} must be a single line`);
  if (ANY_CONTROL.test(value)) inputError(`${label} contains a disallowed control character`);
  return checked;
}

export function safeIdentifier(value, label = "identifier") {
  return safeSingleLine(value, label, { maxLength: 256 });
}

export function safeVaultDir(value, label = "vault directory") {
  const vaultDir = safeSingleLine(value, label, { maxLength: 1_024 });
  const normalized = path.posix.normalize(vaultDir);
  if (
    vaultDir.includes("\\") ||
    path.posix.isAbsolute(vaultDir) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== vaultDir
  ) {
    inputError(`${label} must be a normalized relative path inside the learning root`, "INVALID_VAULT");
  }
  return vaultDir;
}

export function safeRelativeVaultPath(value) {
  const visualPath = safeSingleLine(value, "visual path", { maxLength: 1_024 }).replace(/\\/g, "/");
  const normalized = path.posix.normalize(visualPath);
  if (
    path.posix.isAbsolute(visualPath) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== visualPath
  ) {
    inputError("visual path must be a normalized relative vault path", "INVALID_VISUAL_PATH");
  }
  return visualPath;
}

export function validateSourceReference(value) {
  let reference;
  try {
    reference = safeSingleLine(value, "source reference", { maxLength: 8_192 });
  } catch (error) {
    throw new LearningError(`Invalid source reference: ${error.message}`, "INVALID_SOURCE_REFERENCE");
  }
  if (reference.startsWith("local:")) {
    if (reference.slice("local:".length).trim() === "") {
      inputError("Invalid source reference: local reference is empty", "INVALID_SOURCE_REFERENCE");
    }
    return reference;
  }
  let parsed;
  try {
    parsed = new URL(reference);
  } catch {
    inputError(
      "Invalid source reference: use an http(s) URL or local:<reference>",
      "INVALID_SOURCE_REFERENCE",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    inputError(
      "Invalid source reference: only http:, https:, and local: are allowed",
      "INVALID_SOURCE_REFERENCE",
    );
  }
  return reference;
}

function lstat(file, missingMessage) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") inputError(missingMessage, "VISUAL_NOT_FOUND");
    throw error;
  }
}

function assertNoSymlink(base, target) {
  const root = path.resolve(base);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    inputError("visual path must remain inside the vault", "INVALID_VISUAL_PATH");
  }
  let current = root;
  const relative = path.relative(root, resolved);
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = lstat(current, `Visual does not exist: ${current}`);
    if (stat.isSymbolicLink()) {
      inputError(`Visual path cannot traverse a symlink: ${current}`, "VISUAL_SYMLINK");
    }
  }
}

function mediaTypeFor(file) {
  const types = new Map([
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".avif", "image/avif"],
    [".pdf", "application/pdf"],
  ]);
  return types.get(path.extname(file).toLowerCase()) ?? "application/octet-stream";
}

function hashOpenFile(fd) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

export function inspectVisual(root, state, value) {
  const relativePath = safeRelativeVaultPath(value);
  const learningRoot = path.resolve(root);
  const vault = path.resolve(learningRoot, state?.settings?.vaultDir ?? "vault");
  if (vault === learningRoot || !vault.startsWith(`${learningRoot}${path.sep}`)) {
    inputError("Configured vault must be inside the learning root", "INVALID_VAULT");
  }
  assertNoSymlink(learningRoot, vault);
  const file = path.resolve(vault, ...relativePath.split("/"));
  if (!file.startsWith(`${vault}${path.sep}`)) {
    inputError("visual path must remain inside the vault", "INVALID_VISUAL_PATH");
  }
  assertNoSymlink(vault, file);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(file, flags);
  } catch (error) {
    if (error.code === "ENOENT") inputError(`Visual does not exist: ${relativePath}`, "VISUAL_NOT_FOUND");
    if (error.code === "ELOOP") inputError(`Visual path cannot be a symlink: ${relativePath}`, "VISUAL_SYMLINK");
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) inputError(`Visual must be a regular file: ${relativePath}`, "INVALID_VISUAL_FILE");
    return {
      path: relativePath,
      bytes: stat.size,
      mediaType: mediaTypeFor(file),
      sha256: hashOpenFile(fd),
    };
  } finally {
    fs.closeSync(fd);
  }
}
