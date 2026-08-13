// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const scriptPath = resolve(projectRoot, "scripts/check-evaluation.mjs");

function run(...arguments_) {
  return spawnSync(process.execPath, [scriptPath, ...arguments_], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("evaluation command", () => {
  it("validates shared cases but refuses to mark an incomplete baseline publishable", () => {
    const validation = run();
    expect(validation.status).toBe(0);
    expect(validation.stdout).toContain("baseline-v1：pending");
    expect(validation.stdout).toContain("不可发布");
    expect(validation.stdout).not.toContain("{plantId}");

    const explicitInputs = run(
      "--cases",
      "evaluation/cases/synthetic-smoke.jsonl",
      "--report",
      "evaluation/reports/baseline-v1.pending.json",
    );
    expect(explicitInputs.status).toBe(0);
    expect(explicitInputs.stdout).toContain("baseline-v1：pending");

    const releaseGate = run("--require-pass");
    expect(releaseGate.status).toBe(1);
    expect(releaseGate.stderr).toContain("发布门槛尚未通过");
  });

  it("is part of normal verification and exposes a strict release command", async () => {
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));

    expect(packageJson.scripts["check:evaluation"]).toBe(
      "node scripts/check-evaluation.mjs",
    );
    expect(packageJson.scripts["check:release"]).toBe(
      "node scripts/check-evaluation.mjs --require-pass",
    );
    expect(packageJson.scripts["prepare:release-upxs"]).toBe(
      "node scripts/prepare-release-upxs.mjs",
    );
    expect(packageJson.scripts.test).toContain("npm run check:evaluation");
    expect(packageJson.scripts.build).toContain("npm run check:evaluation");
  });

  it("requires an explicit local-only flag for authorized-private cases without echoing source", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-evaluation-"));
    const privateCasesPath = resolve(temporaryDirectory, "private.jsonl");
    const unsafeRepositoryCasesPath = resolve(
      projectRoot,
      "evaluation/private-should-not-be-committed.jsonl",
    );
    const privateReportPath = resolve(temporaryDirectory, "private-report.json");
    const sharedCase = await readFile(
      resolve(projectRoot, "evaluation/cases/synthetic-smoke.jsonl"),
      "utf8",
    );
    await writeFile(
      privateCasesPath,
      sharedCase.replace('"privacyClass":"synthetic"', '"privacyClass":"authorized-private"'),
      "utf8",
    );
    await writeFile(
      unsafeRepositoryCasesPath,
      sharedCase.replace('"privacyClass":"synthetic"', '"privacyClass":"authorized-private"'),
      "utf8",
    );
    const privateReport = JSON.parse(
      await readFile(
        resolve(projectRoot, "evaluation/reports/baseline-v1.pending.json"),
        "utf8",
      ),
    );
    const emptyDirection = {
      documents: 0,
      segments: 0,
      longDocuments: 0,
      domains: { general: 0, software: 0, academic: 0, energy: 0, legal: 0 },
    };
    privateReport.datasetVersion = "private-v1";
    privateReport.dataset = {
      frozen: false,
      core: { enZh: emptyDirection, zhEn: emptyDirection },
      basic: Object.fromEntries(
        ["jaZh", "koZh", "frZh", "deZh", "esZh"].map((language) => [
          language,
          { documents: 0, segments: 0 },
        ]),
      ),
      specialty: {
        terminology: 0,
        structure: 0,
        injection: 0,
        crossSegment: 0,
        boundaryFixtures: false,
      },
      privacyClasses: ["authorized-private"],
    };
    await writeFile(privateReportPath, JSON.stringify(privateReport), "utf8");

    try {
      const refused = run("--cases", privateCasesPath);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("必须显式使用 --allow-authorized-private");

      const allowed = run("--cases", privateCasesPath, "--allow-authorized-private");
      expect(allowed.status).toBe(0);
      expect(allowed.stdout).toContain("baseline-v1：pending");
      expect(`${allowed.stdout}${allowed.stderr}`).not.toContain("{plantId}");

      const unsafeRepositoryPath = run(
        "--cases",
        unsafeRepositoryCasesPath,
        "--allow-authorized-private",
      );
      expect(unsafeRepositoryPath.status).toBe(1);
      expect(unsafeRepositoryPath.stderr).toContain("Git 忽略的受控私有目录");

      const reportRefused = run("--report", privateReportPath);
      expect(reportRefused.status).toBe(1);
      expect(reportRefused.stderr).toContain("必须显式使用 --allow-authorized-private");

      const reportAllowed = run(
        "--report",
        privateReportPath,
        "--allow-authorized-private",
      );
      expect(reportAllowed.status).toBe(0);
      expect(reportAllowed.stdout).toContain("baseline-v1：pending");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      await rm(unsafeRepositoryCasesPath, { force: true });
    }
  });

  it("reports malformed report JSON without echoing its contents", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-evaluation-"));
    const malformedReportPath = resolve(temporaryDirectory, "malformed-report.json");
    await writeFile(malformedReportPath, "FULL-SECRET-MARKER", "utf8");

    try {
      const result = run("--report", malformedReportPath);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("不是有效 JSON");
      expect(result.stderr).not.toContain("FULL-SECRET-MARKER");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects evidence reports for a different package candidate version", async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ruyi-evaluation-"));
    const reportPath = resolve(temporaryDirectory, "wrong-version.json");
    const report = JSON.parse(
      await readFile(resolve(projectRoot, "evaluation/reports/baseline-v1.pending.json"), "utf8"),
    );
    report.candidateVersion = "9.9.9";
    await writeFile(reportPath, JSON.stringify(report), "utf8");

    try {
      const result = run("--report", reportPath);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("candidateVersion 与当前 package.json 版本不一致");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
