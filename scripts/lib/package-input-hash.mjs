import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(absolutePath)));
    } else if (entry.isFile()) {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) throw new Error(`打包输入不能包含符号链接：${absolutePath}`);
      files.push(absolutePath);
    } else {
      throw new Error(`打包输入只能包含普通文件和目录：${absolutePath}`);
    }
  }
  return files;
}

export async function createPackageInputManifest(directory) {
  const entries = [];
  for (const filePath of (await filesUnder(directory)).sort()) {
    const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
    entries.push(`${digest}  ${relative(directory, filePath).replaceAll("\\", "/")}`);
  }
  if (entries.length === 0) throw new Error("打包输入目录不能为空。");
  return `${entries.join("\n")}\n`;
}

export async function hashPackageInput(directory) {
  return createHash("sha256")
    .update(await createPackageInputManifest(directory))
    .digest("hex");
}
