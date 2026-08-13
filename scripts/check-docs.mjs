import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const documents = {
  readme: "README.md",
  manual: "docs/user-manual.md",
  privacy: "docs/privacy.md",
  platforms: "docs/platform-acceptance.md",
  packaging: "artifacts/README.md",
};

await Promise.all(
  Object.values(documents).map((file) => access(resolve(projectRoot, file))),
);

const readme = await readFile(resolve(projectRoot, documents.readme), "utf8");
const manual = await readFile(resolve(projectRoot, documents.manual), "utf8");
const privacy = await readFile(resolve(projectRoot, documents.privacy), "utf8");
const platforms = await readFile(resolve(projectRoot, documents.platforms), "utf8");

for (const link of [documents.manual, documents.privacy, documents.platforms, documents.packaging]) {
  if (!readme.includes(link)) throw new Error(`README 缺少文档链接：${link}`);
}

for (const topic of [
  "安装与入口",
  "配置模型服务",
  "发起翻译",
  "首次发送确认",
  "当前翻译、后台运行和通知",
  "复制、粘贴和风险提示",
  "删除数据和恢复设置",
]) {
  if (!manual.includes(topic)) throw new Error(`用户手册缺少主题：${topic}`);
}

for (const topic of [
  "会发送到模型服务的数据",
  "本机保存的数据",
  "uTools 同步",
  "剪贴板、通知和后台运行",
  "删除和恢复的范围",
]) {
  if (!privacy.includes(topic)) throw new Error(`隐私说明缺少主题：${topic}`);
}

for (const platform of ["Windows", "macOS", "Linux"]) {
  if (!platforms.includes(`| ${platform} | 待执行`)) {
    throw new Error(`三平台验收记录没有如实标记 ${platform} 的待执行状态。`);
  }
}

process.stdout.write("用户手册、隐私说明、打包说明和三平台验收记录齐全。\n");
