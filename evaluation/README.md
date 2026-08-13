# 如意翻译评测资产

这里存放只用于开发和发布判定的评测格式、共享用例与报告。插件运行时不会读取或写入本目录，构建检查也会拒绝把其中的用例、报告、加载器或缓存带进 `dist` 和 UPXS 暂存目录。

`cases/synthetic-smoke.jsonl` 只验证 `evaluation-case.v1` 入口，不计入冻结核心集。可提交到版本库的用例只能使用 `synthetic` 或 `public-licensed`；`authorized-private` 数据、真实模型原始输出和本地缓存不得提交。

`reports/baseline-v1.pending.json` 如实记录当前缺失的证据。运行 `npm run check:evaluation` 会验证共享用例和报告，并打印当前门槛状态；运行 `npm run check:release` 会在状态不是 `pass` 时返回失败，只有证据先达到门槛，才会对当前候选重新执行完整测试和生产构建。两条命令都不会调用模型服务。受控环境中的本地文件可通过 `--cases <JSONL>`、`--report <JSON>` 和 `--evidence <JSON>` 传入。严格发布检查不会只相信报告里的计数或“通过”布尔值：证据清单必须绑定最终报告、实际用例文件、候选版本和 Git commit，并为每条自动检查、模型输出、配对、人工评审、修订、并发、性能和三平台记录绑定一个独立原始附件。检查器会读取附件并核对字节数和 SHA-256，禁止重复用例、重复样本、模式与请求指纹矛盾。三平台记录还必须引用同一个 UPXS 候选文件、同一个构建输入清单哈希，并明确记录该文件已由对应平台的 uTools 安装。若文件含 `authorized-private` 数据，还必须显式添加 `--allow-authorized-private`。这些路径已被 Git 忽略，不得把未经授权的源文或原始模型输出加入版本库。

完整语料规模、人工评价、性能统计和门槛定义以 [`docs/quality/ruyi-translate-v1-evaluation.md`](../docs/quality/ruyi-translate-v1-evaluation.md) 为准。真实请求只能由开发者在受控环境中手动执行，任何 `pass` 结论都必须由可审计证据支持。

证据清单使用 `evaluation-evidence-manifest.v1`，每个证据文件使用一行一个 `evaluation-evidence-record.v1` 对象。清单固定包含自动检查、模型输出、配对条件、人工评审、修订、并发、性能以及 Windows、macOS、Linux 三份平台记录，并绑定候选 commit、报告、用例文件、构建输入清单、记录文件和原始附件的 SHA-256。模型、配对、并发和性能记录必须带可重新计算的请求指纹条件；人工评审要绑定具体模型输出，独立评审标签、一致率、Cohen's kappa 和裁决结果由检查器重算；性能与并发样本的条件、时段和序号必须唯一。证据记录不得内嵌源文、译文、术语、参考译例、密钥或未经清理的错误对象；确需保留的受控原始资料只放在未提交的附件中。UPXS 是 uTools 生成的专有签名包，仓库检查器不会自行解析或伪造其签名；签名是否被 uTools 接受，以三个平台的实际安装记录为准。检查器能核实文件字节、构建输入和记录之间的一致性，不能替代测试人对实机观察真实性的负责。
