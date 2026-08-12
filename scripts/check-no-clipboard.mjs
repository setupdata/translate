import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const TARGETS = [resolve(PROJECT_ROOT, "src"), resolve(PROJECT_ROOT, "public/preload.js")];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const FORBIDDEN = [
  { label: "浏览器剪贴板读取", pattern: /navigator\s*\.\s*clipboard\s*\.\s*read(?:Text)?\s*\(/ },
  { label: "Electron 剪贴板读取", pattern: /clipboard\s*\.\s*read(?:Text|HTML|Image|RTF|Bookmark)?\s*\(/ },
  { label: "uTools 剪贴板文件读取", pattern: /getCopyedFiles\s*\(/ },
  { label: "剪贴板变化监听", pattern: /(?:onClipboardChange|clipboardchange)/ },
  { label: "定时轮询", pattern: /setInterval\s*\(/ },
];

async function collectFiles(target) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) {
    return [target];
  }

  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(target, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(path);
      }
      return [path];
    }),
  );
  return nested.flat();
}

const files = (await Promise.all(TARGETS.map(collectFiles)))
  .flat()
  .filter((file) => SOURCE_EXTENSIONS.has(extname(file)))
  .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));

const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(source)) {
      violations.push(`${relative(PROJECT_ROOT, file)}：${rule.label}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`发现禁止的剪贴板读取、监听或轮询：\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`已检查 ${files.length} 个实现文件，未发现剪贴板读取、监听或轮询。\n`);
}
