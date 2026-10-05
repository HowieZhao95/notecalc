import { D, CalcError, POLICY } from "./numeric";
export { D, CalcError, POLICY } from "./numeric";
import {
  Quantity,
  quantity,
  localValue,
  parseUnit,
  canonicalUnit,
  binaryQuantity,
  assertCompatible,
  sameDimension,
} from "./units";
import {
  models,
  normalizeModelMaps,
  IDENTIFIER as ID,
  Model,
  Node,
  Control,
  Diagnostic,
} from "./document";
export { models } from "./document";
export type { Model, Node, Control, Diagnostic } from "./document";
export type Evaluation = {
  status: "valid" | "incomplete" | "error";
  values: Record<string, string>;
  displayValues: Record<string, string>;
  units: Record<string, string>;
  quantities: Record<string, Quantity>;
  nodeStates: Record<string, "valid" | "incomplete" | "error" | "blocked">;
  diagnostics: Diagnostic[];
  policy: typeof POLICY;
  stats: { evaluated: number; reused: number };
};
const literalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?%?$/;
export function literal(s: string): InstanceType<typeof D> {
  if (s.length > 128 || !literalPattern.test(s))
    throw new CalcError("INVALID_LITERAL", "输入必须为数值或百分比");
  const exp = s.match(/[eE]([+-]?\d+)/);
  if (exp && Math.abs(Number(exp[1])) > 100)
    throw new CalcError("LIMIT", "指数超出 ±100");
  const v = new D(s.replace(/%$/, ""));
  return s.endsWith("%") ? v.div(100) : v;
}
export function inputQuantity(expression: string, defaultUnit = ""): Quantity {
  const m = expression
    .trim()
    .match(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?)(%|‰)?(?:\s*(.+))?$/,
    );
  if (!m || (m[2] && m[3]))
    throw new CalcError(
      "INVALID_LITERAL",
      "输入需要数值及可选单位，如 200 cm 或 2000 元/单",
    );
  literal(m[1]);
  const inline = m[2] ?? m[3]?.replace(/^\[(.*)\]$/, "$1");
  const q = quantity(m[1], inline ?? defaultUnit);
  if (inline && defaultUnit) {
    localValue(q, defaultUnit);
    q.unit = defaultUnit;
  }
  return q;
}
export function inputControlValue(expression: string, defaultUnit = "") {
  const q = inputQuantity(expression, defaultUnit);
  return new D(q.baseValue);
}
type AST =
  | { kind: "num"; value: string; unit?: string }
  | { kind: "ref"; name: string }
  | { kind: "unary"; op: string; arg: AST }
  | { kind: "binary"; op: string; left: AST; right: AST }
  | { kind: "call"; name: string; args: AST[] };
type Token = {
  s: string;
  kind: "num" | "id" | "op" | "end";
  from: number;
  to: number;
  unit?: string;
};
export function parseExpression(expression: string): {
  ast: AST;
  deps: string[];
  references: { name: string; from: number; to: number }[];
} {
  if (expression.length > 4096)
    throw new CalcError("LIMIT", "表达式长度超过 4096");
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const ws = rest.match(/^\s+/);
    if (ws) {
      offset += ws[0].length;
      continue;
    }
    const num = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?%?/);
    const id = rest.match(new RegExp(`^${ID}`, "u"));
    if (num) {
      const from = offset;
      offset += num[0].length;
      let unit: string | undefined;
      const suffix = expression
        .slice(offset)
        .match(
          /^\s*(?:\[([^\]\r\n]+)\]|([\p{L}µμΔ°℃‰]+(?:[²³]|\^[+-]?\d+)?))/u,
        );
      if (suffix) {
        unit = suffix[1] ?? suffix[2];
        parseUnit(unit);
        offset += suffix[0].length;
      }
      tokens.push({ s: num[0], kind: "num", from, to: offset, unit });
    } else if (id) {
      tokens.push({
        s: id[0],
        kind: "id",
        from: offset,
        to: offset + id[0].length,
      });
      offset += id[0].length;
    } else if ("+-*/(),×÷".includes(rest[0])) {
      tokens.push({
        s: rest[0].replace("×", "*").replace("÷", "/"),
        kind: "op",
        from: offset,
        to: offset + 1,
      });
      offset++;
    } else throw new CalcError("SYNTAX", `不支持的字符：${rest[0]}`);
    if (tokens.length > 512) throw new CalcError("LIMIT", "表达式节点超出限制");
  }
  tokens.push({ s: "", kind: "end", from: offset, to: offset });
  let i = 0;
  const deps = new Set<string>();
  const references: { name: string; from: number; to: number }[] = [];
  const take = () => tokens[i++];
  const peek = () => tokens[i];
  const expect = (s: string) => {
    if (peek().s !== s)
      throw new CalcError(
        peek().kind === "end" ? "INCOMPLETE" : "SYNTAX",
        `需要 ${s}`,
      );
    take();
  };
  function expr(depth: number, min = 0): AST {
    if (depth > 64) throw new CalcError("LIMIT", "表达式嵌套超过 64");
    const t = take();
    let a: AST;
    if (t.kind === "end") throw new CalcError("INCOMPLETE", "输入未完成");
    if (t.kind === "num") {
      literal(t.s);
      a = { kind: "num", value: t.s, unit: t.unit };
    } else if (t.s === "+" || t.s === "-")
      a = { kind: "unary", op: t.s, arg: expr(depth + 1, 3) };
    else if (t.s === "(") {
      a = expr(depth + 1);
      expect(")");
    } else if (t.kind === "id") {
      if (peek().s === "(") {
        if (!["min", "max", "abs", "round"].includes(t.s))
          throw new CalcError("FUNCTION", `函数不在白名单：${t.s}`);
        take();
        const args: AST[] = [];
        if (peek().s !== ")") {
          args.push(expr(depth + 1));
          while (peek().s === ",") {
            take();
            args.push(expr(depth + 1));
          }
        }
        expect(")");
        a = { kind: "call", name: t.s, args };
      } else {
        deps.add(t.s);
        references.push({ name: t.s, from: t.from, to: t.to });
        a = { kind: "ref", name: t.s };
      }
    } else throw new CalcError("SYNTAX", `意外符号：${t.s}`);
    while (true) {
      const op = peek().s;
      const priority =
        op === "+" || op === "-" ? 1 : op === "*" || op === "/" ? 2 : 0;
      if (!priority || priority <= min) break;
      take();
      a = { kind: "binary", op, left: a, right: expr(depth + 1, priority) };
    }
    return a;
  }
  const ast = expr(0);
  if (peek().kind !== "end")
    throw new CalcError("SYNTAX", `多余内容：${peek().s}`);
  return { ast, deps: [...deps], references };
}
function calc(ast: AST, resolve: (name: string) => Quantity): Quantity {
  if (ast.kind === "num") return inputQuantity(ast.value, ast.unit);
  if (ast.kind === "ref") return resolve(ast.name);
  if (ast.kind === "unary") {
    const n = calc(ast.arg, resolve);
    if (ast.op === "-") {
      if (n.absolute)
        throw new CalcError("TEMPERATURE_TYPE", "绝对温度不能取负号");
      return { ...n, baseValue: new D(n.baseValue).neg().toString() };
    }
    return n;
  }
  if (ast.kind === "binary")
    return binaryQuantity(
      ast.op,
      calc(ast.left, resolve),
      calc(ast.right, resolve),
    );
  const args = ast.args.map((a) => calc(a, resolve));
  if (ast.name === "min" || ast.name === "max") {
    if (!args.length) throw new CalcError("ARITY", "min/max 至少一个参数");
    args.forEach((a) => assertCompatible(args[0], a, "比较"));
    const value =
      ast.name === "min"
        ? D.min(...args.map((q) => q.baseValue))
        : D.max(...args.map((q) => q.baseValue));
    return { ...args[0], baseValue: value.toString() };
  }
  if (ast.name === "abs") {
    if (args.length !== 1) throw new CalcError("ARITY", "abs 需要一个参数");
    if (args[0].absolute)
      throw new CalcError("TEMPERATURE_TYPE", "abs 不接受绝对温度");
    return { ...args[0], baseValue: new D(args[0].baseValue).abs().toString() };
  }
  if (args.length < 1 || args.length > 2)
    throw new CalcError("ARITY", "round 需要一或两个参数");
  const count = args[1];
  if (count && (Object.keys(count.dimension).length || count.absolute))
    throw new CalcError(
      "ROUND_TYPE",
      "round 的小数位数必须为无量纲整数，不能带长度、时间等单位",
    );
  const places = new D(count?.baseValue ?? 0);
  if (!places.isInteger() || places.lt(0) || places.gt(34))
    throw new CalcError("ROUND", "round 位数须为 0–34 整数");
  const n = args[0];
  return quantity(
    localValue(n).toDecimalPlaces(places.toNumber()).toString(),
    n.unit,
  );
}
function diagnostic(e: unknown, line?: number, variable?: string): Diagnostic {
  return {
    code: e instanceof CalcError ? e.code : "ERROR",
    message:
      (variable ? variable + "：" : "") +
      (e instanceof Error ? e.message : String(e)),
    line,
    variable,
    details: e instanceof CalcError ? e.details : undefined,
  };
}
export function validateControl(
  name: string,
  value: InstanceType<typeof D>,
  c: Control = {},
) {
  const min = c.min !== undefined ? literal(c.min) : undefined,
    max = c.max !== undefined ? literal(c.max) : undefined,
    step = c.step !== undefined ? literal(c.step) : undefined;
  if (min && max && min.gt(max)) throw new CalcError("CONTROL", "min 大于 max");
  if (step && !step.gt(0)) throw new CalcError("CONTROL", "step 必须大于零");
  if ((min && value.lt(min)) || (max && value.gt(max)))
    throw new CalcError("RANGE", `${name} 超出范围`);
  if (c.integer && !value.isInteger())
    throw new CalcError("INTEGER", `${name} 必须为整数`);
  if (
    step &&
    !value
      .minus(min ?? 0)
      .mod(step)
      .isZero()
  )
    throw new CalcError("STEP", `${name} 不符合步长 ${c.step}`);
  if (c.control === "slider" && (!min || !max || !step))
    throw new CalcError("CONTROL", "滑块需明确 min、max、step");
}
export type Previous = {
  model: Model;
  values: Record<string, string>;
  status: string;
  quantities?: Record<string, Quantity>;
};
export function evaluate(model: Model, previous?: Previous): Evaluation {
  normalizeModelMaps(model);
  if (previous) normalizeModelMaps(previous.model);
  const diagnostics = [...model.diagnostics];
  const byName = new Map<string, Node>();
  const asts = new Map<string, AST>();
  for (const node of model.nodes) {
    node.deps = [];
    if (byName.has(node.name)) {
      const first = byName.get(node.name)!;
      if (
        !diagnostics.some(
          (d) => d.code === "DUPLICATE" && d.line === first.line,
        )
      )
        diagnostics.push({
          code: "DUPLICATE",
          message: `重复变量 ${node.name}`,
          line: first.line,
          variable: node.name,
        });
      diagnostics.push({
        code: "DUPLICATE",
        message: `重复变量 ${node.name}`,
        line: node.line,
        variable: node.name,
      });
      continue;
    }
    byName.set(node.name, node);
    try {
      if (!node.expression) throw new CalcError("INCOMPLETE", "输入未完成");
      if (node.kind === "input")
        validateQuantityControl(
          node.name,
          inputQuantity(node.expression, model.units[node.name]),
          model.controls[node.name],
        );
      else {
        const parsed = parseExpression(node.expression);
        node.deps = parsed.deps;
        asts.set(node.name, parsed.ast);
      }
      if (model.units[node.name]) parseUnit(model.units[node.name]);
    } catch (e) {
      diagnostics.push(diagnostic(e, node.line, node.name));
    }
  }
  for (const name of Object.keys(model.controls))
    if (byName.get(name)?.kind !== "input")
      diagnostics.push({
        code: "CONTROL",
        message: `@input 未指向输入 ${name}`,
        variable: name,
      });
  for (const name of Object.keys(model.units))
    if (!byName.has(name))
      diagnostics.push({
        code: "UNIT",
        message: `单位未指向已定义名称 ${name}`,
        variable: name,
      });
  for (const name of model.outputs)
    if (!byName.has(name))
      diagnostics.push({
        code: "OUTPUT",
        message: `@output 未定义 ${name}`,
        variable: name,
      });
  const failures = new Map<string, Diagnostic>();
  const nodeStates: Evaluation["nodeStates"] = Object.create(null);
  for (const d of diagnostics) {
    const name = d.variable ?? model.nodes.find((n) => n.line === d.line)?.name;
    if (name) {
      failures.set(name, d);
      nodeStates[name] = d.code === "INCOMPLETE" ? "incomplete" : "error";
    }
  }
  for (const node of model.nodes)
    for (const dep of node.deps)
      if (!byName.has(dep) && !failures.has(dep)) {
        const d: Diagnostic = {
          code: "UNDEFINED",
          message: `未定义变量 ${dep}`,
          line: node.line,
          variable: node.name,
        };
        diagnostics.push(d);
        failures.set(node.name, d);
        nodeStates[node.name] = "error";
      }
  const values: Record<string, string> = Object.create(null),
    units: Record<string, string> = Object.create(null),
    quantities: Record<string, Quantity> = Object.create(null);
  const visiting = new Set<string>();
  const path: string[] = [];
  const globalFailure = diagnostics.find(
    (d) =>
      [
        "VERSION",
        "MODEL_ID",
        "DUP_MODEL",
        "DUP_MODEL_DIRECTIVE",
        "NESTED_MODEL",
      ].includes(d.code) ||
      (d.code === "INCOMPLETE" && d.line === model.lineFrom && !d.variable),
  );
  let evaluated = 0,
    reused = 0;
  if (previous?.status === "valid" && !diagnostics.length) {
    const old = new Map(previous.model.nodes.map((n) => [n.name, n]));
    const dirty = new Set<string>();
    for (const node of model.nodes) {
      const before = old.get(node.name);
      if (
        !before ||
        before.kind !== node.kind ||
        before.expression !== node.expression ||
        previous.model.units[node.name] !== model.units[node.name] ||
        JSON.stringify(previous.model.controls[node.name]) !==
          JSON.stringify(model.controls[node.name])
      )
        dirty.add(node.name);
    }
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const node of model.nodes)
        if (!dirty.has(node.name) && node.deps.some((dep) => dirty.has(dep))) {
          dirty.add(node.name);
          expanded = true;
        }
    }
    const prior = previous.quantities ?? evaluate(previous.model).quantities;
    for (const node of model.nodes)
      if (!dirty.has(node.name) && prior[node.name]) {
        quantities[node.name] = JSON.parse(JSON.stringify(prior[node.name]));
        values[node.name] = quantities[node.name].baseValue;
        units[node.name] = quantities[node.name].unit;
        nodeStates[node.name] = "valid";
        reused++;
      }
  }
  class FailedNode extends Error {
    constructor(
      readonly name: string,
      readonly issue: Diagnostic,
    ) {
      super(issue.message);
    }
  }
  function fail(name: string, issue: Diagnostic, blocked = false): FailedNode {
    if (!failures.has(name)) {
      failures.set(name, issue);
      diagnostics.push(issue);
    }
    nodeStates[name] = blocked
      ? "blocked"
      : issue.code === "INCOMPLETE"
        ? "incomplete"
        : "error";
    return new FailedNode(name, failures.get(name)!);
  }
  function resolve(name: string): Quantity {
    const failed = failures.get(name);
    if (failed) throw new FailedNode(name, failed);
    if (name in quantities) return quantities[name];
    const node = byName.get(name);
    if (!node) throw new CalcError("UNDEFINED", `未定义变量 ${name}`);
    if (visiting.has(name)) {
      const cycle = path.slice(path.indexOf(name));
      for (const member of cycle) {
        const n = byName.get(member)!;
        fail(member, {
          code: "CYCLE",
          message: `循环引用 ${[...cycle, name].join(" → ")}`,
          line: n.line,
          variable: member,
        });
      }
      throw new FailedNode(name, failures.get(name)!);
    }
    if (visiting.size >= 128)
      throw fail(name, {
        code: "LIMIT",
        message: "依赖链超过 128",
        line: node.line,
        variable: name,
      });
    visiting.add(name);
    path.push(name);
    try {
      const value =
        node.kind === "input"
          ? inputQuantity(node.expression, model.units[name])
          : calc(
              asts.get(name) ?? parseExpression(node.expression).ast,
              resolve,
            );
      const declared = model.units[name];
      if (declared) {
        localValue(value, declared);
        value.unit = declared;
      }
      if (
        !new D(value.baseValue).isFinite() ||
        new D(value.baseValue).abs().gt("1e100")
      )
        throw new CalcError("LIMIT", "结果超出 ±1e100");
      if (value.absolute && new D(value.baseValue).lt(0))
        throw new CalcError("TEMPERATURE_RANGE", "绝对温度低于绝对零度（0 K）");
      quantities[name] = value;
      values[name] = value.baseValue;
      units[name] = value.unit;
      nodeStates[name] = "valid";
      evaluated++;
      return value;
    } catch (e) {
      if (e instanceof FailedNode) {
        if (failures.has(name)) throw new FailedNode(name, failures.get(name)!);
        throw fail(
          name,
          {
            code: "DEPENDENCY",
            message: `${name}：依赖 ${e.name}${e.issue.line ? `（第 ${e.issue.line} 行）` : ""}出错，暂时无法计算`,
            line: node.line,
            variable: name,
            details: {
              dependency: e.name,
              causeCode: e.issue.code,
              causeLine: e.issue.line,
            },
          },
          true,
        );
      }
      throw fail(name, diagnostic(e, node.line, name));
    } finally {
      visiting.delete(name);
      path.pop();
    }
  }
  for (const node of model.nodes) {
    if (globalFailure) {
      fail(
        node.name,
        {
          code: "DEPENDENCY",
          message: `计算区域无效：${globalFailure.message}`,
          line: node.line,
          variable: node.name,
        },
        true,
      );
    } else {
      try {
        resolve(node.name);
      } catch (e) {
        if (!(e instanceof FailedNode)) throw e;
      }
    }
  }
  const primary = diagnostics.filter((d) => d.code !== "DEPENDENCY");
  return {
    status: diagnostics.length
      ? primary.every((d) => d.code === "INCOMPLETE")
        ? "incomplete"
        : "error"
      : "valid",
    values,
    displayValues: Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        displayValue(value, units[name]),
      ]),
    ),
    units,
    quantities,
    nodeStates,
    diagnostics,
    policy: POLICY,
    stats: { evaluated, reused },
  };
}
export function validateQuantityControl(
  name: string,
  value: Quantity,
  c: Control = {},
) {
  const bound = (s: string) => inputQuantity(s, value.unit);
  const min = c.min !== undefined ? bound(c.min) : undefined,
    max = c.max !== undefined ? bound(c.max) : undefined,
    step =
      c.step !== undefined
        ? value.absolute
          ? quantity(
              literal(c.step).mul(parseUnit(value.unit).factor).toString(),
              "ΔK",
            )
          : bound(c.step)
        : undefined;
  for (const q of [min, max]) if (q) assertCompatible(value, q, "比较控件范围");
  if (step) assertCompatible(value, step, "比较步长", false);
  const v = new D(value.baseValue);
  if (min && max && new D(min.baseValue).gt(max.baseValue))
    throw new CalcError("CONTROL", "min 大于 max");
  if (step && !new D(step.baseValue).gt(0))
    throw new CalcError("CONTROL", "step 必须大于零");
  if ((min && v.lt(min.baseValue)) || (max && v.gt(max.baseValue)))
    throw new CalcError("RANGE", `${name} 超出范围`);
  if (c.integer && !localValue(value).isInteger())
    throw new CalcError("INTEGER", `${name} 必须为整数`);
  if (
    step &&
    !v
      .minus(min?.baseValue ?? 0)
      .mod(step.baseValue)
      .isZero()
  )
    throw new CalcError("STEP", `${name} 不符合步长 ${c.step}`);
  if (c.control === "slider" && (!min || !max || !step))
    throw new CalcError("CONTROL", "滑块需明确 min、max、step");
}
export type Change =
  | { op: "set_input"; name: string; literal: string }
  | { op: "set_formula"; name: string; expression: string }
  | { op: "rename"; name: string; newName: string }
  | { op: "set_unit"; name: string; unit: string };
export type Patch = {
  from: number;
  to: number;
  text: string;
  before: string;
  name: string;
};
export function validateUnit(unit: unknown): asserts unit is string {
  if (
    typeof unit !== "string" ||
    unit.length > 24 ||
    /[\r\n\x00-\x1f]/.test(unit) ||
    unit.includes("//") ||
    unit.includes("```")
  )
    throw new CalcError("UNIT", "单位限 24 字符，不能含换行或代码标记");
}
export function displayValue(value: string | undefined, unit = ""): string {
  if (value === undefined) return "—";
  const u = parseUnit(unit);
  const n = new D(value).minus(u.offset ?? 0).div(u.factor);
  const number = n.toNumber();
  const result =
    Number.isFinite(number) && (number !== 0 || n.isZero())
      ? number.toLocaleString("zh-CN", { maximumSignificantDigits: 12 })
      : n.toSignificantDigits(12).toString();
  return (
    result + (unit === "%" || unit === "‰" ? unit : unit ? " " + unit : "")
  );
}
function renameReferences(
  expression: string,
  names: Map<string, string>,
): string {
  let result = expression;
  for (const ref of parseExpression(expression).references.sort(
    (a, b) => b.from - a.from,
  ))
    if (names.has(ref.name))
      result =
        result.slice(0, ref.from) + names.get(ref.name) + result.slice(ref.to);
  return result;
}
export function patchModel(
  source: string,
  model: Model,
  changes: Change[],
  validate = true,
): { source: string; patches: Patch[] } {
  normalizeModelMaps(model);
  if (!Array.isArray(changes) || !changes.length || changes.length > 500)
    throw new CalcError("CHANGES", "需要 1–500 个修改");
  const seen = new Set<string>(),
    renames = new Map<string, string>(),
    edits = new Map<string, string>(),
    units = new Map<string, string>();
  for (const change of changes) {
    const key = change.op + ":" + change.name;
    if (seen.has(key)) throw new CalcError("CHANGES", "同一项目重复修改");
    seen.add(key);
    const node = model.nodes.find((n) => n.name === change.name);
    if (!node) throw new CalcError("UNDEFINED", `未定义 ${change.name}`);
    if (change.op === "rename") {
      if (
        typeof change.newName !== "string" ||
        /[\r\n]/.test(change.newName) ||
        !new RegExp(`^${ID}$`, "u").test(change.newName) ||
        change.newName.length > 128
      )
        throw new CalcError(
          "NAME",
          "名称以文字或下划线开头，只能包含文字、数字、下划线",
        );
      if (
        change.newName !== change.name &&
        model.nodes.some((n) => n.name === change.newName)
      )
        throw new CalcError("DUPLICATE", "名称已存在，不能重名");
      renames.set(change.name, change.newName);
    } else if (change.op === "set_unit") {
      validateUnit(change.unit);
      parseUnit(change.unit.trim());
      units.set(change.name, change.unit.trim());
    } else if (change.op === "set_input" || change.op === "set_formula") {
      if (node.kind !== (change.op === "set_input" ? "input" : "formula"))
        throw new CalcError("TYPE", "输入与公式不能互相覆盖");
      const text =
        change.op === "set_input" ? change.literal : change.expression;
      if (
        typeof text !== "string" ||
        /[\r\n]/.test(text) ||
        text.includes("//") ||
        text.includes("`") ||
        text.includes("<!--") ||
        text.includes("-->")
      )
        throw new CalcError("PATCH", "修改必须是单行表达式");
      if (change.op === "set_input")
        inputQuantity(text, model.units[node.name]);
      else parseExpression(text);
      edits.set(change.name, text);
    } else throw new CalcError("OP", "不支持的修改");
  }
  const controlEdits = new Map<string, Record<string, string>>();
  for (const [name, unit] of units) {
    const node = model.nodes.find((n) => n.name === name)!;
    if (node.kind !== "input") continue;
    const old = inputQuantity(node.expression, model.units[name]);
    if (unit && old.unit) {
      const converted = localValue(old, unit);
      if (!edits.has(name)) edits.set(name, converted.toString());
      const options: Record<string, string> = {};
      for (const key of ["min", "max", "step"] as const) {
        const val = model.controls[name]?.[key];
        if (val !== undefined) {
          if (key === "step" && old.absolute)
            options[key] = literal(val)
              .mul(parseUnit(old.unit).factor)
              .div(parseUnit(unit).factor)
              .toString();
          else
            options[key] = localValue(
              inputQuantity(val, old.unit),
              unit,
            ).toString();
        }
      }
      controlEdits.set(name, options);
    } else if (!unit && old.unit && !edits.has(name))
      edits.set(name, localValue(old).toString() + " " + old.unit);
  }
  const names = model.nodes.map((n) => renames.get(n.name) ?? n.name);
  if (new Set(names).size !== names.length)
    throw new CalcError("DUPLICATE", "名称已存在，不能重名");
  const patches: Patch[] = [];
  const add = (from: number, to: number, text: string, name: string) => {
    if (source.slice(from, to) !== text)
      patches.push({ from, to, text, before: source.slice(from, to), name });
  };
  for (const node of model.nodes) {
    if (renames.has(node.name))
      add(node.nameFrom, node.nameTo, renames.get(node.name)!, node.name);
    const expr = edits.get(node.name) ?? node.expression;
    add(
      node.from,
      node.to,
      node.kind === "formula" ? renameReferences(expr, renames) : expr,
      node.name,
    );
  }
  const existingUnits = new Set<string>();
  for (const d of model.directives) {
    const name = d.name,
      rest = source.slice(d.argumentFrom, d.argumentTo);
    if (d.kind === "unit") {
      existingUnits.add(name);
      if (units.has(name)) {
        const unit = units.get(name)!;
        if (!unit) add(d.from, d.to, "", name);
        else
          add(
            d.nameFrom,
            d.argumentTo,
            (renames.get(name) ?? name) +
              rest.match(/^\s*/)![0] +
              (rest.trimStart().startsWith('"') || /\s/.test(unit)
                ? JSON.stringify(unit)
                : unit),
            name,
          );
      } else if (renames.has(name))
        add(d.nameFrom, d.nameTo, renames.get(name)!, name);
    } else {
      let options = rest;
      for (const [key, value] of Object.entries(controlEdits.get(name) ?? {}))
        options = options.replace(
          new RegExp(`(\\s${key}=)[^\\s]+`),
          (_, prefix) => prefix + value,
        );
      add(
        d.nameFrom,
        d.argumentTo,
        (renames.get(name) ?? name) + options,
        name,
      );
    }
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const additions = [...units]
    .filter(([name, unit]) => unit && !existingUnits.has(name))
    .map(([name, unit]) =>
      model.format === "markdown"
        ? `<!-- notecalc:unit ${renames.get(name) ?? name} ${JSON.stringify(unit)} -->${newline}`
        : `// @unit ${renames.get(name) ?? name} ${JSON.stringify(unit)}${newline}`,
    )
    .join("");
  if (additions) add(model.to, model.to, additions, "单位");
  let next = source;
  for (const p of [...patches].sort((a, b) => b.from - a.from))
    next = next.slice(0, p.from) + p.text + next.slice(p.to);
  const parsed = models(next);
  const updated = parsed.find((m) => m.id === model.id);
  if (
    !updated ||
    parsed.some((m) => m.diagnostics.some((d) => d.code === "DUP_MODEL"))
  )
    throw new CalcError("MODEL", "模型定位失败");
  if (validate) {
    const result = evaluate(updated);
    if (result.status !== "valid")
      throw new CalcError(
        "INVALID_MODEL",
        result.diagnostics.map((d) => d.message).join("；"),
        undefined,
        { diagnostics: result.diagnostics },
      );
  }
  return { source: next, patches };
}
