import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "dist", "plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

delete manifest.development;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write("生产插件清单已移除开发服务器地址。\n");
