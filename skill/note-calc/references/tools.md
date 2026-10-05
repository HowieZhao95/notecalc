# 工具协议 2

调用：`node scripts/request.mjs capabilities '{}' 'Vault名称'`。第三参数可省略，使用 Obsidian 当前 Vault；多 Vault 环境应显式指定。JSON 可传 `@绝对路径` 或 `-` 从标准输入读取。包装器只转发官方 CLI，不包含离线引擎。

统一响应为 `{ "ok": true, "result": ... }` 或 `{ "ok": false, "error": { "code": ..., "message": ... } }`，包装器失败退出非零。

target 形如 `{ "vaultId": "capabilities返回值", "path": "NoteCalc/收益测算.md", "modelId": "training-delivery" }`。

- list_models：`{}`，仅搜索已授权目录。
- inspect：`{ "target": target }`，可另加 viewId 或 scenarioId，返回源版本、快照、模型、数值、诊断及保存状态。
- preview：`{ "target": target, "sessionId": inspect.sessionId, "sourceRevision": inspect.sourceRevision, "baseSnapshotId": inspect.snapshotId, "changes": [{ "op": "set_input", "name": "每单单价", "literal": "2500" }] }`。公式修改使用 `{ "op": "set_formula", "name": "结余", "expression": "单价-成本" }`。
- commit：`{ "sessionId": preview.sessionId, "previewId": preview.previewId, "previewDigest": preview.previewDigest, "requestId": "新的唯一标识" }`。完全相同的提交可重试同一 requestId；不要用它提交不同候选。
- explain：`{ "target": target, "name": "每单结余", "scenarioId": preview.scenarioId }`，返回公式及依赖的实际数值。
- discard：`{ "previewId": preview.previewId }` 或 scenarioId。
- export：与 inspect 参数相同，增加生成时间。
- receipts：`{}`，最近至多 100 项本地会话记录，保存状态重新观察。

比较 1500、2000、2500：先 inspect 一次，然后用同一基准创建三项 preview。输入包含行内单位而没有 @unit 声明时，literal 保留其单位，如 "2500 元/单"。展示三个 preview.snapshot.displayValues；机器比较使用 values 和 quantities.dimension。候选可用命令“查看 Agent 候选修改”检查；正文视图继续显示源文本结果。最多保留 200 个候选，插件重启后全部失效。

所有规范数值是十进制字符串；显示可以分组。输入请求采用目标显示单位的字面量，不能将规范基单位值直接填进不同单位的输入。引擎配置在 snapshot.policy 中。

preview 还支持 `{ "op": "rename", "name": "每单单价", "newName": "售价" }` 和 `{ "op": "set_unit", "name": "每单单价", "unit": "元/单" }`。同一批改名和改值、单位时，name 都使用基准原名；所有引用、控件、输出与单位关联会同步更新。改名和单位修改需要界面批准，不能借用限定输入数值授权。模型含 format（markdown/block）、identity（explicit/position）、源范围和节点名称范围。位置 ID 必须绑定当前 sourceRevision；长期操作优先显式 ID。inspect.model.units 是源中显式声明；推导后显示单位在 inspect.units 中。

协议 2：snapshot.values 和 snapshot.quantities.baseValue 始终采用规范基单位（m、kg、s、元等）十进制值；snapshot.units 是每个变量的显示单位，snapshot.displayValues 是引擎给出的含单位显示字符串。展示结果优先用 displayValues，不要直接把 values 与显示单位拼接。例如源 200 cm 的 values 是 "2"，displayValues 是 "200 cm"。explain 也返回 display、unit、quantity。

set_unit 不再是自由文字标签：同量纲单位转换，类型冲突被拒绝。set_input.literal 可以含单位；限定输入授权不会授权改变原有量纲。候选失败返回 error.details.diagnostics，其中可含 variable、line、expected/actual；报告明确错误，不补算一个数值。
