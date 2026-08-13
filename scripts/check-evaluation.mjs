import { lstat, readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  evaluateReleaseGate,
  evaluateReleaseGateWithEvidence,
  parseEvaluationCases,
} from "../evaluation/lib/evaluation-v1.mjs";
import {
  listEvaluationEvidenceArtifactPaths,
  listEvaluationEvidenceAttachmentPaths,
} from "../evaluation/lib/evidence-v1.mjs";
import { hashPackageInput } from "./lib/package-input-hash.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const arguments_ = process.argv.slice(2);
let casesArgument = "evaluation/cases/synthetic-smoke.jsonl";
let reportArgument = "evaluation/reports/baseline-v1.pending.json";
let evidenceArgument = null;
let requirePass = false;
let allowAuthorizedPrivate = false;
const unknownArguments = [];

for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--require-pass") {
    requirePass = true;
  } else if (argument === "--allow-authorized-private") {
    allowAuthorizedPrivate = true;
  } else if (argument === "--cases" || argument === "--report" || argument === "--evidence") {
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      unknownArguments.push(`${argument} 缺少路径`);
    } else {
      if (argument === "--cases") casesArgument = value;
      else if (argument === "--report") reportArgument = value;
      else evidenceArgument = value;
      index += 1;
    }
  } else {
    unknownArguments.push(argument);
  }
}

const casesPath = resolve(projectRoot, casesArgument);
const reportPath = resolve(projectRoot, reportArgument);
const evidencePath = evidenceArgument === null ? null : resolve(projectRoot, evidenceArgument);

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
}

function comparablePath(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function within(directory, path) {
  const relativePath = relative(directory, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function isControlledPrivatePath(path, kind) {
  const resolvedPath = resolve(path);
  const realPath = await realpath(resolvedPath);
  if (comparablePath(resolvedPath) !== comparablePath(realPath)) return false;
  const projectRelative = relative(projectRoot, realPath).replaceAll("\\", "/");
  if (projectRelative.startsWith("../") || isAbsolute(projectRelative)) return true;
  const allowedByLocation =
    projectRelative.startsWith("evaluation/private/") ||
    (kind === "cases" && projectRelative.startsWith("evaluation/cases/authorized-private/")) ||
    (kind === "report" && /^evaluation\/reports\/[^/]+\.local\.json$/u.test(projectRelative)) ||
    (kind === "evidence" && projectRelative.startsWith("evaluation/evidence/"));
  if (!allowedByLocation) return false;
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", realPath], {
    cwd: projectRoot,
  });
  return ignored.status === 0;
}

async function readEvidenceChild(baseDirectory, childPath, encoding = null) {
  const absolutePath = resolve(baseDirectory, childPath);
  if (!within(baseDirectory, absolutePath)) throw new Error("证据子文件超出证据清单目录。");
  const stats = await lstat(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("证据子文件必须是普通文件，不能是符号链接。");
  const [realBase, realChild] = await Promise.all([realpath(baseDirectory), realpath(absolutePath)]);
  if (!within(realBase, realChild) || comparablePath(absolutePath) !== comparablePath(realChild)) {
    throw new Error("证据子文件通过符号链接或重解析点越过了清单目录。");
  }
  return encoding === null ? readFile(realChild) : readFile(realChild, encoding);
}

function runCurrentCandidateChecks() {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const arguments_ of [["test"], ["run", "build"]]) {
    const result = spawnSync(npmExecutable, arguments_, { cwd: projectRoot, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`当前候选的 ${arguments_.join(" ")} 未通过。`);
  }
}

function currentGitState() {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (revision.status !== 0 || !/^[a-f\d]{40}$/u.test(revision.stdout.trim())) {
    throw new Error("无法确认当前 Git commit，不能作出严格发布判定。");
  }
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (status.status !== 0) throw new Error("无法确认当前 Git 工作区状态。");
  return { commitSha: revision.stdout.trim(), clean: status.stdout.trim().length === 0 };
}

if (unknownArguments.length > 0) {
  process.stderr.write(`未知参数：${unknownArguments.join("、")}\n`);
  process.exitCode = 1;
} else {
  try {
    const casesSource = await readFile(casesPath, "utf8");
    const cases = parseEvaluationCases(casesSource, {
      sourceName: casesArgument,
    });
    const forbidden = cases.filter((item) => item.privacyClass === "authorized-private");
    if (forbidden.length > 0 && !allowAuthorizedPrivate) {
      throw new Error(
        "authorized-private 数据只能用于本地受控评测，必须显式使用 --allow-authorized-private。",
      );
    }
    if (forbidden.length > 0 && !(await isControlledPrivatePath(casesPath, "cases"))) {
      throw new Error("authorized-private 用例必须放在 Git 忽略的受控私有目录或项目目录之外。");
    }
    const report = parseJson(await readFile(reportPath, "utf8"), "评测报告");
    const packageJson = parseJson(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
      "package.json",
    );
    if (report?.candidateVersion !== packageJson.version) {
      throw new Error("评测报告 candidateVersion 与当前 package.json 版本不一致。");
    }
    if (
      Array.isArray(report?.dataset?.privacyClasses) &&
      report.dataset.privacyClasses.includes("authorized-private") &&
      !allowAuthorizedPrivate
    ) {
      throw new Error(
        "含 authorized-private 证据的报告只能用于本地受控评测，必须显式使用 --allow-authorized-private。",
      );
    }
    if (
      report?.dataset?.privacyClasses?.includes("authorized-private") &&
      !(await isControlledPrivatePath(reportPath, "report"))
    ) {
      throw new Error("authorized-private 报告必须放在 Git 忽略的本地报告路径或项目目录之外。");
    }
    let evidenceInput = null;
    if (evidencePath !== null) {
      if (
        report?.dataset?.privacyClasses?.includes("authorized-private") &&
        !(await isControlledPrivatePath(evidencePath, "evidence"))
      ) {
        throw new Error("authorized-private 证据必须放在 Git 忽略的受控私有目录或项目目录之外。");
      }
      const manifest = parseJson(await readFile(evidencePath, "utf8"), "评测证据清单");
      if (requirePass) {
        const gitState = currentGitState();
        if (!gitState.clean) {
          throw new Error("Git 工作区含未提交的已跟踪改动，不能作出严格发布判定。");
        }
        if (manifest.commitSha !== gitState.commitSha) {
          throw new Error("评测证据绑定的 Git commit 不是当前候选 commit。");
        }
      }
      const artifactPaths = listEvaluationEvidenceArtifactPaths(manifest);
      const attachmentPaths = listEvaluationEvidenceAttachmentPaths(manifest);
      const evidenceDirectory = dirname(evidencePath);
      const artifactSources = Object.fromEntries(
        await Promise.all(
          artifactPaths.map(async (artifactPath) => [
            artifactPath,
            await readEvidenceChild(evidenceDirectory, artifactPath, "utf8"),
          ]),
        ),
      );
      const attachmentSources = Object.fromEntries(
        await Promise.all(
          attachmentPaths.map(async (attachmentPath) => [
            attachmentPath,
            await readEvidenceChild(evidenceDirectory, attachmentPath),
          ]),
        ),
      );
      evidenceInput = {
        manifest,
        cases,
        casesSource,
        artifactSources,
        attachmentSources,
      };
    }
    const gate = evidenceInput === null
      ? evaluateReleaseGate(report)
      : await evaluateReleaseGateWithEvidence(report, evidenceInput);
    if (requirePass && gate.canPublish) {
      runCurrentCandidateChecks();
      const currentPackageInputSha256 = await hashPackageInput(resolve(projectRoot, "dist"));
      if (currentPackageInputSha256 !== evidenceInput?.manifest.buildInputSha256) {
        throw new Error("评测证据绑定的 UPXS 构建输入与当前 dist 不一致。");
      }
    }
    process.stdout.write(
      `已校验 ${cases.length} 条${allowAuthorizedPrivate ? "本地" : "共享"}评测用例；baseline-v1：${gate.status}，${gate.canPublish ? "可以发布" : "不可发布"}。\n`,
    );
    if (gate.reasons.length > 0) {
      process.stdout.write(`门槛记录：${gate.reasons.map((reason) => reason.code).join("、")}。\n`);
    }
    if (requirePass && !gate.canPublish) {
      process.stderr.write("发布门槛尚未通过；不能把当前版本标记为发布候选。\n");
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`评测资产校验失败：${error instanceof Error ? error.message : "未知错误"}\n`);
    process.exitCode = 1;
  }
}
