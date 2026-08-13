import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVALUATION_PATH =
  /(?:^|\/)(?:(?:evaluations?|eval|evaluation-cache|eval-cache)(?:\/|$)|(?:evaluation|eval)[-_](?:loader|cache|reports?|cases?)[^/]*$)|\.jsonl$/iu;
const EVALUATION_SOURCE =
  /evaluation-case\.v1|evaluation-result\.v1|evaluation-report\.v1|evaluation-evidence-(?:manifest|record)\.v1|verified-evaluation-evidence\.v1|ruyi-evaluation-v1|baseline-v1|authorized-private|loadEvaluationCache|writeEvaluationCache|evaluationCache/iu;
const PAGE_HOST_ACCESS =
  /window\.utools|navigator\.clipboard\s*\.\s*readText|clipboardchange|onClipboardChange|getCopyedText/iu;

export function collectLocalPageAssets(source) {
  if (typeof source !== "string") throw new TypeError("页面源码必须是字符串。");
  if (/(?:src|href)=["']\/(?!\/)/u.test(source)) {
    throw new Error("构建产物包含根路径资源，无法从 uTools 的本地文件入口加载。");
  }
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu.test(source)) {
    throw new Error("生产 index.html 不能包含内联脚本。");
  }
  if (PAGE_HOST_ACCESS.test(source)) {
    throw new Error("页面构建产物越过命名业务接口访问宿主或剪贴板。");
  }
  const assets = new Set();
  for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
    const reference = match[1];
    if (!/^\.\/assets\/[A-Za-z0-9_-]+\.(?:css|js)$/u.test(reference)) {
      throw new Error(`index.html 引用了非本地或发布白名单之外的资源：${reference}`);
    }
    assets.add(reference.slice(2));
  }
  return assets;
}

export function assertNoRemoteStylesheetResources(source, packagePath) {
  if (typeof source !== "string" || typeof packagePath !== "string") {
    throw new TypeError("CSS 源码和包内路径必须是字符串。");
  }
  for (const match of source.matchAll(/(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?([^"')\s;]+)["']?\s*\)?/giu)) {
    const reference = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference)) {
      throw new Error(`页面样式引用了远程或内嵌资源：${packagePath}`);
    }
  }
}

export function assertNoEvaluationArtifacts({ packagePath, source = "" }) {
  if (typeof packagePath !== "string" || packagePath.length === 0) {
    throw new TypeError("packagePath 必须是非空字符串。");
  }
  if (EVALUATION_PATH.test(packagePath.replaceAll("\\", "/"))) {
    throw new Error(`构建产物含评测目录或加载器：${packagePath}`);
  }
  if (typeof source !== "string") throw new TypeError("source 必须是字符串。");
  if (EVALUATION_SOURCE.test(source)) {
    throw new Error(`构建产物含评测用例、报告或缓存代码：${packagePath}`);
  }
}

export function assertAllowedPackageFile({ packagePath, allowedPaths }) {
  if (!(allowedPaths instanceof Set)) throw new TypeError("allowedPaths 必须是 Set。");
  const normalizedPath = packagePath.replaceAll("\\", "/");
  if (!allowedPaths.has(normalizedPath)) {
    throw new Error(`构建产物含未列入发布白名单的文件：${packagePath}`);
  }
}

export function assertAllowedBuildModule({ moduleId, projectRoot }) {
  if (typeof moduleId !== "string" || typeof projectRoot !== "string") {
    throw new TypeError("moduleId 和 projectRoot 必须是字符串。");
  }
  if (moduleId.startsWith("\0") || moduleId.startsWith("virtual:")) return;
  let cleanId = moduleId.replace(/^\/@fs\//u, "/").split("?", 1)[0];
  if (cleanId.startsWith("file:")) {
    try {
      cleanId = fileURLToPath(cleanId);
    } catch {
      throw new Error(`页面构建引用了无效的 file URL：${moduleId}`);
    }
  }
  if (!isAbsolute(cleanId)) {
    throw new Error(`页面构建引用了无法归属到发布源码的模块：${moduleId}`);
  }
  const absoluteId = resolve(cleanId);
  const relativeId = relative(projectRoot, absoluteId).replaceAll("\\", "/");
  const allowed =
    relativeId === "index.html" ||
    relativeId.startsWith("src/") ||
    relativeId.startsWith("node_modules/");
  if (!allowed) {
    throw new Error(`页面构建引用了发布源码边界之外的模块：${relativeId}`);
  }
}
