import { test } from "node:test";
import assert from "node:assert/strict";
import {
  models,
  evaluate,
  literal,
  parseExpression,
  patchModel,
  displayValue,
} from "../src/engine";
import { EXAMPLE } from "../src/example";
function run(body: string) {
  return evaluate(models("```notecalc\n// @model test\n" + body + "\n```")[0]);
}
test("独立算术基准：培训交付八个指标", () => {
  const result = evaluate(models(EXAMPLE)[0]);
  assert.equal(result.status, "valid");
  for (const [name, value] of Object.entries({
    毕业率: "0.5",
    每单学生提成: "1000",
    每单结余: "700",
    总单量: "80",
    总收入: "160000",
    学生提成合计: "80000",
    词元成本合计: "24000",
    组织方交付结余: "56000",
  }))
    assert.equal(result.values[name], value);
});
test("1500/2000/2500 三个价格；定点修改保留注释和另一模型", () => {
  const source =
    EXAMPLE +
    "\n<!-- preserved -->\n```notecalc\n// @model other\na = 5\n```\n";
  for (const [price, surplus] of [
    ["1500", "36000"],
    ["2000", "56000"],
    ["2500", "76000"],
  ]) {
    const patched = patchModel(source, models(source)[0], [
      { op: "set_input", name: "每单单价", literal: price },
    ]);
    assert.equal(
      patched.source,
      source.replace("每单单价 = 2000", "每单单价 = " + price),
    );
    const r = evaluate(models(patched.source)[0]);
    assert.equal(r.values["组织方交付结余"], surplus);
    if (price === "2500") assert.equal(r.values["每单结余"], "950");
  }
});
test("十进制、前向引用、优先级、中文、科学计数与百分比", () => {
  const r = run(
    "结果 := 后置 + 0.1 + 0.2\n后置 = 50%\n括号 := (1 + 2) × 4 ÷ 2\n优先 := 2 + 3 * 4\n科学 = 1e-3",
  );
  assert.equal(r.status, "valid");
  assert.equal(r.values["结果"], "0.8");
  assert.equal(r.values["括号"], "6");
  assert.equal(r.values["优先"], "14");
  assert.equal(r.values["科学"], "0.001");
});
test("白名单函数、HALF_EVEN 舍入与显示不污染内部值", () => {
  const r = run(
    "a := round(2.345, 2)\nb := abs(-4)\nc := min(3, max(2, 4))\nd := 1/3\ne := d*3",
  );
  assert.equal(r.values.a, "2.34");
  assert.equal(r.values.b, "4");
  assert.equal(r.values.c, "3");
  assert.equal(r.values.d, "0.3333333333333333333333333333333333");
});
for (const [name, body, code] of [
  ["除零", "a := 1 / 0", "DIV_ZERO"],
  ["循环", "a := b\nb := a", "CYCLE"],
  ["未定义", "a := missing", "UNDEFINED"],
  ["重复", "a = 1\na = 2", "DUPLICATE"],
  ["不完整", "a := 2 *", "INCOMPLETE"],
  ["范围", "// @input a min=1 max=3\na = 4", "RANGE"],
  ["步长", "// @input a min=0 step=2\na = 3", "STEP"],
  ["整数", "// @input a integer=true\na = 1.5", "INTEGER"],
  ["函数权限", "a := import(1)", "FUNCTION"],
  ["属性链", "a := global.process", "SYNTAX"],
  ["任意代码", "a := (() => 1)()", "SYNTAX"],
  ["版本", "// @version 2\na = 1", "VERSION"],
  ["无效输出", "// @output missing\na = 1", "OUTPUT"],
] as const)
  test(name + " 明确诊断，错误变量不提供结果", () => {
    const r = run(body);
    assert.ok(
      r.diagnostics.some((d) => d.code === code),
      JSON.stringify(r),
    );
    if (code === "OUTPUT") assert.equal(r.values.a, "1");
    else assert.equal(Object.keys(r.values).length, 0);
    assert.equal(r.status, code === "INCOMPLETE" ? "incomplete" : "error");
  });
test("资源上限及畸形输入", () => {
  assert.throws(() => parseExpression("(".repeat(100) + "1" + ")".repeat(100)));
  assert.throws(() => parseExpression("1+".repeat(300) + "1"));
  assert.throws(() => literal("1e101"));
  assert.throws(() => models("x".repeat(2_000_001)));
});
test("围栏隔离，示例文档中的嵌套代码不被执行", () => {
  assert.equal(
    models("````markdown\n```notecalc\n// @model ignored\na = 1\n```\n````")
      .length,
    0,
  );
  assert.equal(
    models("~~~notecalc\n// @model tilde\na = 1\n~~~")[0].id,
    "tilde",
  );
});
test("CRLF 与行内注释保持不变", () => {
  const src =
    "```notecalc\r\n// @model t\r\n  a  =  1  // 保留\r\nb := a+1\r\n```\r\n";
  assert.equal(
    patchModel(src, models(src)[0], [
      { op: "set_input", name: "a", literal: "2" },
    ]).source,
    src.replace("1  //", "2  //"),
  );
});
test("禁止公式覆盖、重复修改、换行注入及原型名称不产生权限", () => {
  const m = models(EXAMPLE)[0];
  assert.throws(() =>
    patchModel(EXAMPLE, m, [
      { op: "set_input", name: "每单结余", literal: "2" },
    ]),
  );
  assert.throws(() =>
    patchModel(EXAMPLE, m, [
      { op: "set_input", name: "每单单价", literal: "2500\n其他 = 0" },
    ]),
  );
  assert.equal(run("constructor = 5\na := constructor+1").values.a, "6");
});
test("增量计算只重算受影响节点，结果与完整计算一致", () => {
  const m = models(EXAMPLE)[0],
    old = evaluate(m),
    src = EXAMPLE.replace("每单单价 = 2000", "每单单价 = 2500"),
    updated = models(src)[0],
    inc = evaluate(updated, {
      model: m,
      values: old.values,
      status: old.status,
    }),
    full = evaluate(models(src)[0]);
  assert.deepEqual(inc.values, full.values);
  assert.ok(inc.stats.reused > 0);
  assert.ok(inc.stats.evaluated < m.nodes.length);
  assert.equal(inc.values["组织方交付结余"], "76000");
});
test("增量计算不能用缓存掩盖新增循环或缺失依赖", () => {
  const base = models("```notecalc\n// @model t\na = 1\nb := a+1\n```")[0],
    old = evaluate(base),
    previous = { model: base, values: old.values, status: old.status };
  const cycle = models("```notecalc\n// @model t\na := b\nb := a+1\n```")[0];
  assert.ok(
    evaluate(cycle, previous).diagnostics.some((d) => d.code === "CYCLE"),
  );
  const missing = models("```notecalc\n// @model t\nb := a+1\n```")[0];
  assert.ok(
    evaluate(missing, previous).diagnostics.some((d) => d.code === "UNDEFINED"),
  );
});

test("改名更新精确引用、控件、重点结果和单位，不动注释或其他区域", () => {
  const src =
    '```notecalc\r\n// @model rename\r\n// @input 单价 control=slider min=0 max=3000 step=100\r\n// @output 单价\r\n// @unit 单价 "元"\r\n// 单价 注释保留\r\n  单价  =  2000  // 单价 保留\r\n单价差 = 10 元\r\ne = 1 元\r\nmin = 3 元\r\n结余 := min(单价, 2500 元) + 单价差 + e + 1e3 元 + min\r\n```\r\n```notecalc\r\n// @model other\r\n单价 = 99\r\n```';
  const out = patchModel(src, models(src)[0], [
    { op: "rename", name: "单价", newName: "售价" },
    { op: "rename", name: "min", newName: "下限" },
    { op: "rename", name: "e", newName: "系数" },
  ]);
  assert.ok(
    out.source.includes("min(售价, 2500 元) + 单价差 + 系数 + 1e3 元 + 下限"),
  );
  assert.ok(out.source.includes("// 单价 注释保留"));
  assert.ok(out.source.includes("售价  =  2000  // 单价 保留"));
  assert.ok(out.source.endsWith("单价 = 99\r\n```"));
  const m = models(out.source)[0];
  assert.ok(m.controls.售价);
  assert.deepEqual(m.outputs, ["售价"]);
  assert.equal(m.units.售价, "元");
  assert.equal(evaluate(m).values.结余, "3014");
  const sorted = [...out.patches].sort((a, b) => a.from - b.from);
  assert.ok(sorted.every((p, i) => !i || sorted[i - 1].to <= p.from));
});
test("名称与单位、输入值可在同一候选修改并仍完整校验", () => {
  const typed = EXAMPLE.replace(
    "每单词元成本 = 300",
    "每单词元成本 = 300 元/单",
  ).replace("总单量 := 毕业人数 * 变现月数 * 每人每月单量", "总单量 := 80 单");
  const out = patchModel(typed, models(typed)[0], [
    { op: "rename", name: "每单单价", newName: "售价" },
    { op: "set_input", name: "每单单价", literal: "2500" },
    { op: "set_unit", name: "每单单价", unit: "元/单" },
    { op: "set_unit", name: "组织方交付结余", unit: "元" },
  ]);
  const m = models(out.source)[0],
    r = evaluate(m);
  assert.equal(r.values["组织方交付结余"], "76000");
  assert.equal(m.units.售价, "元/单");
  assert.equal(m.units["组织方交付结余"], "元");
  assert.ok(out.source.includes("每单学生提成 := 售价 * 学生提成比例"));
});
test("单位增加、修改、删除，十进制值和算术不改变", () => {
  let src = "```notecalc\n// @model units\na = 0.5\nb := a*2\n```";
  const base = evaluate(models(src)[0]).values;
  src = patchModel(src, models(src)[0], [
    { op: "set_unit", name: "a", unit: "元" },
    { op: "set_unit", name: "b", unit: "元" },
  ]).source;
  assert.deepEqual(evaluate(models(src)[0]).values, base);
  src = patchModel(src, models(src)[0], [
    { op: "set_unit", name: "b", unit: "万元" },
    { op: "rename", name: "b", newName: "总额" },
  ]).source;
  assert.equal(models(src)[0].units.总额, "万元");
  src = patchModel(src, models(src)[0], [
    { op: "set_unit", name: "a", unit: "" },
  ]).source;
  assert.equal(models(src)[0].units.a, undefined);
  assert.equal(evaluate(models(src)[0]).values.a, base.a);
  assert.equal(evaluate(models(src)[0]).values.总额, base.b);
});
test("无效改名、重名、单位注入与未知单位名称被拒绝", () => {
  const m = models(EXAMPLE)[0];
  for (const newName of ["毕业人数", "123名", "name.foo", "bad\nname", "name "])
    assert.throws(() =>
      patchModel(EXAMPLE, m, [{ op: "rename", name: "每单单价", newName }]),
    );
  for (const unit of [
    "元\n// @model injected",
    "a".repeat(25),
    "元```",
    "元//说明",
  ])
    assert.throws(() =>
      patchModel(EXAMPLE, m, [{ op: "set_unit", name: "每单单价", unit }]),
    );
  assert.equal(run("// @unit missing 元\na = 1").status, "error");
});

test("百分比及同量纲显示换算", () => {
  assert.equal(displayValue("0.5", "%"), "50%");
  assert.equal(displayValue("2000", "万元"), "0.2 万元");
  assert.equal(displayValue(undefined, "元"), "—");
});
