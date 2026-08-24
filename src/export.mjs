import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";
import { inspectVisual } from "./inputs.mjs";
import { inspectRenderProjection, readRenderManifest } from "./render-manifest.mjs";
import { readState } from "./store.mjs";

const EXPORT_FORMAT_VERSION = 1;
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function portablePath(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\")) {
    throw new LearningError(`${label} must be a non-empty POSIX path`, "INVALID_EXPORT_PATH");
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(value)) {
    throw new LearningError(`${label} is unsafe: ${value}`, "INVALID_EXPORT_PATH");
  }
  return normalized;
}

function writeFile(root, relativePath, contents) {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(destination), 0o700);
  const fd = fs.openSync(destination, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new LearningError(`${label} must be a regular file`, "INVALID_EXPORT_SOURCE");
  }
  return fs.readFileSync(file);
}

function collectFiles(root, state, manifest) {
  const files = new Map();
  const add = (relativePath, contents, role) => {
    const normalized = portablePath(relativePath, "export file path");
    if (files.has(normalized)) {
      throw new LearningError(`Export source appears more than once: ${normalized}`, "DUPLICATE_EXPORT_SOURCE");
    }
    const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    files.set(normalized, {
      path: normalized,
      contents: buffer,
      bytes: buffer.length,
      sha256: sha256(buffer),
      role,
    });
  };

  const stateContents = `${JSON.stringify(state, null, 2)}\n`;
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
  add("state.json", stateContents, "canonical-state");
  add("render-manifest.json", manifestContents, "render-manifest");

  for (const entry of manifest.generated) {
    const relativePath = `${manifest.vaultDir}/${entry.path}`;
    const source = path.join(path.resolve(root), ...relativePath.split("/"));
    const contents = readRegularFile(source, `Generated note ${entry.path}`);
    if (sha256(contents) !== entry.sha256) {
      throw new LearningError(`Generated note changed during export: ${entry.path}`, "EXPORT_SOURCE_CHANGED");
    }
    add(relativePath, contents, "generated-note");
  }

  const visuals = Object.values(state.sessions).flatMap((session) => session.visuals ?? []);
  for (const visual of visuals) {
    if (visual.identityStatus !== "verified") continue;
    const inspected = inspectVisual(root, state, visual.path);
    if (
      inspected.bytes !== visual.bytes ||
      inspected.mediaType !== visual.mediaType ||
      inspected.sha256 !== visual.sha256
    ) {
      throw new LearningError(`Verified visual changed since registration: ${visual.path}`, "VISUAL_IDENTITY_CHANGED");
    }
    const relativePath = `${manifest.vaultDir}/${visual.path}`;
    const source = path.join(path.resolve(root), ...relativePath.split("/"));
    add(relativePath, readRegularFile(source, `Visual ${visual.path}`), "verified-visual");
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function exportLearnerRecord(root, output) {
  if (typeof output !== "string" || output.trim() === "") {
    throw new LearningError("export output is required", "INVALID_EXPORT_PATH");
  }
  const destination = path.resolve(output);
  if (fs.existsSync(destination)) {
    throw new LearningError(`Export output already exists: ${destination}`, "EXPORT_EXISTS");
  }
  const parent = path.dirname(destination);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new LearningError(`Export parent directory does not exist: ${parent}`, "INVALID_EXPORT_PATH");
  }

  const state = readState(root);
  const projection = inspectRenderProjection(root, state);
  if (!projection.current) {
    throw new LearningError(
      `Obsidian projection is not current: ${projection.error ?? projection.status}. Run repair-render first.`,
      "STALE_RENDER",
    );
  }
  const renderManifest = readRenderManifest(root);
  const files = collectFiles(root, state, renderManifest);
  const exportManifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    productVersion: packageJson.version,
    schemaVersion: state.schemaVersion,
    stateRevision: state.revision,
    stateUpdatedAt: state.updatedAt,
    files: files.map(({ path: filePath, bytes, sha256: digest, role }) => ({
      path: filePath,
      bytes,
      sha256: digest,
      role,
    })),
  };

  const staging = path.join(parent, `.${path.basename(destination)}.tmp-${process.pid}-${randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    for (const file of files) writeFile(staging, file.path, file.contents);
    writeFile(staging, "export-manifest.json", `${JSON.stringify(exportManifest, null, 2)}\n`);
    syncDirectory(staging);
    fs.renameSync(staging, destination);
    syncDirectory(parent);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { ok: true, output: destination, manifest: exportManifest };
}
