import fs from "node:fs";

import { mutateState } from "../../src/store.mjs";

const [root, delayText, signal] = process.argv.slice(2);
const delay = Number(delayText);

mutateState(root, (state) => {
  if (signal) fs.writeFileSync(signal, "locked\n");
  if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  state.counter = (state.counter ?? 0) + 1;
  return state;
});
