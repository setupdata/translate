import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

import { createPackageInputManifest } from "./lib/package-input-hash.mjs";

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

await mkdir(stagingRoot, { recursive: true });
await rm(stagingDirectory, { recursive: true, force: true });
await cp(distDirectory, stagingDirectory, { recursive: true });

const packageInputManifest = await createPackageInputManifest(stagingDirectory);
await writeFile(
  resolve(stagingRoot, `ruyi-translate-${packageJson.version}.sha256.txt`),
  packageInputManifest,
  "utf8",
);
const buildInputSha256 = createHash("sha256").update(packageInputManifest).digest("hex");

process.stdout.write(
  [
    `已准备待打包目录：${stagingDirectory}`,
    `构建输入清单 SHA-256：${buildInputSha256}`,
    "请在 uTools 开发者工具中选择该目录的 plugin.json，再使用“打包”生成签名 UPXS。",
    "此脚本不会把 ZIP 文件改名冒充 UPXS。",
  ].join("\n") + "\n",
);
