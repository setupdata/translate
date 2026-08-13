# 本地 UPXS 打包

仓库不会自行生成或伪造 UPXS。uTools 的离线包包含开发者信息和签名，需要由 uTools 开发者工具生成。

先在项目根目录运行：

```bash
npm run prepare:upxs
```

脚本会完成生产构建和发布检查，移除 `plugin.json` 中的开发服务器地址，然后把待打包目录放到：

```text
artifacts/upxs-input/ruyi-translate-<version>/
```

在 uTools 开发者工具中选择该目录里的 `plugin.json`，点击“打包”，填写与本次测试记录一致的语义化版本号，再把生成的 `.upxs` 文件保存到 `artifacts/` 或其他受控目录。对应的 SHA-256 文件清单位于 `artifacts/upxs-input/`，可用于核对打包输入。

不要选择项目根目录或 `public/` 打包，也不要把 ZIP 文件改名成 `.upxs`。生成的 UPXS 和待打包目录默认不提交到 Git；实机验收时应在 [三平台验收记录](../docs/platform-acceptance.md) 中填写包路径、SHA-256、测试人、时间和结果。

相关 uTools 官方说明：

- [离线插件与 UPXS 打包](https://www.u-tools.cn/docs/developer/basic/offline-plugin.html)
- [插件目录结构](https://www.u-tools.cn/docs/developer/information/file-structure.html)
- [plugin.json](https://www.u-tools.cn/docs/developer/information/plugin-json.html)
- [preload.js](https://www.u-tools.cn/docs/developer/information/preload-js/preload-js.html)
