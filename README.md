# 如意翻译

如意翻译是一款规划中的 uTools 文本翻译插件。用户明确提交文本后，插件使用用户选择的 AI 服务生成译文，并提供术语、结构和准确性风险检查。

仓库已经具备可运行的第一版插件骨架，当前翻译请求接到受控本地模拟服务；真实 AI 服务配置将在后续工单中实现。已确认文档：

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
npm run mock
```

另开一个终端运行：

```bash
npm run dev
```

在 uTools 开发者工具中选择 `public/plugin.json` 接入开发。生产构建运行 `npm run build`，测试运行 `npm test`；`npm run check:no-clipboard` 会检查实现代码中是否出现剪贴板读取、监听或定时轮询。

## License

[MIT](LICENSE)
