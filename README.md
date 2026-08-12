# 如意翻译

如意翻译是一款正在开发的 uTools 文本翻译插件。用户明确提交文本后，插件使用用户自己的 AI 服务密钥生成译文，并在本地检查数字、链接、占位符、代码和 Markdown 等必须保留的内容。术语和语义审校会按仓库工单继续加入。

当前版本已经可以创建 DeepSeek Flash 默认配置、加密保存用户填写的 API Key，并在用户确认完整发送地址和数据范围后，通过 Chat Completions 或 Responses 完成标准全文翻译。完成后会显示具体结构风险；确定性严重风险会阻止直接粘贴，用户确认后仍可复制。已确认文档：

- [第一版产品与技术规格](docs/specs/ruyi-translate-v1.md)
- [第一版提示词契约](docs/prompts/ruyi-translate-v1.md)
- [可执行 JSON Schema](docs/prompts/ruyi-translate-v1.schema.json)
- [第一版质量评测方案](docs/quality/ruyi-translate-v1-evaluation.md)
- [ADR-0001：客户端使用用户密钥直连模型服务](docs/adr/0001-client-direct-model-access.md)
- [领域术语](CONTEXT.md)

项目使用 React、TypeScript、Vite 和 npm 开发。第一版计划支持 DeepSeek 官方渠道，以及用户配置的 Chat Completions 或 Responses 完整接口地址。

## 本地开发

```bash
npm install
npm run dev
```

在 uTools 开发者工具中选择 `public/plugin.json` 接入开发。第一次翻译时，页面会要求填写 DeepSeek API Key；已保存的密钥不会回填到页面，只显示掩码和末尾四位。插件不会主动读取、监听或轮询剪贴板。

## 数据与密钥说明

插件使用用户填写的 API Key 从本机直接访问所选模型服务，源文本和翻译资料会离开本机并发送到确认窗口显示的完整地址。API Key 通过 uTools 的 `dbCryptoStorage` 加密保存，但客户端直连无法保证密钥绝对不可提取：本机高权限程序、调试工具或被篡改的运行环境仍可能读取它。若用户开启 uTools 数据同步，加密数据也可能由 uTools 备份到服务端或同步到其他设备；uTools 官方没有承诺 `dbCryptoStorage` 一定排除在同步之外。

当前源文与译文只保留在插件进程内，不写入翻译历史、运行日志或遥测。进程结束后无法恢复。模型服务如何保存或使用请求内容由对应服务的条款决定，不受插件控制。

生产构建运行 `npm run build`，测试运行 `npm test`。测试会自动启动受控的本地 DeepSeek 兼容模拟服务，不需要真实 API Key，也不会访问真实模型服务；`npm run check:no-clipboard` 会单独检查实现代码中是否出现剪贴板读取、监听或定时轮询。

## License

[MIT](LICENSE)
