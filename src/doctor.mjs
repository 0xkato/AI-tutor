import fs from "node:fs";
import path from "node:path";

import { listBackups } from "./backup.mjs";
import { inspectRenderProjection } from "./render-manifest.mjs";
import { validateState } from "./schema.mjs";
import { inspectLock, pathsFor } from "./store.mjs";

function ownerOnly(file) {
  try {
    return (fs.statSync(file).mode & 0o077) === 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function inspectState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      report: {
        exists: false,
        valid: false,
        schemaVersion: null,
        revision: null,
        error: "Learning state is not initialized",
      },
      state: null,
    };
  }
  try {
    const state = validateState(JSON.parse(fs.readFileSync(statePath, "utf8")));
    return {
      report: {
        exists: true,
        valid: true,
        schemaVersion: state.schemaVersion,
        revision: state.revision,
        error: null,
      },
      state,
    };
  } catch (error) {
    return {
      report: {
        exists: true,
        valid: false,
        schemaVersion: null,
        revision: null,
        error: error.message,
      },
      state: null,
    };
  }
}

function inspectRender(root, state) {
  if (!state) {
    return {
      stateRevision: null,
      renderedRevision: null,
      status: "unknown",
      current: false,
      error: "Canonical state is invalid",
    };
  }
  return inspectRenderProjection(root, state);
}

export function doctor(root) {
  const paths = pathsFor(root);
  const inspectedState = inspectState(paths.state);
  const lock = inspectLock(root);
  const backups = listBackups(root);
  const render = inspectRender(root, inspectedState.state);
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const runtime = {
    version: process.versions.node,
    major: nodeMajor,
    minimumSatisfied: Number.isInteger(nodeMajor) && nodeMajor >= 20,
    releaseMatrix: [20, 22],
    releaseMatrixMember: [20, 22].includes(nodeMajor),
  };
  const platform = {
    value: process.platform,
    supported: process.platform === "darwin",
  };
  const base = path.resolve(root);
  const codexSkill = path.join(base, ".agents", "skills", "adaptive-learning", "SKILL.md");
  const piExtension = path.join(base, ".pi", "extensions", "adaptive-learning.js");
  const piSettings = path.join(base, ".pi", "settings.json");
  let piSettingsValid = false;
  try {
    piSettingsValid = JSON.parse(fs.readFileSync(piSettings, "utf8")).enableSkillCommands === true;
  } catch {
    piSettingsValid = false;
  }
  const discovery = {
    codex: fs.existsSync(codexSkill) && fs.statSync(codexSkill).isFile(),
    pi:
      fs.existsSync(piExtension) &&
      fs.statSync(piExtension).isFile() &&
      piSettingsValid,
  };
  const vaultPath = inspectedState.state
    ? path.resolve(base, inspectedState.state.settings.vaultDir)
    : path.join(base, "vault");
  const vault = {
    path: vaultPath,
    exists: fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory(),
    ownerOnly: ownerOnly(vaultPath),
  };
  const permissions = {
    dataDirectoryOwnerOnly: ownerOnly(paths.dataDir),
    stateOwnerOnly: ownerOnly(paths.state),
    backupsOwnerOnly: ownerOnly(paths.backups),
  };
  const actions = [];

  if (!inspectedState.report.valid) actions.push("Restore or reinitialize canonical learning state.");
  if (lock.exists && !lock.valid) actions.push("Inspect and replace the invalid state lock manually.");
  if (lock.exists && lock.valid && lock.ownerAlive === false) {
    actions.push("Run a state mutation to recover the dead owner's stale lock.");
  }
  if (backups.invalid > 0) actions.push("Inspect invalid backups before attempting a restore.");
  if (inspectedState.report.valid && !render.current) {
    actions.push("Run repair-render to reconcile the Obsidian projection.");
  }
  if (!permissions.dataDirectoryOwnerOnly || !permissions.stateOwnerOnly) {
    actions.push("Restrict canonical state permissions to the current user.");
  }
  if (!runtime.minimumSatisfied) actions.push("Install Node.js 20 or newer.");
  if (!platform.supported) actions.push("Use macOS for the supported first release.");
  if (!discovery.codex) actions.push("Restore the Codex adaptive-learning skill files.");
  if (!discovery.pi) actions.push("Restore the Pi extension and enable project skill commands.");
  if (!vault.exists) actions.push("Run setup or repair-render to create the Obsidian vault.");
  if (vault.exists && !vault.ownerOnly) actions.push("Restrict vault permissions to the current user.");
  if (fs.existsSync(paths.backups) && !permissions.backupsOwnerOnly) {
    actions.push("Restrict backup permissions to the current user.");
  }

  return {
    ok:
      inspectedState.report.valid &&
      lock.valid &&
      backups.invalid === 0 &&
      runtime.minimumSatisfied &&
      platform.supported &&
      discovery.codex &&
      discovery.pi &&
      vault.exists &&
      vault.ownerOnly &&
      render.current &&
      permissions.dataDirectoryOwnerOnly &&
      permissions.stateOwnerOnly &&
      (!fs.existsSync(paths.backups) || permissions.backupsOwnerOnly),
    root: paths.dataDir,
    runtime,
    platform,
    discovery,
    vault,
    state: inspectedState.report,
    lock,
    backups,
    render,
    permissions,
    actions,
  };
}
