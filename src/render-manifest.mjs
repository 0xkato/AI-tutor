import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";
import { pathsFor } from "./store.mjs";

const RENDER_FORMAT_VERSION = 1;

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

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new LearningError("Generated paths must be non-empty POSIX paths", "INVALID_RENDER_PATH");
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new LearningError(`Unsafe generated path: ${value}`, "INVALID_RENDER_PATH");
  }
  return normalized;
}

function safeVault(root, vaultDir) {
  const base = path.resolve(root);
  const target = path.resolve(base, vaultDir || "vault");
  if (target === base || !target.startsWith(`${base}${path.sep}`)) {
    throw new LearningError("vaultDir must be a child directory of the learning root", "INVALID_VAULT");
  }
  return target;
}

function lstatIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertNoSymlink(base, target) {
  const root = path.resolve(base);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new LearningError(`Generated path escapes its root: ${target}`, "INVALID_RENDER_PATH");
  }
  const relative = path.relative(root, resolved);
  let current = root;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new LearningError(`Symlink traversal is not allowed: ${current}`, "SYMLINK_TRAVERSAL");
    }
  }
}

function ensureDirectorySafe(base, directory) {
  const root = path.resolve(base);
  const target = path.resolve(directory);
  assertNoSymlink(root, target);
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = lstatIfPresent(current);
    if (stat) {
      if (stat.isSymbolicLink()) {
        throw new LearningError(`Symlink traversal is not allowed: ${current}`, "SYMLINK_TRAVERSAL");
      }
      if (!stat.isDirectory()) {
        throw new LearningError(`Generated directory path is not a directory: ${current}`, "INVALID_RENDER_TARGET");
      }
      continue;
    }
    fs.mkdirSync(current, { mode: 0o700 });
  }
}

function parseManifest(raw, label) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new LearningError(`${label} is not valid JSON: ${error.message}`, "INVALID_RENDER_MANIFEST");
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.formatVersion !== RENDER_FORMAT_VERSION ||
    !Number.isInteger(manifest.stateRevision) ||
    manifest.stateRevision < 0 ||
    typeof manifest.vaultDir !== "string" ||
    !Array.isArray(manifest.generated)
  ) {
    throw new LearningError(`${label} has an invalid structure`, "INVALID_RENDER_MANIFEST");
  }
  const seen = new Set();
  manifest.generated = manifest.generated.map((entry) => {
    const relativePath = safeRelativePath(entry?.path);
    if (seen.has(relativePath)) {
      throw new LearningError(`${label} repeats ${relativePath}`, "INVALID_RENDER_MANIFEST");
    }
    seen.add(relativePath);
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new LearningError(`${label} has an invalid hash for ${relativePath}`, "INVALID_RENDER_MANIFEST");
    }
    return { path: relativePath, sha256: entry.sha256 };
  });
  return manifest;
}

function readOptionalManifest(file, label) {
  try {
    return parseManifest(fs.readFileSync(file, "utf8"), label);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeAtomicJson(dataDir, destination, payload) {
  const temporary = path.join(dataDir, `${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
    syncDirectory(dataDir);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function absoluteGenerated(root, manifest, entry) {
  const vault = safeVault(root, manifest.vaultDir);
  const target = path.resolve(vault, entry.path.split("/").join(path.sep));
  if (!target.startsWith(`${vault}${path.sep}`)) {
    throw new LearningError(`Generated path escapes the vault: ${entry.path}`, "INVALID_RENDER_PATH");
  }
  return { vault, target };
}

function ownedKeys(manifests) {
  const keys = new Set();
  for (const manifest of manifests.filter(Boolean)) {
    for (const entry of manifest.generated) keys.add(`${manifest.vaultDir}\u0000${entry.path}`);
  }
  return keys;
}

export function readRenderManifest(root, { pending = false, required = true } = {}) {
  const paths = pathsFor(root);
  const file = pending ? paths.renderPending : paths.renderManifest;
  const manifest = readOptionalManifest(file, pending ? "Pending render manifest" : "Render manifest");
  if (!manifest && required) {
    throw new LearningError("Render manifest does not exist", "RENDER_MANIFEST_NOT_FOUND");
  }
  return manifest;
}

export function reconcileRender(root, { vaultDir, stateRevision, files }) {
  if (!Number.isInteger(stateRevision) || stateRevision < 0) {
    throw new LearningError("stateRevision must be a non-negative integer", "INVALID_RENDER_REVISION");
  }
  const paths = pathsFor(root);
  const base = path.resolve(root);
  const vault = safeVault(base, vaultDir);
  assertNoSymlink(base, vault);
  ensureDirectorySafe(base, paths.dataDir);
  ensureDirectorySafe(base, vault);

  const seen = new Set();
  const desired = files.map((file) => {
    const relativePath = safeRelativePath(file.relativePath);
    if (seen.has(relativePath)) {
      throw new LearningError(`Generated path appears twice: ${relativePath}`, "INVALID_RENDER_PATH");
    }
    seen.add(relativePath);
    const contents = String(file.contents);
    return { relativePath, contents, sha256: sha256(contents) };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const prior = readRenderManifest(root, { required: false });
  const interrupted = readRenderManifest(root, { pending: true, required: false });
  const owned = ownedKeys([prior, interrupted]);
  const normalizedVaultDir = path.relative(base, vault).split(path.sep).join("/");

  for (const file of desired) {
    const target = path.join(vault, ...file.relativePath.split("/"));
    assertNoSymlink(vault, target);
    if (fs.existsSync(target) && !owned.has(`${normalizedVaultDir}\u0000${file.relativePath}`)) {
      throw new LearningError(
        `Refusing to overwrite unmanifested file: ${file.relativePath}`,
        "UNMANAGED_RENDER_TARGET",
      );
    }
  }

  const manifest = {
    formatVersion: RENDER_FORMAT_VERSION,
    stateRevision,
    vaultDir: normalizedVaultDir,
    generated: desired.map((file) => ({ path: file.relativePath, sha256: file.sha256 })),
  };
  const staging = path.join(paths.dataDir, `render-stage-${process.pid}-${randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  let pendingWritten = false;
  try {
    for (const file of desired) {
      const staged = path.join(staging, ...file.relativePath.split("/"));
      ensureDirectorySafe(staging, path.dirname(staged));
      const fd = fs.openSync(staged, "wx", 0o600);
      try {
        fs.writeFileSync(fd, file.contents, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    syncDirectory(staging);
    writeAtomicJson(paths.dataDir, paths.renderPending, manifest);
    pendingWritten = true;

    for (const file of desired) {
      const staged = path.join(staging, ...file.relativePath.split("/"));
      const target = path.join(vault, ...file.relativePath.split("/"));
      ensureDirectorySafe(vault, path.dirname(target));
      assertNoSymlink(vault, target);
      fs.renameSync(staged, target);
      fs.chmodSync(target, 0o600);
      syncDirectory(path.dirname(target));
    }

    const desiredKeys = new Set(
      desired.map((file) => `${normalizedVaultDir}\u0000${file.relativePath}`),
    );
    for (const oldManifest of [prior, interrupted].filter(Boolean)) {
      for (const entry of oldManifest.generated) {
        const key = `${oldManifest.vaultDir}\u0000${entry.path}`;
        if (desiredKeys.has(key)) continue;
        const { vault: oldVault, target } = absoluteGenerated(base, oldManifest, entry);
        assertNoSymlink(oldVault, target);
        if (!fs.existsSync(target)) continue;
        if (!fs.lstatSync(target).isFile()) {
          throw new LearningError(`Managed render target is not a file: ${entry.path}`, "INVALID_RENDER_TARGET");
        }
        fs.unlinkSync(target);
        syncDirectory(path.dirname(target));
      }
    }

    writeAtomicJson(paths.dataDir, paths.renderManifest, manifest);
    fs.unlinkSync(paths.renderPending);
    syncDirectory(paths.dataDir);
    pendingWritten = false;
    return manifest;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!pendingWritten) fs.rmSync(paths.renderPending, { force: true });
  }
}

export function inspectRenderProjection(root, state) {
  try {
    const manifest = readRenderManifest(root, { required: false });
    const pending = readRenderManifest(root, { pending: true, required: false });
    if (pending) {
      return {
        stateRevision: state.revision,
        renderedRevision: manifest?.stateRevision ?? state.render.revision,
        status: "partial",
        current: false,
        error: "A prior render did not finish; run repair-render.",
      };
    }
    if (!manifest) {
      return {
        stateRevision: state.revision,
        renderedRevision: state.render.revision,
        status: state.render.status,
        current: false,
        error: state.render.error,
      };
    }
    for (const entry of manifest.generated) {
      const { vault, target } = absoluteGenerated(root, manifest, entry);
      assertNoSymlink(vault, target);
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
        return {
          stateRevision: state.revision,
          renderedRevision: manifest.stateRevision,
          status: "partial",
          current: false,
          error: `Generated file is missing: ${entry.path}`,
        };
      }
      if (sha256(fs.readFileSync(target)) !== entry.sha256) {
        return {
          stateRevision: state.revision,
          renderedRevision: manifest.stateRevision,
          status: "partial",
          current: false,
          error: `Generated file does not match its manifest: ${entry.path}`,
        };
      }
    }
    const current = manifest.stateRevision === state.revision;
    return {
      stateRevision: state.revision,
      renderedRevision: manifest.stateRevision,
      status: current ? "current" : "stale",
      current,
      error: null,
    };
  } catch (error) {
    return {
      stateRevision: state.revision,
      renderedRevision: null,
      status: "invalid",
      current: false,
      error: error.message,
    };
  }
}
