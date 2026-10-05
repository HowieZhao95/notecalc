import { CalcError } from "./numeric";
import { parseUnit } from "./units";

export type Diagnostic = {
  code: string;
  message: string;
  line?: number;
  variable?: string;
  details?: Record<string, unknown>;
};
export type Node = {
  name: string;
  kind: "input" | "formula";
  expression: string;
  line: number;
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
  deps: string[];
};
export type Control = {
  control?: "slider" | "number";
  min?: string;
  max?: string;
  step?: string;
  integer?: boolean;
};
export type Directive = {
  kind: "input" | "output" | "unit";
  name: string;
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
  argumentFrom: number;
  argumentTo: number;
};
export type Model = {
  id: string;
  identity: "explicit" | "position";
  format: "block" | "markdown";
  version: string;
  from: number;
  bodyFrom: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  nodes: Node[];
  controls: Record<string, Control>;
  outputs: string[];
  units: Record<string, string>;
  directives: Directive[];
  diagnostics: Diagnostic[];
};
export const IDENTIFIER = "[\\p{L}_][\\p{L}\\p{N}_]*";
const assignment = new RegExp(
  `^([ \\t]*)(${IDENTIFIER})([ \\t]*)(:=|=)([ \\t]*)(.*)$`,
  "u",
);

// A numeric literal is editable input; all other RHS values are formulas.
// Classification does not execute code, infer names, or discard unknown units.
export function isInputExpression(expression: string) {
  const m = expression
    .trim()
    .match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?(.*)$/);
  if (!m) return false;
  const rest = m[1].trim();
  if (!rest) return true;
  try {
    parseUnit(rest.replace(/^\[(.*)\]$/, "$1"));
    return true;
  } catch {}
  return /^(?:[\p{L}µμΔ°℃‰%]+|\[[^\]\r\n]+\])$/u.test(rest);
}
function error(e: unknown, line: number, variable?: string): Diagnostic {
  return {
    code: e instanceof CalcError ? e.code : "SYNTAX",
    message: e instanceof Error ? e.message : String(e),
    line,
    variable,
  };
}

// Workers and JSON normalize null-prototype objects back to plain objects.
// Restore dictionaries before lookup so names never resolve inherited members.
export function normalizeModelMaps(model: Model) {
  model.controls = Object.assign(Object.create(null), model.controls);
  model.units = Object.assign(Object.create(null), model.units);
}

type ListValue = {
  name: string;
  bold: boolean;
  nameOffset: number;
  valueOffset: number;
  expression: string;
};
function listValue(line: string): ListValue | undefined {
  const prefix = line.match(
    new RegExp(
      `^([ \\t]*[-+*][ \\t]+)(\\*\\*)?(${IDENTIFIER})(\\*\\*)?([ \\t]*[：:][ \\t]*)`,
      "u",
    ),
  );
  if (!prefix) return;
  if (!!prefix[2] !== !!prefix[4])
    throw new CalcError("SYNTAX", "名称的粗体标记未闭合");
  const start = prefix[0].length;
  let opening = start;
  while (line[opening] === "`") opening++;
  const count = opening - start;
  if (!count) return;
  if (count > 64)
    throw new CalcError("LIMIT", "行内代码分隔符超过 64 个反引号");
  // Scan delimiter runs once rather than a backtracking regexp/backreference.
  let position = opening,
    close = -1;
  while (position < line.length) {
    if (line[position] !== "`") {
      position++;
      continue;
    }
    const run = position;
    while (line[position] === "`") position++;
    if (position - run === count) {
      close = run;
      break;
    }
  }
  if (close < 0) throw new CalcError("INCOMPLETE", "行内代码缺少结束反引号");
  if (!/^\s*(?:<!--.*-->)?\s*$/.test(line.slice(close + count)))
    throw new CalcError("SYNTAX", "算式后只允许空白或注释");
  const raw = line.slice(opening, close),
    expression = raw.trim();
  if (expression.length > 4096)
    throw new CalcError("LIMIT", "表达式长度超过 4096");
  return {
    name: prefix[3],
    bold: !!prefix[2],
    nameOffset: prefix[1].length + (prefix[2]?.length ?? 0),
    valueOffset: opening + raw.length - raw.trimStart().length,
    expression,
  };
}

/** Host-independent Markdown discovery with byte-for-byte source ranges. */
export function models(source: string): Model[] {
  if (source.length > 2_000_000)
    throw new CalcError("LIMIT", "文档超过 2 MB 字符限制");
  const lines = source.split("\n"),
    result: Model[] = [];
  let offset = 0,
    active: Model | undefined,
    fence = "",
    comment = false;
  let block: Model | undefined;
  const begin = (
    format: Model["format"],
    start: number,
    bodyFrom: number,
    line: number,
    id = "",
  ): Model => {
    const m: Model = {
      id: id || (format === "block" ? "block-" : "note-") + (result.length + 1),
      identity: id ? "explicit" : "position",
      format,
      version: "1",
      from: start,
      bodyFrom,
      to: source.length,
      lineFrom: line,
      lineTo: lines.length,
      nodes: [],
      controls: Object.create(null),
      outputs: [],
      units: Object.create(null),
      directives: [],
      diagnostics: [],
    };
    result.push(m);
    return m;
  };
  const directive = (
    m: Model,
    kind: string,
    arg: string,
    from: number,
    to: number,
    argFrom: number,
    argTo: number,
    line: number,
  ) => {
    if (kind === "model") {
      if (m.identity === "explicit")
        m.diagnostics.push({
          code: "DUP_MODEL_DIRECTIVE",
          message: "重复模型标识",
          line,
        });
      m.id = arg.trim();
      m.identity = "explicit";
      return;
    }
    if (kind === "version") {
      m.version = arg.trim();
      if (m.version !== "1")
        m.diagnostics.push({
          code: "VERSION",
          message: "仅支持模型语法版本 1",
          line,
        });
      return;
    }
    if (!["input", "output", "unit"].includes(kind)) {
      m.diagnostics.push({
        code: "DIRECTIVE",
        message: `未知指令 @${kind}`,
        line,
      });
      return;
    }
    const part = arg.match(new RegExp(`^(${IDENTIFIER})(.*)$`, "u"));
    if (!part) {
      m.diagnostics.push({
        code: "DIRECTIVE",
        message: "指令需要合法变量名",
        line,
      });
      return;
    }
    const [, name, rest] = part;
    m.directives.push({
      kind: kind as Directive["kind"],
      name,
      from,
      to,
      nameFrom: argFrom,
      nameTo: argFrom + name.length,
      argumentFrom: argFrom + name.length,
      argumentTo: argTo,
    });
    if (kind === "output") {
      if (rest.trim())
        m.diagnostics.push({
          code: "OUTPUT",
          message: "output 只接受一个名称",
          line,
          variable: name,
        });
      m.outputs.push(name);
      return;
    }
    if (kind === "unit") {
      try {
        const raw = rest.trim(),
          unit = raw.startsWith('"') ? JSON.parse(raw) : raw;
        if (
          typeof unit !== "string" ||
          !unit ||
          unit.length > 24 ||
          /[\r\n\x00-\x1f]/.test(unit)
        )
          throw new CalcError("UNIT", "需要合法单位");
        if (name in m.units) throw new CalcError("UNIT", "重复单位标注");
        m.units[name] = unit;
      } catch (e) {
        m.diagnostics.push(error(e, line, name));
      }
      return;
    }
    const c: Control = {};
    for (const option of rest.trim().split(/\s+/).filter(Boolean)) {
      const [k, v] = option.split("=");
      if (k === "integer" && (v === undefined || v === "true"))
        c.integer = true;
      else if (k === "integer" && v === "false") c.integer = false;
      else if (k === "control" && ["number", "slider"].includes(v))
        c.control = v as Control["control"];
      else if (["min", "max", "step"].includes(k) && v) (c as any)[k] = v;
      else
        m.diagnostics.push({
          code: "CONTROL",
          message: `未知约束 ${option}`,
          line,
          variable: name,
        });
    }
    if (m.controls[name])
      m.diagnostics.push({
        code: "CONTROL",
        message: `重复约束 ${name}`,
        line,
        variable: name,
      });
    m.controls[name] = c;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i],
      line = raw.replace(/\r$/, ""),
      start = offset;
    offset += raw.length + 1;
    const text = line.trim();
    if (!fence && comment) {
      if (text.includes("-->")) comment = false;
      continue;
    }
    if (!fence && text.startsWith("<!--") && !text.includes("-->")) {
      comment = true;
      continue;
    }
    const fm = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        fm &&
        fm[1][0] === fence[0] &&
        fm[1].length >= fence.length &&
        !fm[2].trim()
      ) {
        if (block) {
          block.to = start;
          block.lineTo = i + 1;
          active = undefined;
          block = undefined;
        }
        fence = "";
        continue;
      }
      if (!block) continue;
    } else if (fm) {
      fence = fm[1];
      if (fm[2].trim() === "notecalc" && !active) {
        active = block = begin("block", start, offset, i + 1);
      }
      continue;
    }
    if (!fence) {
      const open = line.match(
        /^ {0,3}<!--\s*notecalc(?:\s+id=([A-Za-z0-9_-]+))?\s*-->\s*$/,
      );
      if (open) {
        if (active)
          active.diagnostics.push({
            code: "NESTED_MODEL",
            message: "计算区域不能嵌套",
            line: i + 1,
          });
        else active = begin("markdown", start, offset, i + 1, open[1]);
        continue;
      }
      if (/^ {0,3}<!--\s*\/notecalc\s*-->\s*$/.test(line)) {
        if (active?.format === "markdown") {
          active.to = start;
          active.lineTo = i + 1;
          active = undefined;
        }
        continue;
      }
    }
    if (!active || !text) continue;
    if (active.format === "block" && text.startsWith("//")) {
      const dm = line.match(/^\s*\/\/\s*@([a-z]+)\s+(.+?)\s*$/);
      if (dm) {
        const argFrom =
          start + line.indexOf(dm[2], line.indexOf("@") + dm[1].length + 1);
        directive(
          active,
          dm[1],
          dm[2],
          start,
          start + raw.length + (source[start + raw.length] === "\n" ? 1 : 0),
          argFrom,
          argFrom + dm[2].length,
          i + 1,
        );
      }
      continue;
    }
    if (active.format === "markdown") {
      const dm = line.match(/^\s*<!--\s*notecalc:([a-z]+)\s+(.+?)\s*-->\s*$/);
      if (dm) {
        const argFrom =
          start + line.indexOf(dm[2], line.indexOf(":") + dm[1].length + 1);
        directive(
          active,
          dm[1],
          dm[2],
          start,
          start + raw.length + (source[start + raw.length] === "\n" ? 1 : 0),
          argFrom,
          argFrom + dm[2].length,
          i + 1,
        );
        continue;
      }
      // Indented code is documentation, including examples within a region.
      if (/^(?: {4}|\t)/.test(line)) continue;
      let n: ListValue | undefined;
      try {
        n = listValue(line);
      } catch (e) {
        const name = line.match(
          new RegExp(`^[ \\t]*[-+*][ \\t]+(?:\\*\\*)?(${IDENTIFIER})`, "u"),
        )?.[1];
        active.diagnostics.push(error(e, i + 1, name));
        continue;
      }
      if (!n) {
        if (/^[ \t]*[-+*]\s+.*[：:]\s*`/.test(line))
          active.diagnostics.push({
            code: "SYNTAX",
            message: "计算列表需要：- 名称：`数值或算式`",
            line: i + 1,
          });
        continue;
      }
      const nameFrom = start + n.nameOffset,
        from = start + n.valueOffset;
      active.nodes.push({
        name: n.name,
        kind: isInputExpression(n.expression) ? "input" : "formula",
        expression: n.expression,
        line: i + 1,
        from,
        to: from + n.expression.length,
        nameFrom,
        nameTo: nameFrom + n.name.length,
        deps: [],
      });
      if (n.bold) active.outputs.push(n.name);
    } else {
      const a = line.match(assignment);
      if (!a) {
        active.diagnostics.push({
          code: /[=:]\s*$/.test(text) ? "INCOMPLETE" : "SYNTAX",
          message: "需要 名称 = 数值或算式",
          line: i + 1,
        });
        continue;
      }
      const comment = a[6].indexOf("//"),
        exprRaw = comment < 0 ? a[6] : a[6].slice(0, comment),
        expression = exprRaw.trimEnd();
      const nameFrom = start + a[1].length,
        from = nameFrom + a[2].length + a[3].length + a[4].length + a[5].length;
      active.nodes.push({
        name: a[2],
        kind:
          a[4] === "=" && isInputExpression(expression) ? "input" : "formula",
        expression,
        line: i + 1,
        from,
        to: from + expression.length,
        nameFrom,
        nameTo: nameFrom + a[2].length,
        deps: [],
      });
    }
    if (active.nodes.length > 500)
      throw new CalcError("LIMIT", "单模型超过 500 个变量");
  }
  if (active)
    active.diagnostics.push({
      code: "INCOMPLETE",
      message:
        active.format === "block"
          ? "计算区域的围栏未闭合"
          : "计算区域缺少 <!-- /notecalc -->",
      line: active.lineFrom,
    });
  const ids = new Set<string>();
  for (const m of result) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(m.id))
      m.diagnostics.push({
        code: "MODEL_ID",
        message: "模型标识限字母数字、下划线、连字符",
      });
    if (ids.has(m.id))
      m.diagnostics.push({
        code: "DUP_MODEL",
        message: `重复模型标识 ${m.id}`,
      });
    ids.add(m.id);
  }
  return result;
}
