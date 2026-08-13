import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [
  resolve(projectRoot, "scripts/check-evaluation.mjs"),
  "--require-pass",
  ...process.argv.slice(2),
]);
run(process.execPath, [resolve(projectRoot, "scripts/prepare-upxs.mjs")]);
