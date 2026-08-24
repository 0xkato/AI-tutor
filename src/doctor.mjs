import fs from "node:fs";

import { listBackups } from "./backup.mjs";
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

function inspectRender(state) {
  if (!state) {
    return {
      stateRevision: null,
      renderedRevision: null,
      status: "unknown",
      current: false,
      error: "Canonical state is invalid",
    };
  }
  return {
    stateRevision: state.revision,
    renderedRevision: state.render.revision,
    status: state.render.status,
    current: state.render.status === "current" && state.render.revision === state.revision,
    error: state.render.error,
  };
}

export function doctor(root) {
  const paths = pathsFor(root);
  const inspectedState = inspectState(paths.state);
  const lock = inspectLock(root);
  const backups = listBackups(root);
  const render = inspectRender(inspectedState.state);
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
  if (fs.existsSync(paths.backups) && !permissions.backupsOwnerOnly) {
    actions.push("Restrict backup permissions to the current user.");
  }

  return {
    ok:
      inspectedState.report.valid &&
      lock.valid &&
      backups.invalid === 0 &&
      permissions.dataDirectoryOwnerOnly &&
      permissions.stateOwnerOnly &&
      (!fs.existsSync(paths.backups) || permissions.backupsOwnerOnly),
    root: paths.dataDir,
    state: inspectedState.report,
    lock,
    backups,
    render,
    permissions,
    actions,
  };
}
