# NoteCalc

[![CI](https://github.com/HowieZhao95/notecalc/actions/workflows/ci.yml/badge.svg)](https://github.com/HowieZhao95/notecalc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/HowieZhao95/notecalc?include_prereleases)](https://github.com/HowieZhao95/notecalc/releases)

**在 Markdown 中写数字、单位和算式，在原行旁查看结果。**

NoteCalc 是以普通笔记编辑为主的量纲计算器，提供 Obsidian 桌面插件与可移植的 JavaScript 内核。无需登录、联网计算或配置 AI API Key；可选 Agent 接口连接插件的同一个运行时。

*A Markdown-first calculator with dimensional units, an Obsidian desktop plugin, and a portable JavaScript engine. Edit plain text; results remain passive annotations.*

当前版本 **0.3.2 Beta**。已在 macOS、Obsidian 1.13.7 实测；其他桌面系统与第三方主题欢迎反馈。暂不支持移动端，尚未上架 Obsidian 社区插件目录。

## 快速开始

安装并启用插件后，在笔记中写：

```markdown
<!-- notecalc id=quote -->

## 报价

- 单价：`2000 元/单`
- 单量：`80 单`
- **收入**：`单价 * 单量`

<!-- /notecalc -->
```

收入行旁显示 **→ 160,000 元**。把单价改成 `2500 元/单`，收入更新为 **200,000 元**。结果右对齐，空间不足换到下一行；计算结果不会写入正文。

也可打开命令面板，运行 **NoteCalc：插入 Markdown 计算笔记**。完整示例见 [Markdown 交付收益测算](examples/Markdown交付收益测算.md)。

## 安装与升级

1. 打开 [Releases](https://github.com/HowieZhao95/notecalc/releases)，下载 `notecalc-0.3.2.zip`。
2. 解压，把 `notecalc` 文件夹放入笔记库的 `.obsidian/plugins/`。最终路径应为 `<Vault>/.obsidian/plugins/notecalc/main.js`，避免多套一层目录。
3. 重启 Obsidian，在 **设置 → 第三方插件** 中启用 **NoteCalc**。
4. 新建测试笔记，粘贴上面的示例。

升级前备份原插件文件，用新包替换 `notecalc/` 内的发布文件，保留已有的 `data.json` 设置文件，再重新加载。也可单独下载 Release 中的 `main.js`、`manifest.json` 和 `styles.css`，并保留许可与第三方声明文件。

插件声明最低 Obsidian API **1.12.2**，最低版本尚未完成独立设备验收。普通计算不需要开启 Obsidian CLI。

## 笔记语法

- 列表计算必须放在 `<!-- notecalc id=... -->` 与 `<!-- /notecalc -->` 之间。
- 计算行使用 `- 名称：行内代码`，英文冒号也支持；标题、说明和普通列表可自由混排。
- 名称可用中文、字母、下划线及后续数字，不含空格。改名时同步修改引用它的算式。
- 名称加粗用于选择重点输出，普通公式也会显示结果。
- ID 可省略；长期由 Agent 定位的区域建议使用唯一 ID。不同区域的变量互不共享。
- 支持四则运算、括号、`×`、`÷`、`min`、`max`、`abs`、`round`，允许引用后面定义的变量。

代码块也可独立生效，无需再用 HTML 注释包围：

```notecalc
长 = 200 cm
宽 = 3 m
面积 = 长 * 宽
```

面积得到 **6 m²**。统一使用等号，数值和算式根据右侧内容识别；旧写法 `:=` 及 `// @model` 等指令继续兼容。完整规则见 [格式说明](skill/note-calc/references/format.md)。

### 单位与类型错误

单位由内容与运算推导，不根据变量名猜币种或类型。支持长度、面积、质量、时间、速度、金额、人数、订单、数据量，以及温度和温差等常见量纲。

- `1 m + 20 cm` 可以计算，长度与时间不能相加。
- 单价 `元/单` 乘订单 `单` 得到 `元`。
- 币种间没有隐式汇率，月和年不自动换成固定天数。
- 直接把 `200 cm` 改成 `200 m` 会改变实际数量；保持原量应改为 `2 m`。

一行错误只影响该行及其依赖，无关行继续显示当前结果。未定义、除零、循环、重复名称和类型不匹配都有诊断，不用旧结果冒充当前值。计算区域边界未闭合等结构错误使对应区域失效。

计算采用 34 位有效数字和 HALF_EVEN 舍入。显示格式不改变下游内部值，显式 `round()` 才改变计算值。详见 [量纲系统说明](量纲系统说明.md)。

## 编辑与 Agent 协作

日常使用直接修改 Markdown，没有必需的计算侧栏、滑块或参数表单。源码模式、Live Preview 和阅读模式提供被动结果提示，撤销沿用编辑器历史。关闭插件后笔记仍可阅读。

Agent 是可选能力：启用 Obsidian 官方 CLI，按 Agent 宿主要求安装 [note-calc Skill](skill/note-calc/)，再查询运行时：

```sh
node skill/note-calc/scripts/request.mjs capabilities '{}' '你的笔记库名称'
```

Agent 通过 `inspect` 读取、`preview` 试算，经过界面批准或已有的限定输入授权后 `commit`。默认只读，访问范围为 `NoteCalc/`；人在笔记中计算不受此目录限制。

候选不会自动改正文或切换正在看的内容。源版本变化时拒绝旧提交，连接失败明确报错。正文和注释不能授予权限。插件权限检查无法约束已拥有任意文件写入或 shell 权限的外部进程。详见 [工具说明](skill/note-calc/references/tools.md) 和 [安全边界](skill/note-calc/references/safety.md)。

## 接入自己的 Markdown 应用

从 Release 下载 `notecalc-core-0.3.2.zip`，或从源码构建 `dist/notecalc-core.mjs`。内核不依赖 Obsidian、CodeMirror、DOM 或 Node，可在支持 ES2022 的浏览器和 JavaScript 环境中运行：

```js
import { calculateMarkdown } from './notecalc-core.mjs';

for (const { result, feedback } of calculateMarkdown(markdownText)) {
  // feedback: { line, name?, text, detail, valid }[]
  // 按行显示反馈，不修改 markdownText。
  // result.nodeStates: valid / incomplete / error / blocked。
}
```

接入方负责读取最新文本、处理编辑事件、显示行反馈。耗时计算建议放 Worker，只接受最新版本的响应。参考 [浏览器示例](integrations/browser-example.html) 与 [宿主接入说明](Markdown优先与宿主接入.md)。

内核能复用，不代表其他编辑器可以直接安装 Obsidian 插件。尚未发布 npm 包或其他编辑器的现成插件，完整 Agent 共享运行时仍需宿主适配。

也可明确执行离线文件计算：

```sh
node tools/calculate.mjs examples/Markdown交付收益测算.md
```

输出标记 `sharedRuntime:false`，与活跃 Obsidian 会话区别开。

## 开发

需要 Node.js **20+** 和 npm；制作 ZIP 另需 Python **3.9+**。

```sh
git clone https://github.com/HowieZhao95/notecalc.git
cd notecalc
npm ci
npm run typecheck
npm test
```

`npm test` 自动先构建，再运行回归测试；也可单独运行 `npm run build`。构建生成 `main.js`、源码映射与 `dist/notecalc-core.mjs`。安装到专用测试笔记库：

```sh
node tools/install.mjs /绝对路径/测试笔记库
```

脚本备份已有插件并安装发布文件，不自动启用插件或改写笔记。构建和离线测试可独立运行；真实 Obsidian 验收需要桌面宿主和 CLI，部分脚本保留历史版本前提。

| 目录 | 内容 |
| --- | --- |
| `src/` | 解析、量纲、计算、共享运行时与宿主适配 |
| `tests/` | 自动回归测试 |
| `examples/` | 普通 Markdown 样例 |
| `integrations/` | 浏览器 Worker 接入示例 |
| `skill/note-calc/` | 可选 Agent Skill 与 CLI 包装器 |
| `tools/` | 安装、打包与宿主验收辅助工具 |

CI 自动进行依赖安装、类型检查、测试、构建和打包。[贡献指南](CONTRIBUTING.md) 说明提交与验证方式，发布过程见 [发布指南](docs/releasing.md)。

## 当前验证与限制

0.3.2 已通过 **107 项自动测试**，并在真实 Obsidian 中验证局部错误、三种视图宽窄排版、输入与撤销。完整记录见 [0.3.2 验收报告](局部错误与排版优化-0.3.2.md) 和 [代码审查](代码审查与接入建议.md)。原始宿主截图、会话快照与插件备份不进入公开仓库。

- 当前为桌面 Beta。其他操作系统、主题、多窗口长期并发和无障碍尚未完成完整验收。
- 支持标记区域中的顶层列表和单行行内代码，不承诺解析任意嵌套列表、表格或 HTML 容器。
- 暂无跨笔记引用、命名方案持久化、自动汇率和跨设备实时合并。
- 仍需更多异常输入、内存压力和中文输入法组合测试，自动测试不能替代真实宿主兼容验证。

## 反馈与许可

功能建议与普通问题请提交 [Issue](https://github.com/HowieZhao95/notecalc/issues)，附匿名的最小模型、插件与宿主版本。权限绕过或敏感数据漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

本项目采用 [MIT License](LICENSE)。构建打包的 decimal.js 保留原作者版权与 MIT 声明，详见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
