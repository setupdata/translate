# 本地 UPXS 打包

仓库不会自行生成或伪造 UPXS。uTools 的离线包包含开发者信息和签名，需要由 uTools 开发者工具生成。

先在项目根目录运行：

```bash
npm run prepare:upxs
```

脚本会完成生产构建和产物边界检查，移除 `plugin.json` 中的开发服务器地址，然后把开发测试用的待打包目录放到：

```text
artifacts/upxs-input/ruyi-translate-<version>/
```

在 uTools 开发者工具中选择该目录里的 `plugin.json`，点击“打包”，填写与本次测试记录一致的语义化版本号，再把生成的 `.upxs` 文件保存到 `artifacts/` 或其他受控目录。对应的 SHA-256 文件清单位于 `artifacts/upxs-input/`，脚本还会打印整份构建输入清单的 SHA-256，实机记录和评测证据都要保存这个值。该命令用于 #14 的本地实机测试，不表示质量基线或市场发布门槛已经通过。

正式发布候选必须使用：

```bash
npm run prepare:release-upxs -- --cases <冻结语料.jsonl> --report <baseline-v1.json> --evidence <证据清单.json>
```

该命令先核对报告、实际用例、记录文件及其原始附件，并要求三平台记录绑定同一个按候选版本命名的 UPXS、同一个构建输入清单哈希，以及 uTools 实际安装该包的记录。证据达到门槛后，它会重新运行当前候选的完整测试和生产构建，并重新计算 `dist` 的构建输入哈希；任一附件、样本、门槛或候选构建不合格时，都不会生成新的发布候选暂存目录。仓库不会自行解析 uTools 的专有签名格式，包是否被接受必须由各平台的 uTools 安装结果证明。

不要选择项目根目录或 `public/` 打包，也不要把 ZIP 文件改名成 `.upxs`。生成的 UPXS 和待打包目录默认不提交到 Git；实机验收时应在 [三平台验收记录](../docs/platform-acceptance.md) 中填写包路径、SHA-256、测试人、时间和结果。

相关 uTools 官方说明：

- [离线插件与 UPXS 打包](https://www.u-tools.cn/docs/developer/basic/offline-plugin.html)
- [插件目录结构](https://www.u-tools.cn/docs/developer/information/file-structure.html)
- [plugin.json](https://www.u-tools.cn/docs/developer/information/plugin-json.html)
- [preload.js](https://www.u-tools.cn/docs/developer/information/preload-js/preload-js.html)
