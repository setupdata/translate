import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
);
const distDirectory = resolve(projectRoot, "dist");
const stagingRoot = resolve(projectRoot, "artifacts", "upxs-input");
const stagingDirectory = resolve(
  stagingRoot,
  `ruyi-translate-${packageJson.version}`,
);

if (!stagingDirectory.startsWith(`${stagingRoot}${sep}`)) {
  throw new Error("UPXS 待打包目录超出允许范围。");
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

await mkdir(stagingRoot, { recursive: true });
await rm(stagingDirectory, { recursive: true, force: true });
await cp(distDirectory, stagingDirectory, { recursive: true });

const hashes = [];
for (const filePath of (await filesUnder(stagingDirectory)).sort()) {
  const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
  hashes.push(`${digest}  ${relative(stagingDirectory, filePath).replaceAll("\\", "/")}`);
}
await writeFile(
  resolve(stagingRoot, `ruyi-translate-${packageJson.version}.sha256.txt`),
  `${hashes.join("\n")}\n`,
  "utf8",
);

process.stdout.write(
  [
    `已准备待打包目录：${stagingDirectory}`,
    "请在 uTools 开发者工具中选择该目录的 plugin.json，再使用“打包”生成签名 UPXS。",
    "此脚本不会把 ZIP 文件改名冒充 UPXS。",
  ].join("\n") + "\n",
);
