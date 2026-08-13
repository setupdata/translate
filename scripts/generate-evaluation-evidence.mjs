import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  EVALUATION_EVIDENCE_ARTIFACT_NAMES,
  createEvaluationEvidenceBundle,
} from "../evaluation/lib/evidence-bundle-v1.mjs";
import { parseEvaluationCases } from "../evaluation/lib/evaluation-v1.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const arguments_ = process.argv.slice(2);
const values = new Map();
let allowAuthorizedPrivate = false;
const unknownArguments = [];
const VALUE_ARGUMENTS = new Set([
  "--cases",
  "--report",
  "--input",
  "--out",
  "--evidence-id",
  "--build-input-sha256",
]);

for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--allow-authorized-private") {
    allowAuthorizedPrivate = true;
  } else if (VALUE_ARGUMENTS.has(argument)) {
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) unknownArguments.push(`${argument} 缺少值`);
    else {
      values.set(argument, value);
      index += 1;
    }
  } else {
    unknownArguments.push(argument);
  }
}

function requiredArgument(name) {
  const value = values.get(name);
  if (!value) throw new Error(`${name} 是必需参数。`);
  return value;
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
}

function within(directory, path) {
  const relativePath = relative(directory, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function comparablePath(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function assertOrdinaryDirectory(path, label) {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label}必须是普通目录，不能是符号链接。`);
  }
  if (comparablePath(path) !== comparablePath(await realpath(path))) {
    throw new Error(`${label}不能通过符号链接或重解析点定位。`);
  }
}

async function readControlledChild(baseDirectory, childPath, encoding = null) {
  const absolutePath = resolve(baseDirectory, childPath);
  if (!within(baseDirectory, absolutePath)) throw new Error("输入子文件超出受控暂存目录。");
  const details = await lstat(absolutePath);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error("输入子文件必须是普通文件，不能是符号链接。");
  }
  const [realBase, realChild] = await Promise.all([realpath(baseDirectory), realpath(absolutePath)]);
  if (!within(realBase, realChild) || comparablePath(absolutePath) !== comparablePath(realChild)) {
    throw new Error("输入子文件通过符号链接或重解析点越过了暂存目录。");
  }
  return encoding === null ? readFile(realChild) : readFile(realChild, encoding);
}

async function listOrdinaryFiles(baseDirectory, directory = baseDirectory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listOrdinaryFiles(baseDirectory, absolutePath)));
    } else if (entry.isFile()) {
      const details = await lstat(absolutePath);
      if (details.isSymbolicLink()) throw new Error("输入目录不能包含符号链接。");
      files.push(relative(baseDirectory, absolutePath).replaceAll("\\", "/"));
    } else {
      throw new Error("输入目录只能包含普通文件和目录。");
    }
  }
  return files;
}

async function assertExactInputFiles(inputDirectory, attachmentDefinition) {
  const expected = new Set([
    "attachments.json",
    ...EVALUATION_EVIDENCE_ARTIFACT_NAMES.map((name) => `artifacts/${name}.jsonl`),
    ...(attachmentDefinition.attachments ?? []).map((attachment) => attachment.path),
  ]);
  const actual = await listOrdinaryFiles(inputDirectory);
  const unexpected = actual.filter((path) => !expected.has(path));
  if (unexpected.length > 0) {
    throw new Error(`输入目录含附件索引之外的文件：${unexpected.join("、")}`);
  }
  const missing = [...expected].filter((path) => !actual.includes(path));
  if (missing.length > 0) throw new Error(`输入目录缺少声明文件：${missing.join("、")}`);
}

async function assertControlledLocalDirectory(path, label) {
  const absolutePath = resolve(path);
  const projectRelative = relative(projectRoot, absolutePath).replaceAll("\\", "/");
  if (projectRelative.startsWith("../") || isAbsolute(projectRelative)) return;
  if (!projectRelative.startsWith("evaluation/evidence/")) {
    throw new Error(`${label}在项目内时必须位于 Git 忽略的 evaluation/evidence/ 目录。`);
  }
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", absolutePath], {
    cwd: projectRoot,
  });
  if (ignored.status !== 0) throw new Error(`${label}必须位于 Git 忽略的目录。`);
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
    (kind === "report" && /^evaluation\/reports\/[^/]+\.local\.json$/u.test(projectRelative));
  if (!allowedByLocation) return false;
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", realPath], {
    cwd: projectRoot,
  });
  return ignored.status === 0;
}

function currentCommitSha() {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const commitSha = revision.stdout.trim();
  if (revision.status !== 0 || !/^[a-f\d]{40}$/u.test(commitSha)) {
    throw new Error("无法确认当前 Git commit。");
  }
  return commitSha;
}

async function outputMustNotExist(path) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("输出目录已存在；为避免覆盖证据，请使用新的目录。");
}

async function writeBundle({
  outputDirectory,
  inputDirectory,
  manifest,
  artifactSources,
  attachmentDefinition,
}) {
  const outputParent = dirname(outputDirectory);
  await mkdir(outputParent, { recursive: true });
  const temporaryDirectory = await mkdtemp(resolve(outputParent, ".ruyi-evidence-"));
  try {
    await mkdir(resolve(temporaryDirectory, "artifacts"), { recursive: true });
    for (const [artifactPath, source] of Object.entries(artifactSources)) {
      await writeFile(resolve(temporaryDirectory, artifactPath), source, "utf8");
    }
    for (const attachment of attachmentDefinition.attachments) {
      const target = resolve(temporaryDirectory, attachment.path);
      await mkdir(dirname(target), { recursive: true });
      await cp(resolve(inputDirectory, attachment.path), target, {
        dereference: false,
        errorOnExist: true,
        force: false,
      });
    }
    await writeFile(
      resolve(temporaryDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryDirectory, outputDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

if (unknownArguments.length > 0) {
  process.stderr.write(`未知参数：${unknownArguments.join("、")}\n`);
  process.exitCode = 1;
} else {
  try {
    const casesPath = resolve(projectRoot, requiredArgument("--cases"));
    const reportPath = resolve(projectRoot, requiredArgument("--report"));
    const inputDirectory = resolve(projectRoot, requiredArgument("--input"));
    const outputDirectory = resolve(projectRoot, requiredArgument("--out"));
    const evidenceId = requiredArgument("--evidence-id");
    const buildInputSha256 = requiredArgument("--build-input-sha256");
    if (within(inputDirectory, outputDirectory) || within(outputDirectory, inputDirectory)) {
      throw new Error("输入目录和输出目录不能互相包含。");
    }
    await assertOrdinaryDirectory(inputDirectory, "输入目录");
    await assertControlledLocalDirectory(inputDirectory, "输入目录");
    await assertControlledLocalDirectory(outputDirectory, "输出目录");
    await mkdir(dirname(outputDirectory), { recursive: true });
    await assertOrdinaryDirectory(dirname(outputDirectory), "输出父目录");
    await outputMustNotExist(outputDirectory);

    const casesSource = await readFile(casesPath, "utf8");
    const cases = parseEvaluationCases(casesSource, { sourceName: "评测用例" });
    const hasAuthorizedPrivateCases = cases.some(
      (item) => item.privacyClass === "authorized-private",
    );
    if (hasAuthorizedPrivateCases && !allowAuthorizedPrivate) {
      throw new Error(
        "authorized-private 数据只能用于本地受控评测，必须显式使用 --allow-authorized-private。",
      );
    }
    if (hasAuthorizedPrivateCases && !(await isControlledPrivatePath(casesPath, "cases"))) {
      throw new Error(
        "authorized-private 用例必须放在 Git 忽略的受控私有目录或项目目录之外。",
      );
    }
    const report = parseJson(await readFile(reportPath, "utf8"), "评测报告");
    if (
      report?.dataset?.privacyClasses?.includes("authorized-private") &&
      !allowAuthorizedPrivate
    ) {
      throw new Error(
        "含 authorized-private 证据的报告必须显式使用 --allow-authorized-private。",
      );
    }
    if (
      report?.dataset?.privacyClasses?.includes("authorized-private") &&
      !(await isControlledPrivatePath(reportPath, "report"))
    ) {
      throw new Error(
        "authorized-private 报告必须放在 Git 忽略的本地报告路径或项目目录之外。",
      );
    }
    const packageJson = parseJson(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
      "package.json",
    );
    if (report.candidateVersion !== packageJson.version) {
      throw new Error("评测报告 candidateVersion 与当前 package.json 版本不一致。");
    }

    const attachmentDefinition = parseJson(
      await readControlledChild(inputDirectory, "attachments.json", "utf8"),
      "附件索引",
    );
    await assertExactInputFiles(inputDirectory, attachmentDefinition);
    const artifactSources = Object.fromEntries(
      await Promise.all(
        EVALUATION_EVIDENCE_ARTIFACT_NAMES.map(async (name) => {
          const path = `artifacts/${name}.jsonl`;
          return [path, await readControlledChild(inputDirectory, path, "utf8")];
        }),
      ),
    );
    const attachmentSources = Object.fromEntries(
      await Promise.all(
        (attachmentDefinition.attachments ?? []).map(async (attachment) => [
          attachment.path,
          await readControlledChild(inputDirectory, attachment.path),
        ]),
      ),
    );
    const bundle = createEvaluationEvidenceBundle({
      evidenceId,
      commitSha: currentCommitSha(),
      buildInputSha256,
      report,
      cases,
      casesSource,
      artifactSources,
      attachmentDefinition,
      attachmentSources,
    });
    await writeBundle({
      outputDirectory,
      inputDirectory,
      manifest: bundle.manifest,
      artifactSources,
      attachmentDefinition,
    });
    process.stdout.write(
      `证据包已生成并通过完整性校验：${resolve(outputDirectory, "manifest.json")}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `评测证据生成失败：${error instanceof Error ? error.message : "未知错误"}\n`,
    );
    process.exitCode = 1;
  }
}
