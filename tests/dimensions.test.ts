import { test } from "node:test";
import assert from "node:assert/strict";
import {
  models,
  evaluate,
  patchModel,
  displayValue,
  parseExpression,
} from "../src/engine";
import { parseUnit, localValue } from "../src/units";
const source = (s: string) =>
  "```notecalc\n// @model dimensions\n" + s + "\n```\n";
const run = (s: string) => evaluate(models(source(s))[0]);
function good(s: string) {
  const r = run(s);
  assert.equal(r.status, "valid", JSON.stringify(r.diagnostics));
  return r;
}
test("内容推导长度、同量纲加减、乘除、面积、速度，无需声明结果单位", () => {
  const r = good(
    "长 = 200 cm\n宽 = 3 m\n时长 = 2 s\n总长 := 长 + 宽\n面积 := 长 * 宽\n速度 := 长 / 时长",
  );
  assert.equal(r.values.总长, "5");
  assert.equal(displayValue(r.values.总长, r.units.总长), "500 cm");
  assert.equal(r.units.面积, "m²");
  assert.equal(r.values.面积, "6");
  assert.equal(r.units.速度, "m/s");
  assert.equal(r.values.速度, "1");
  assert.equal(r.quantities.速度.dimension.time, -1);
});
test("自然输入支持复合单位与公式内带单位常量", () => {
  const r = good(
    "速率 = 36 km/h\n时长 = 10 s\n距离 := 速率 * 时长\n比较 := 距离 + 20 cm\n另一速度 := 5 [m/s] + 18 [km/h]",
  );
  assert.equal(r.values.距离, "100");
  assert.equal(r.values.比较, "100.2");
  assert.equal(r.values.另一速度, "10");
});
test("业务单位保留语义、单价乘订单自动得到元、人数比自动得到百分比", () => {
  const r = good(
    "人数 = 10 人\n总人数 = 20 人\n月份 = 2 月\n单量 = 4 单/人/月\n价格 = 2000 元/单\n成本 = 300 元/单\n比例 = 50%\n结余 := 价格*(1-比例)-成本\n总单量 := 人数*月份*单量\n总结余 := 总单量*结余\n毕业率 := 人数/总人数",
  );
  assert.equal(r.values.结余, "700");
  assert.equal(r.units.结余, "元/单");
  assert.equal(r.values.总单量, "80");
  assert.equal(r.units.总单量, "单");
  assert.equal(r.values.总结余, "56000");
  assert.equal(r.units.总结余, "元");
  assert.equal(displayValue(r.values.毕业率, r.units.毕业率), "50%");
});
for (const [title, body, code] of [
  ["长度不能加时间", "a = 1 m\nb = 2 s\nc := a+b", "DIMENSION_MISMATCH"],
  ["数值无单位不能冒充长度", "a = 1 m\nc := a+2", "DIMENSION_MISMATCH"],
  [
    "人民币美元不自动换汇",
    "a = 1 元\nb = 2 USD\nc := a+b",
    "DIMENSION_MISMATCH",
  ],
  ["人数不能加订单", "a = 1 人\nb = 2 单\nc := a+b", "DIMENSION_MISMATCH"],
  ["min比较必须同类型", "a := min(1 m, 2 s)", "DIMENSION_MISMATCH"],
  ["round位数不能带单位", "a := round(1 m, 2 s)", "ROUND_TYPE"],
  ["结果单位不能伪装类型", "// @unit c s\na = 1 m\nc := a*2", "UNIT_MISMATCH"],
  ["月不能按30天换算", "a = 1 月\nb = 30 d\nc := a-b", "DIMENSION_MISMATCH"],
  ["未知单位明确报错", "a = 1 火星单位", "UNKNOWN_UNIT"],
  ["绝对温度不能相加", "a = 20 ℃\nb = 10 ℃\nc := a+b", "TEMPERATURE_TYPE"],
  ["温度低于绝对零度", "a = -1 K", "TEMPERATURE_RANGE"],
  ["温度不能参与普通乘除", "a = 20 ℃\nb := a*2", "TEMPERATURE_TYPE"],
] as const)
  test(title, () => {
    const r = run(body);
    assert.ok(
      r.diagnostics.some((d) => d.code === code),
      JSON.stringify(r.diagnostics),
    );
    for (const [name, state] of Object.entries(r.nodeStates)) {
      if (state !== "valid") {
        assert.equal(Object.hasOwn(r.values, name), false);
        assert.equal(Object.hasOwn(r.quantities, name), false);
      }
    }
    assert.equal(r.status, "error");
  });
test("类型错误包含变量、行号、左右类型及清楚说明", () => {
  const r = run("长度 = 1 m\n时长 = 2 s\n结果 := 长度+时长");
  const d = r.diagnostics.find((d) => d.code === "DIMENSION_MISMATCH")!;
  assert.equal(d.variable, "结果");
  assert.equal(d.line, 5);
  assert.match(d.message, /长度.*时间/);
  assert.match(d.details?.expected as string, /长度/);
});
test("支持SI派生单位、升、质量、能量和二进制数据换算", () => {
  const r = good(
    "力 = 2 N\n距离 = 3 m\n能量 := 力*距离\n时间 = 2 s\n功率 := 能量/时间\n水 = 1 L\n水量 := 水 + 500 mL\n重量 := 1 kg + 500 g\n数据 := 1 MiB + 1024 KiB",
  );
  assert.equal(r.values.能量, "6");
  assert.equal(r.units.能量, "J");
  assert.equal(r.units.功率, "W");
  assert.equal(r.values.水量, "0.0015");
  assert.equal(displayValue(r.values.水量, r.units.水量), "1.5 L");
  assert.equal(r.values.重量, "1.5");
  assert.equal(r.values.数据, "16777216");
});
test("绝对温度、温差、摄氏和开尔文转换", () => {
  const r = good(
    "// @unit 另一温度 K\na = 20 ℃\nb = 10 ℃\n温差 := a-b\n另一温度 := a+5 ΔK\n比较 := min(a, 300 K)",
  );
  assert.equal(displayValue(r.values.a, r.units.a), "20 ℃");
  assert.equal(r.values.温差, "10");
  assert.equal(r.units.温差, "ΔK");
  assert.equal(r.values.另一温度, "298.15");
  assert.equal(r.quantities.另一温度.absolute, true);
});
test("同量纲单位动态转换保留真实值，范围、步长和引用同步", () => {
  const src = source(
    "// @input 长 control=slider min=100 max=300 step=50\n// @unit 长 cm\n长 = 200\n两倍 := 长*2",
  );
  const old = evaluate(models(src)[0]);
  const patched = patchModel(src, models(src)[0], [
    { op: "set_unit", name: "长", unit: "m" },
  ]);
  assert.match(patched.source, /长 = 2/);
  assert.match(patched.source, /min=1 max=3 step=0.5/);
  const r = evaluate(models(patched.source)[0]);
  assert.equal(r.values.长, old.values.长);
  assert.equal(r.values.两倍, "4");
  assert.equal(r.units.长, "m");
  assert.throws(
    () =>
      patchModel(src, models(src)[0], [
        { op: "set_unit", name: "长", unit: "s" },
      ]),
    { code: "UNIT_MISMATCH" },
  );
});
test("清空声明仍可从输入内容推导，不会悄悄丢失量纲", () => {
  const src = source("// @unit a cm\na = 200\nb := a*2");
  const patched = patchModel(src, models(src)[0], [
    { op: "set_unit", name: "a", unit: "" },
  ]);
  assert.match(patched.source, /a = 200 cm/);
  const r = evaluate(models(patched.source)[0]);
  assert.equal(r.values.a, "2");
  assert.equal(r.units.b, "cm");
});
test("单位变更传播至依赖并使增量缓存失效", () => {
  const first = models(source("a = 2\nb := a*3"))[0],
    r = evaluate(first);
  const current = models(source("// @unit a cm\na = 2\nb := a*3"))[0];
  const next = evaluate(current, { model: first, ...r });
  assert.equal(next.values.b, "0.06");
  assert.equal(next.units.b, "cm");
  assert.deepEqual(
    next.values,
    evaluate(models(source("// @unit a cm\na = 2\nb := a*3"))[0]).values,
  );
});
test("改名不会改动单位符号或单位表达式", () => {
  const src = source("m = 1\na := 20 cm + 1 m\nb := m*2");
  const p = patchModel(src, models(src)[0], [
    { op: "rename", name: "m", newName: "系数" },
  ]);
  assert.ok(p.source.includes("20 cm + 1 m"));
  assert.ok(p.source.includes("b := 系数*2"));
});
test("单位语法有资源限制且不执行代码", () => {
  for (const u of [
    "m^999",
    "m/" + "(".repeat(12) + "s" + ")".repeat(12),
    "process.exit()",
    "m^2 x",
    "m/" + "s*".repeat(35) + "s",
  ])
    assert.throws(() => parseUnit(u));
  assert.throws(() => parseExpression("1 [global.process]"));
  assert.equal(
    localValue(
      {
        baseValue: "2000",
        dimension: { "currency:CNY": 1 },
        unit: "元",
        absolute: false,
      },
      "万元",
    ).toString(),
    "0.2",
  );
});
