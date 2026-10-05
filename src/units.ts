import { D, CalcError } from "./numeric";
export type Dimension = Record<string, number>;
export type Unit = {
  symbol: string;
  factor: string;
  dimension: Dimension;
  absolute?: boolean;
  offset?: string;
};
export type Quantity = {
  baseValue: string;
  dimension: Dimension;
  unit: string;
  absolute: boolean;
};
const registry = new Map<string, Unit>();
function define(
  symbol: string,
  factor: string,
  dimension: Dimension,
  aliases: string[] = [],
  absolute = false,
  offset = "0",
) {
  const u = { symbol, factor, dimension, absolute, offset };
  for (const name of [symbol, ...aliases]) registry.set(name, u);
}
define("m", "1", { length: 1 }, ["米"]);
define("cm", "0.01", { length: 1 }, ["厘米"]);
define("mm", "0.001", { length: 1 }, ["毫米"]);
define("km", "1000", { length: 1 }, ["千米", "公里"]);
define("µm", "0.000001", { length: 1 }, ["um", "μm", "微米"]);
define("nm", "0.000000001", { length: 1 }, ["纳米"]);
define("kg", "1", { mass: 1 }, ["千克", "公斤"]);
define("g", "0.001", { mass: 1 }, ["克"]);
define("mg", "0.000001", { mass: 1 }, ["毫克"]);
define("t", "1000", { mass: 1 }, ["吨"]);
define("s", "1", { time: 1 }, ["秒"]);
define("ms", "0.001", { time: 1 }, ["毫秒"]);
define("min", "60", { time: 1 }, ["分钟", "分"]);
define("h", "3600", { time: 1 }, ["小时", "时"]);
define("d", "86400", { time: 1 }, ["天", "日"]);
define("周", "604800", { time: 1 }, ["week"]);
// Calendar months are not silently treated as 30 days.
define("月", "1", { calendarMonth: 1 }, ["个月"]);
define("年", "12", { calendarMonth: 1 });
define("A", "1", { current: 1 }, ["安培"]);
define("mA", "0.001", { current: 1 }, ["毫安"]);
define("mol", "1", { amount: 1 }, ["摩尔"]);
define("cd", "1", { luminous: 1 }, ["坎德拉"]);
define("K", "1", { temperature: 1 }, ["开尔文"], true);
define("℃", "1", { temperature: 1 }, ["°C", "摄氏度"], true, "273.15");
define("ΔK", "1", { temperature: 1 }, ["Δ℃", "Δ°C", "温差"]);
define("L", "0.001", { length: 3 }, ["l", "升"]);
define("mL", "0.000001", { length: 3 }, ["ml", "毫升"]);
define("ha", "10000", { length: 2 }, ["公顷"]);
define("Hz", "1", { time: -1 }, ["赫兹"]);
define("N", "1", { mass: 1, length: 1, time: -2 }, ["牛顿"]);
define("Pa", "1", { mass: 1, length: -1, time: -2 }, ["帕"]);
define("kPa", "1000", { mass: 1, length: -1, time: -2 });
define("J", "1", { mass: 1, length: 2, time: -2 }, ["焦耳"]);
define("kJ", "1000", { mass: 1, length: 2, time: -2 });
define("W", "1", { mass: 1, length: 2, time: -3 }, ["瓦"]);
define("kW", "1000", { mass: 1, length: 2, time: -3 }, ["千瓦"]);
define("Wh", "3600", { mass: 1, length: 2, time: -2 });
define("kWh", "3600000", { mass: 1, length: 2, time: -2 }, ["度电"]);
define("V", "1", { mass: 1, length: 2, time: -3, current: -1 }, ["伏"]);
define("mV", "0.001", { mass: 1, length: 2, time: -3, current: -1 }, ["毫伏"]);
define("Ω", "1", { mass: 1, length: 2, time: -3, current: -2 }, ["欧姆"]);
define("C", "1", { time: 1, current: 1 }, ["库仑"]);
define("F", "1", { mass: -1, length: -2, time: 4, current: 2 }, ["法拉"]);
define("H", "1", { mass: 1, length: 2, time: -2, current: -2 }, ["亨利"]);
define("元", "1", { "currency:CNY": 1 }, ["人民币", "CNY", "RMB"]);
define("万元", "10000", { "currency:CNY": 1 });
define("分人民币", "0.01", { "currency:CNY": 1 });
define("美元", "1", { "currency:USD": 1 }, ["USD"]);
define("欧元", "1", { "currency:EUR": 1 }, ["EUR"]);
define("日元", "1", { "currency:JPY": 1 }, ["JPY"]);
for (const [symbol, key, aliases] of [
  ["人", "person", []],
  ["单", "order", ["订单"]],
  ["个", "item", ["件"]],
  ["次", "event", []],
  ["词元", "token", ["token", "tokens"]],
  ["字", "character", []],
  ["页", "page", []],
  ["台", "machine", []],
] as [string, string, string[]][])
  define(symbol, "1", { ["count:" + key]: 1 }, aliases);
define("bit", "1", { data: 1 }, ["比特"]);
define("B", "8", { data: 1 }, ["byte", "字节"]);
define("KB", "8000", { data: 1 });
define("MB", "8000000", { data: 1 });
define("GB", "8000000000", { data: 1 });
define("KiB", "8192", { data: 1 });
define("MiB", "8388608", { data: 1 });
define("GiB", "8589934592", { data: 1 });
define("%", "0.01", {}, ["百分比"]);
define("‰", "0.001", {});
define("1", "1", {}, ["无量纲"]);
export function dimensionKey(d: Dimension) {
  return Object.entries(d)
    .filter(([, p]) => p)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, p]) => k + ":" + p)
    .join("|");
}
export function sameDimension(a: Dimension, b: Dimension) {
  return dimensionKey(a) === dimensionKey(b);
}
export function combineDimension(a: Dimension, b: Dimension, sign = 1) {
  const out = { ...a };
  for (const [key, p] of Object.entries(b)) {
    out[key] = (out[key] ?? 0) + sign * p;
    if (!out[key]) delete out[key];
    if (Math.abs(out[key] ?? 0) > 32)
      throw new CalcError("UNIT_LIMIT", "量纲指数超出 ±32");
  }
  return out;
}
const baseSymbols: Record<string, string> = {
  length: "m",
  mass: "kg",
  time: "s",
  calendarMonth: "月",
  current: "A",
  amount: "mol",
  luminous: "cd",
  temperature: "ΔK",
  data: "bit",
  "currency:CNY": "元",
  "currency:USD": "美元",
  "currency:EUR": "欧元",
  "currency:JPY": "日元",
  "count:person": "人",
  "count:order": "单",
  "count:item": "个",
  "count:event": "次",
  "count:token": "词元",
  "count:character": "字",
  "count:page": "页",
  "count:machine": "台",
};
export function canonicalUnit(d: Dimension, absolute = false) {
  if (absolute) return "K";
  const key = dimensionKey(d);
  for (const name of ["Hz", "N", "Pa", "J", "W", "V", "Ω", "C", "F", "H"])
    if (dimensionKey(registry.get(name)!.dimension) === key) return name;
  const positive: string[] = [],
    negative: string[] = [];
  for (const [k, p] of Object.entries(d).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const s = baseSymbols[k];
    if (!s) throw new CalcError("UNIT", "不支持的量纲");
    const term =
      s +
      (Math.abs(p) === 1
        ? ""
        : Math.abs(p) === 2
          ? "²"
          : Math.abs(p) === 3
            ? "³"
            : "^" + Math.abs(p));
    (p > 0 ? positive : negative).push(term);
  }
  return (
    (positive.join("·") || (negative.length ? "1" : "")) +
    (negative.length
      ? "/" +
        (negative.length > 1 ? "(" + negative.join("·") + ")" : negative[0])
      : "")
  );
}
export function dimensionLabel(d: Dimension, absolute = false) {
  const names: Record<string, string> = {
    length: "长度",
    mass: "质量",
    time: "时间",
    calendarMonth: "日历时间",
    temperature: absolute ? "绝对温度" : "温差",
    current: "电流",
    amount: "物质的量",
    luminous: "发光强度",
    data: "数据量",
    "currency:CNY": "人民币金额",
    "currency:USD": "美元金额",
    "currency:EUR": "欧元金额",
    "currency:JPY": "日元金额",
    "count:person": "人数",
    "count:order": "订单数",
    "count:item": "数量",
    "count:event": "次数",
    "count:token": "词元数",
  };
  const entries = Object.entries(d);
  if (!entries.length) return "无量纲";
  return (
    (entries.length === 1 && entries[0][1] === 1
      ? (names[entries[0][0]] ?? "计数量")
      : canonicalUnit(d, absolute)) +
    "（" +
    canonicalUnit(d, absolute) +
    "）"
  );
}
export function parseUnit(text: string): Unit {
  if (text === "") return { symbol: "", factor: "1", dimension: {} };
  if (typeof text !== "string" || text.length > 64)
    throw new CalcError("UNIT_LIMIT", "单位过长");
  const direct = registry.get(text.trim());
  if (direct) return { ...direct, dimension: { ...direct.dimension } };
  const input = text
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/×|·/g, "*")
    .replace(/÷/g, "/");
  let i = 0,
    nodes = 0;
  const ws = () => {
    while (/\s/.test(input[i] ?? "") && i < input.length) i++;
  };
  function atom(depth: number): Unit {
    if (++nodes > 32 || depth > 8)
      throw new CalcError("UNIT_LIMIT", "单位表达式过于复杂");
    ws();
    let u: Unit;
    if (input[i] === "(") {
      i++;
      u = expr(depth + 1);
      ws();
      if (input[i++] !== ")")
        throw new CalcError("UNIT_SYNTAX", "单位缺少右括号");
    } else {
      const m = input.slice(i).match(/^[^\s*/()^]+/);
      if (!m) throw new CalcError("UNIT_SYNTAX", "单位尚未写完");
      i += m[0].length;
      const found = registry.get(m[0]);
      if (!found)
        throw new CalcError(
          "UNKNOWN_UNIT",
          `未知单位“${m[0]}”，请使用常见单位，如 m、s、kg、元、单`,
        );
      u = { ...found, dimension: { ...found.dimension } };
    }
    ws();
    if (input[i] === "^") {
      i++;
      const p = input.slice(i).match(/^[+-]?\d+/);
      if (!p || Math.abs(Number(p[0])) > 16)
        throw new CalcError("UNIT_EXPONENT", "单位指数须为 ±16 内整数");
      i += p[0].length;
      if (u.absolute)
        throw new CalcError(
          "TEMPERATURE_TYPE",
          "绝对温度不能取幂，请使用温差单位 ΔK",
        );
      const power = Number(p[0]);
      u = {
        symbol: u.symbol + (power === 1 ? "" : "^" + power),
        factor: new D(u.factor).pow(power).toString(),
        dimension: Object.fromEntries(
          Object.entries(u.dimension)
            .map(([k, n]) => [k, n * power])
            .filter(([, n]) => n),
        ) as Dimension,
      };
    }
    return u;
  }
  function expr(depth: number): Unit {
    let a = atom(depth);
    while (true) {
      ws();
      const op = input[i];
      if (op !== "*" && op !== "/") break;
      i++;
      const b = atom(depth);
      if (a.absolute || b.absolute)
        throw new CalcError(
          "TEMPERATURE_TYPE",
          "绝对温度不能用于复合单位，请使用 ΔK",
        );
      a = {
        symbol: a.symbol + op + b.symbol,
        factor: (op === "*"
          ? new D(a.factor).mul(b.factor)
          : new D(a.factor).div(b.factor)
        ).toString(),
        dimension: combineDimension(
          a.dimension,
          b.dimension,
          op === "*" ? 1 : -1,
        ),
      };
    }
    return a;
  }
  const unit = expr(0);
  ws();
  if (i !== input.length)
    throw new CalcError("UNIT_SYNTAX", `单位中有多余内容：${input.slice(i)}`);
  return unit;
}
export function quantity(number: string, unit = ""): Quantity {
  const u = parseUnit(unit);
  return {
    baseValue: new D(number)
      .mul(u.factor)
      .plus(u.offset ?? 0)
      .toString(),
    dimension: u.dimension,
    unit: unit === "1" ? "" : unit,
    absolute: !!u.absolute,
  };
}
export function localValue(q: Quantity, unit = q.unit) {
  const u = parseUnit(unit);
  if (!sameDimension(q.dimension, u.dimension) || q.absolute !== !!u.absolute)
    throw new CalcError(
      "UNIT_MISMATCH",
      `单位不匹配：算式得到 ${dimensionLabel(q.dimension, q.absolute)}，不能显示为 ${unit || "无量纲"}`,
      undefined,
      {
        expected: dimensionLabel(q.dimension, q.absolute),
        actual: unit || "无量纲",
      },
    );
  return new D(q.baseValue).minus(u.offset ?? 0).div(u.factor);
}
export function assertCompatible(
  a: Quantity,
  b: Quantity,
  operation: string,
  flavor = true,
) {
  if (
    !sameDimension(a.dimension, b.dimension) ||
    (flavor && a.absolute !== b.absolute)
  )
    throw new CalcError(
      "DIMENSION_MISMATCH",
      `不能${operation}：左侧是 ${dimensionLabel(a.dimension, a.absolute)}，右侧是 ${dimensionLabel(b.dimension, b.absolute)}`,
      undefined,
      {
        expected: dimensionLabel(a.dimension, a.absolute),
        actual: dimensionLabel(b.dimension, b.absolute),
        operation,
      },
    );
}
export function binaryQuantity(op: string, a: Quantity, b: Quantity): Quantity {
  const av = new D(a.baseValue),
    bv = new D(b.baseValue);
  if (op === "+" || op === "-") {
    assertCompatible(a, b, op === "+" ? "相加" : "相减", false);
    let absolute = a.absolute;
    let unit = a.unit;
    if (op === "+" && a.absolute && b.absolute)
      throw new CalcError(
        "TEMPERATURE_TYPE",
        "两个绝对温度不能相加；请加上温差（ΔK 或 Δ℃）",
      );
    if (op === "+" && b.absolute) {
      absolute = true;
      unit = b.unit;
    }
    if (op === "-" && a.absolute && b.absolute) {
      absolute = false;
      unit = "ΔK";
    } else if (op === "-" && !a.absolute && b.absolute)
      throw new CalcError("TEMPERATURE_TYPE", "温差不能减去绝对温度");
    return {
      baseValue: (op === "+" ? av.plus(bv) : av.minus(bv)).toString(),
      dimension: a.dimension,
      unit,
      absolute,
    };
  }
  if (a.absolute || b.absolute)
    throw new CalcError("TEMPERATURE_TYPE", "绝对温度不能乘除，请使用温差 ΔK");
  if (op === "/" && bv.isZero()) throw new CalcError("DIV_ZERO", "除数为零");
  const dim = combineDimension(a.dimension, b.dimension, op === "*" ? 1 : -1);
  let unit = canonicalUnit(dim);
  if (op === "*" && !Object.keys(b.dimension).length) unit = a.unit;
  else if (op === "*" && !Object.keys(a.dimension).length) unit = b.unit;
  else if (op === "/" && !Object.keys(b.dimension).length) unit = a.unit;
  else if (
    op === "/" &&
    !Object.keys(dim).length &&
    Object.keys(a.dimension).length
  )
    unit = "%";
  return {
    baseValue: (op === "*" ? av.mul(bv) : av.div(bv)).toString(),
    dimension: dim,
    unit,
    absolute: false,
  };
}
export function unitCapabilities() {
  return {
    system: "dimensions-v1",
    units: [...registry.values()]
      .filter((u, i, a) => a.indexOf(u) === i)
      .map((u) => ({ ...u, dimension: { ...u.dimension } })),
    calendarPolicy: "month and year cannot convert to fixed seconds",
    currencyPolicy:
      "different currencies are different dimensions; no implicit exchange rate",
  };
}
