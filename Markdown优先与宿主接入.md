# Markdown 优先与宿主接入

0.3.2 将普通编辑操作全部交回 Markdown 编辑器。数据、名称、单位、算式和约束都保存于正文；没有依赖控件才能修改的字段，也没有隐藏的第二份输入。

## 两种文本表达

默认是 HTML 注释标记区域，内部使用标准 Markdown 标题、段落、列表、行内代码：

```markdown
<!-- notecalc id=budget -->
## 场地预算
租用两天，以下不包含税费。
- 日租：`1500 元/天`
- 天数：`2 天`
- **费用**：`日租 * 天数`
<!-- /notecalc -->
```

结果费用 3,000 元。`-`、`+`、`*` 列表标记，英文或中文冒号均可使用。名称为中文、字母、下划线及后续数字；暂不支持名称内的空格。粗体名称将其列为重点输出。普通说明不执行，模型外的列表不执行，其他代码围栏内的样例不执行。每个区域互不共享名称。

可选元信息依然是 Markdown 注释：

```markdown
<!-- notecalc:input 日租 min=1000 max=3000 step=100 -->
<!-- notecalc:unit 费用 "万元" -->
```

约束验证人直接编辑的数值与 Agent 候选；不会生成滑块。unit 为兼容量纲的显示换算；给裸数首次声明单位会定义其类型。结果单位通常自动推导，无需元信息。

代码块更适合连续写算式：

```notecalc
长 = 200 cm
宽 = 3 m
面积 = 长 * 宽
```

统一等号即可。数值字面量是输入，算式自动识别为公式。`:=` 可继续显式表示公式。两种形式解析为同一个模型，同一计算引擎、同一命令服务。

ID 可省略，此时采用按计算区域次序生成的 `note-N` 或 `block-N`。增加普通说明不影响它，增加/删除前面的计算区域会改变它；这类定位只能与当前 sourceRevision 一起使用。长期 Agent 目标使用显式 ID。重复 ID 会报错，陈旧版本提交仍被拒绝。

## 编辑和反馈

直接编辑文本立即重算，用正常撤销恢复。插件结果是只读装饰，既不替换原式，也不追加到文件中。源模式和 Live Preview 的复制、选择与保存针对真实文档。阅读模式保留原列表或原代码，并附带结果。

重命名是普通文本操作；定义与引用需同时改动。结构化 rename 可以精确更新标识引用、粗体名称与指令，不触碰说明中的同名文字。单位数值可以直接改；源文本改为 200 m 就明确代表 200 m。结构化 set_unit 则保留物理量，换算输入和约束。

结果错误有行号、变量和类型；不把上次有效结果当作当前值。Agent preview 只计算候选。人继续看到正文结果；通过命令查看候选并决定是否应用。不存在默认“当前方案”控件。普通用户无需理解方案或运行时标识。

## 内核与宿主边界

| 层 | 职责 | 依赖 |
|---|---|---|
| document.ts | 两种 Markdown 格式、源范围、名称与指令 | 纯文本和受限单位语法 |
| engine.ts / units.ts | 依赖、量纲、十进制、诊断、定点补丁 | decimal.js |
| feedback.ts | 行号与显示文字 | 计算数据 |
| runtime.ts | 源版本、共享快照、候选、授权和提交队列 | 文档/求值适配器，当前使用 Node 哈希 |
| Obsidian 适配 | 最新缓冲区、编辑事务、文件保存、行旁显示、官方 CLI | Obsidian / CodeMirror |

`dist/notecalc-core.mjs` 打包前三层，能在其他宿主使用；其 patchModel 返回 source 和 patches，不自行写文件。调用者负责校验当前版本和应用补丁。结果错误时不得套用候选。

```js
import {models, evaluate, patchModel, feedback} from './dist/notecalc-core.mjs';
const model = models(source)[0];
const result = evaluate(model);
const annotations = feedback(model, result);
const candidate = patchModel(source, model, [
  {op: 'set_input', name: '日租', literal: '2000 元/天'}
]);
```

数据接口使用规范基单位 values、带量纲 quantities、显示单位 units、含单位 displayValues。显示优先使用 displayValues。反馈 records 的 line 为 1 起始原文行号。可用 calculateMarkdown 一次读取所有区域。

移植只读插件可直接将文本交给内核并显示反馈。移植完整 Agent 协作还需要宿主提供最新编辑缓冲区、版本校验、权限与事务式应用，并接入共享命令服务；独立内核不能代替这些保护。当前没有为另一款编辑器编写插件，也没有把 Obsidian 的桌面限制宣称为已消除。

## 从 0.2.0 升级

旧 Markdown 代码块继续计算。插件关闭旧 notecalc-panel，不再注册侧栏和滑块；不是将重 UI 藏在设置中。新模板优先生成普通 Markdown 列表。旧笔记不自动转换或改写；直接保留旧格式，或建立新的 Markdown 样例。现有量纲规则、源版本、默认只读、撤销和回执保护继续有效。

0.3.2 按依赖隔离错误：result.values 只包含本次成功计算的变量；nodeStates 标记 valid、incomplete、error 或 blocked。模型整体 status 仍报告错误，不能因此清空全部 feedback。结果和错误在三种视图右对齐，行空间不足自动折到下方；Agent 自动提交仍要求模型整体验证通过。
