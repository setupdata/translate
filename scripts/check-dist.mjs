import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const distDirectory = resolve(projectRoot, "dist");
const requiredFiles = [
  "index.html",
  "plugin.json",
  "preload.js",
  "logo.svg",
  "lib/node-chat-transport.cjs",
  "lib/chat-sse-parser.cjs",
  "lib/prompts.cjs",
  "lib/quality-checks.cjs",
  "lib/reference-translations.cjs",
  "lib/responses-parser.cjs",
  "lib/ruyi-runtime.cjs",
  "lib/service-configurations.cjs",
  "lib/terminology.cjs",
  "lib/terminology-csv.cjs",
  "lib/text-limits.cjs",
  "lib/translation-protocol.cjs",
];

await Promise.all(requiredFiles.map((file) => access(resolve(distDirectory, file))));

const indexHtml = await readFile(resolve(distDirectory, "index.html"), "utf8");
const rootRelativeAsset = /(?:src|href)=["']\/(?!\/)/;

if (rootRelativeAsset.test(indexHtml)) {
  throw new Error("构建产物包含根路径资源，无法从 uTools 的本地文件入口加载。");
}

process.stdout.write("构建产物包含完整插件文件，页面资源使用相对路径。\n");
