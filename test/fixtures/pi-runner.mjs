const [mode] = process.argv.slice(2);

if (mode === "json") {
  process.stdout.write(`${JSON.stringify({ ok: true, mode })}\n`);
} else if (mode === "wait") {
  setTimeout(() => {
    process.stdout.write(`${JSON.stringify({ ok: true, mode })}\n`);
  }, 250);
} else if (mode === "malformed") {
  process.stdout.write("not-json\n");
} else if (mode === "overflow") {
  process.stdout.write("x".repeat(64 * 1024));
} else if (mode === "failure") {
  process.stderr.write("[FIXTURE_FAILURE] Fixture command failed.\n");
  process.exitCode = 1;
} else if (mode === "render-warning") {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    stateCommitted: true,
    stateRevision: 7,
    render: {
      ok: false,
      code: "RENDER_FAILED",
      error: "Fixture renderer failed.",
    },
  })}\n`);
  process.exitCode = 1;
} else {
  process.stderr.write(`[UNKNOWN_FIXTURE_MODE] Unknown fixture mode: ${mode}\n`);
  process.exitCode = 1;
}
