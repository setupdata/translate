import { builtinModules } from "node:module";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const distDirectory = resolve(projectRoot, "dist");
const requiredFiles = [
  "index.html",
  "plugin.json",
  "preload.js",
  "logo.svg",
  "lib/node-chat-transport.cjs",
  "lib/chat-sse-parser.cjs",
  "lib/prompt-contracts.cjs",
  "lib/prompts.cjs",
  "lib/quality-checks.cjs",
  "lib/reference-translations.cjs",
  "lib/responses-parser.cjs",
  "lib/ruyi-translate-v1.schema.json",
  "lib/ruyi-runtime.cjs",
  "lib/service-configurations.cjs",
  "lib/storage-migrations.cjs",
  "lib/terminology.cjs",
  "lib/terminology-csv.cjs",
  "lib/text-limits.cjs",
  "lib/translation-protocol.cjs",
  "lib/translation-segmentation.cjs",
];
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".svg"]);
const builtins = new Set(
  builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name.slice(5) : `node:${name}`]),
);

function withinDist(path) {
  return path === distDirectory || path.startsWith(`${distDirectory}${sep}`);
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function manifestFile(manifest, field) {
  const value = manifest[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    isAbsolute(value) ||
    /^[a-z][a-z\d+.-]*:/iu.test(value) ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`plugin.json 的 ${field} 必须是包内相对路径。`);
  }
  const absolutePath = resolve(distDirectory, value);
  if (!withinDist(absolutePath)) {
    throw new Error(`plugin.json 的 ${field} 超出构建目录。`);
  }
  await access(absolutePath);
  return absolutePath;
}

await Promise.all(requiredFiles.map((file) => access(resolve(distDirectory, file))));

const indexHtml = await readFile(resolve(distDirectory, "index.html"), "utf8");
if (/(?:src|href)=["']\/(?!\/)/u.test(indexHtml)) {
  throw new Error("构建产物包含根路径资源，无法从 uTools 的本地文件入口加载。");
}

const manifest = JSON.parse(await readFile(resolve(distDirectory, "plugin.json"), "utf8"));
if (Object.hasOwn(manifest, "development")) {
  throw new Error("生产 plugin.json 仍包含 development 开发服务器配置。");
}
const mainPath = await manifestFile(manifest, "main");
const preloadPath = await manifestFile(manifest, "preload");
const logoPath = await manifestFile(manifest, "logo");
if (mainPath !== resolve(distDirectory, "index.html")) {
  throw new Error("plugin.json 的 main 必须指向构建后的 index.html。");
}
if (
  preloadPath !== resolve(distDirectory, "preload.js") ||
  logoPath !== resolve(distDirectory, "logo.svg")
) {
  throw new Error("plugin.json 必须引用包内的 preload.js 和 logo.svg。");
}
if (!Array.isArray(manifest.features)) {
  throw new Error("plugin.json 缺少 features。");
}
const featureCodes = manifest.features.map((feature) => feature?.code);
if (
  new Set(featureCodes).size !== featureCodes.length ||
  !featureCodes.includes("translate") ||
  !featureCodes.includes("settings")
) {
  throw new Error("plugin.json 必须包含唯一的 translate 和 settings 功能入口。");
}
const translateFeature = manifest.features.find((feature) => feature.code === "translate");
const settingsFeature = manifest.features.find((feature) => feature.code === "settings");
const overCommand = translateFeature?.cmds?.find((command) => command?.type === "over");
if (
  !translateFeature?.cmds?.includes("如意翻译") ||
  !translateFeature.cmds.includes("翻译") ||
  !translateFeature.cmds.includes("fy") ||
  overCommand?.label !== "用如意翻译" ||
  overCommand.minLength !== 1 ||
  overCommand.maxLength !== 10_000 ||
  !settingsFeature?.cmds?.includes("如意翻译设置")
) {
  throw new Error("plugin.json 的翻译、文本匹配或设置入口不完整。");
}

const allFiles = await filesUnder(distDirectory);
for (const filePath of allFiles) {
  const packagePath = relative(distDirectory, filePath).replaceAll("\\", "/");
  if (
    /(^|\/)(?:node_modules|coverage|__tests__|fixtures?|evaluation-cache|eval-cache|\.cache|\.vite)(?:\/|$)/iu.test(
      packagePath,
    ) ||
    /\.(?:key|log|map|pem)$/iu.test(packagePath)
  ) {
    throw new Error(`构建产物含不应发布的文件：${packagePath}`);
  }
  if (!textExtensions.has(extname(filePath).toLowerCase())) continue;
  const source = await readFile(filePath, "utf8");
  if (/sourceMappingURL/iu.test(source)) {
    throw new Error(`构建产物含源码映射引用：${packagePath}`);
  }
  if (
    /RUYI_MOCK_CREDENTIAL|ephemeral-test-value|secret source text|secret translated text|(?:^|[^a-z\d_-])sk-[a-z\d_-]{12,}/iu.test(
      source,
    )
  ) {
    throw new Error(`构建产物含测试密钥或敏感测试内容：${packagePath}`);
  }
  if (
    packagePath.startsWith("assets/") &&
    /window\.utools|navigator\.clipboard\s*\.\s*readText|clipboardchange|onClipboardChange|getCopyedText/iu.test(
      source,
    )
  ) {
    throw new Error(`页面构建产物越过命名业务接口访问宿主或剪贴板：${packagePath}`);
  }
}

const runtimeScripts = allFiles.filter(
  (filePath) => filePath === preloadPath || filePath.endsWith(".cjs"),
);
for (const filePath of runtimeScripts) {
  const packagePath = relative(distDirectory, filePath).replaceAll("\\", "/");
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/u);
  if (lines.length < 5 || Math.max(...lines.map((line) => line.length)) > 2_000) {
    throw new Error(`preload 或运行时模块不可读，疑似经过压缩或混淆：${packagePath}`);
  }
  if (/console\.(?:debug|info|log)|appendFile|createWriteStream|writeFile/u.test(source)) {
    throw new Error(`preload 或运行时模块含日志或文件写入路径：${packagePath}`);
  }
  for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/gu)) {
    const dependency = match[1];
    if (!dependency.startsWith(".")) {
      if (!builtins.has(dependency)) {
        throw new Error(`运行时模块依赖未随包发布的第三方模块：${dependency}`);
      }
      continue;
    }
    const dependencyPath = resolve(dirname(filePath), dependency);
    if (!withinDist(dependencyPath)) {
      throw new Error(`运行时模块引用了构建目录外文件：${packagePath}`);
    }
    await access(dependencyPath);
  }
}

process.stdout.write(
  `已检查 ${allFiles.length} 个构建文件：插件清单、相对资源、宿主边界、敏感内容和可读运行时模块均符合发布约束。\n`,
);
