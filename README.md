# NoteCalc 0.3.2

以 Markdown 为主的计算笔记。直接编辑正文中的名称、数字、单位和算式，插件只在行旁显示结果与错误。默认没有计算侧栏、滑块、名称表单或输入分类。

## 像普通笔记一样使用

```markdown
<!-- notecalc id=quote -->

## 报价

- 单价：`2000 元/单`
- 单量：`80 单`
- **收入**：`单价 * 单量`

<!-- /notecalc -->
```

收入旁会显示 `→ 160,000 元`，源文件仍只保存上述 Markdown。标题、说明文字与普通列表可以自由混排。只解析标记区域内的“名称：行内代码”列表；其他笔记不会自动变成计算式。名称粗体只是选择重点输出的语法糖。

使用命令 **NoteCalc：插入 Markdown 计算笔记** 创建完整收益示例。示例文件见 `examples/Markdown交付收益测算.md`。源代码模式、Live Preview 和阅读模式都支持被动结果提示；不需要打开侧栏。

代码块也继续支持，可以统一使用等号：

```notecalc
长 = 200 cm
宽 = 3 m
面积 = 长 * 宽
```

右侧是数值字面量时作为输入，其他内容作为算式。原来的 `:=`、`// @model`、`@input`、`@unit` 和 `@output` 继续兼容。`@input` 现在用于校验，不再生成控件。没有 ID 时自动提供位置标识；Agent 长期操作的区域建议显式写 ID，插入模板会生成唯一 ID。

修改名称后需保持算式引用一致；全文查找替换或 Agent 的结构化 rename 都可以同步改名。直接将 `200 cm` 写成 `200 m` 表示改变物理量；保持同一物理量请改为 `2 m`，或让 Agent preview 单位换算。未完成算式和类型错误只标记错误行及其依赖；其他行显示基于当前文本的新结果，绝不沿用错误行的旧值。结果右对齐，宽度不足自动换行。撤销沿用 Markdown 编辑器的正常历史。

## 量纲和 Agent

单位由数值和算式推导。支持同类换算、复合单位、人数/订单等业务计数、金额、数据量、温度与温差。不同类型不能相加；币种不自动换汇，月不自动按固定天数换算。详见 [量纲系统说明.md](量纲系统说明.md)。

Agent 通过官方 CLI 连接同一个活跃运行时，默认只读。inspect 默认读取当前正文；preview 可比较多个候选，既不修改正文，也不切换人正在编辑的内容。通过命令 **查看 Agent 候选修改** 检查差异并应用，或者使用已有的限定输入授权。仅批准候选需要简短的宿主确认界面；普通计算不依赖它。旧版本候选不会覆盖新编辑。计算策略为 34 位有效数字、HALF_EVEN。

人可计算任意本地笔记中的标记区域；Agent 默认访问范围仍为 `NoteCalc/`，可在设置中明确调整。没有额外授予写入权限。派生结果不持久化，候选与回执只保留在本次会话。官方 CLI 连接失败不会伪装成离线共享运行时。

## 接入其他 Markdown 工具

`dist/notecalc-core.mjs` 是独立 ESM 内核，没有 Obsidian、CodeMirror、DOM 或 Node 依赖。提供 Markdown 解析、量纲计算、纯数据反馈、定点补丁接口。另一个工具只需提供文本读取、结果显示和带版本检查的写入适配，不需要复刻计算 UI。

```js
import {calculateMarkdown} from './dist/notecalc-core.mjs';
const calculations = calculateMarkdown(markdownText);
// calculations: {model, result, feedback}[]
// feedback: {line, name?, text, detail, valid}[]
```

可明确离线执行 `node tools/calculate.mjs 文件.md`，结果标注 `sharedRuntime:false`。这是文件计算和宿主集成工具，不是 Skill 连接失败时的替代路径。接口及移植范围见 [Markdown优先与宿主接入.md](Markdown优先与宿主接入.md)。

## 安装和开发

把插件 ZIP 中的 `notecalc/` 放入 `<Vault>/.obsidian/plugins/`，重新加载并启用。当前实测 macOS、Obsidian 1.13.7，最低声明 API 1.12.2；移动端和其他 Markdown 工具的插件适配尚未实装。

构建使用 Node 20+：`npm ci` → `npm run build` → `npm run typecheck` → `npm test`。构建生成宿主插件及独立内核。`node tools/install.mjs /绝对/Vault/路径` 只安装插件并备份现有插件，不启用插件或改写笔记。

源码内 `skill/note-calc/` 包含完整 Skill 与官方 CLI 包装器。可按 Agent 宿主要求安装此目录。实际运行数据与验证边界见 [交付与验收.md](交付与验收.md)。

本次代码审查与修复记录见 [代码审查与接入建议.md](代码审查与接入建议.md)。浏览器 Worker 接入示例在 integrations/，SDK 尚未发布到 npm。

0.3.2 的局部错误、右对齐与窄宽度换行验收见 [局部错误与排版优化-0.3.2.md](局部错误与排版优化-0.3.2.md)。

## Git 仓库

仓库只跟踪源码、依赖锁定文件、测试、样例和说明。构建产物、插件备份、实际宿主截图与会话记录仅保留在本地，历史报告中的原始证据不随仓库发布。首次克隆后运行 `npm ci` 和 `npm run build`，即可生成插件 `main.js` 与独立内核。
