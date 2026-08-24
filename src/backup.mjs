import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";
import { parseInstant, validateState } from "./schema.mjs";
import { pathsFor, readState } from "./store.mjs";

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function validateBackupId(id) {
  if (typeof id !== "string" || !BACKUP_ID.test(id) || id === "." || id === "..") {
    throw new LearningError("Backup id must be a safe local identifier", "INVALID_BACKUP_ID");
  }
  return id;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeDurable(file, contents) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new LearningError(`${label} is not valid JSON: ${error.message}`, "INVALID_BACKUP");
  }
}

function validateManifest(manifest, expectedId) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    manifest.id !== expectedId ||
    typeof manifest.createdAt !== "string" ||
    !Number.isInteger(manifest.schemaVersion) ||
    !Number.isInteger(manifest.revision) ||
    manifest.stateFile !== "state.json" ||
    typeof manifest.stateSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.stateSha256)
  ) {
    throw new LearningError(`Backup manifest is invalid: ${expectedId}`, "INVALID_BACKUP");
  }
  try {
    parseInstant(manifest.createdAt, "backup createdAt");
  } catch {
    throw new LearningError(`Backup manifest has an invalid timestamp: ${expectedId}`, "INVALID_BACKUP");
  }
  return manifest;
}

export function createBackup(root, { id, now } = {}) {
  const paths = pathsFor(root);
  const createdAt = parseInstant(now ?? new Date().toISOString(), "backup time");
  const backupId = validateBackupId(id ?? `backup-${createdAt.replace(/[:.]/g, "-")}`);
  const destination = path.join(paths.backups, backupId);
  ensureDirectory(paths.backups);
  if (fs.existsSync(destination)) {
    throw new LearningError(`Backup already exists: ${backupId}`, "BACKUP_EXISTS");
  }

  const state = validateState(readState(root));
  const stateContents = `${JSON.stringify(state, null, 2)}\n`;
  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    id: backupId,
    createdAt,
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    stateFile: "state.json",
    stateSha256: sha256(stateContents),
  };
  const staging = path.join(paths.backups, `.tmp-${backupId}-${process.pid}-${randomUUID()}`);

  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    writeDurable(path.join(staging, "state.json"), stateContents);
    writeDurable(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    syncDirectory(staging);
    fs.renameSync(staging, destination);
    syncDirectory(paths.backups);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  return { id: backupId, path: destination, manifest };
}

export function checkBackup(root, id) {
  const backupId = validateBackupId(id);
  const backupPath = path.join(pathsFor(root).backups, backupId);
  let manifestContents;
  let stateContents;
  try {
    manifestContents = fs.readFileSync(path.join(backupPath, "manifest.json"), "utf8");
    stateContents = fs.readFileSync(path.join(backupPath, "state.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new LearningError(`Backup is incomplete or missing: ${backupId}`, "BACKUP_NOT_FOUND");
    }
    throw error;
  }

  const manifest = validateManifest(parseJson(manifestContents, "Backup manifest"), backupId);
  if (sha256(stateContents) !== manifest.stateSha256) {
    throw new LearningError(`Backup checksum mismatch: ${backupId}`, "BACKUP_CHECKSUM_MISMATCH");
  }
  const state = validateState(parseJson(stateContents, "Backup state"));
  if (state.schemaVersion !== manifest.schemaVersion || state.revision !== manifest.revision) {
    throw new LearningError(`Backup state does not match its manifest: ${backupId}`, "BACKUP_MANIFEST_MISMATCH");
  }
  return { valid: true, id: backupId, path: backupPath, manifest, state };
}

export function listBackups(root) {
  const directory = pathsFor(root).backups;
  if (!fs.existsSync(directory)) {
    return { count: 0, valid: 0, invalid: 0, legacy: 0, items: [] };
  }

  const items = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".tmp-")) continue;
    if (entry.isFile() && /^state-v1-.*\.json$/.test(entry.name)) {
      items.push({ id: entry.name, kind: "legacy-v1", valid: true, error: null });
      continue;
    }
    if (!entry.isDirectory()) continue;
    try {
      const checked = checkBackup(root, entry.name);
      items.push({
        id: entry.name,
        kind: "manifest",
        valid: true,
        error: null,
        manifest: checked.manifest,
      });
    } catch (error) {
      items.push({
        id: entry.name,
        kind: "manifest",
        valid: false,
        error: error.message,
      });
    }
  }
  items.sort((left, right) => left.id.localeCompare(right.id));
  return {
    count: items.length,
    valid: items.filter((item) => item.kind === "manifest" && item.valid).length,
    invalid: items.filter((item) => !item.valid).length,
    legacy: items.filter((item) => item.kind === "legacy-v1").length,
    items,
  };
}
