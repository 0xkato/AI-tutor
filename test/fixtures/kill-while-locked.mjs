import fs from "node:fs";

import { mutateState, pathsFor } from "../../src/store.mjs";

const [root, signal] = process.argv.slice(2);

mutateState(root, (state) => {
  const lock = JSON.parse(fs.readFileSync(pathsFor(root).lock, "utf8"));
  fs.writeFileSync(signal, `${JSON.stringify(lock)}\n`, { mode: 0o600 });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  return state;
});
