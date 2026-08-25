import assert from "node:assert/strict";
import test from "node:test";

import { runtimeCompatibility } from "../src/doctor.mjs";

test("runtime compatibility separates the engine from Pi 0.84", () => {
  assert.deepEqual(
    runtimeCompatibility("20.20.2"),
    {
      version: "20.20.2",
      major: 20,
      minimumSatisfied: true,
      releaseMatrix: [20, 22],
      releaseMatrixMember: true,
      piMinimumVersion: "22.19.0",
      piMinimumSatisfied: false,
    },
  );
  assert.equal(runtimeCompatibility("22.18.0").piMinimumSatisfied, false);
  assert.equal(runtimeCompatibility("22.19.0").piMinimumSatisfied, true);
  assert.equal(runtimeCompatibility("26.0.0").piMinimumSatisfied, true);
});
