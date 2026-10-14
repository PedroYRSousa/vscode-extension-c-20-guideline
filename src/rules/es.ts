import type { Node } from 'web-tree-sitter';
import { ancestor, field, functionDeclarator, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { alwaysJumps, caseBody, declPrefix, isZeroLiteral } from './util.js';

// ---------------------------------------------------------------------------------------------
// ES.47  Use nullptr rather than 0 or NULL
// ---------------------------------------------------------------------------------------------
const nullptrCheck: Check = {
  name: 'ES.47 nullptr',
  covers: ['ES.47'],
  run(ctx) {
    const report = (node: Node, what: string): void => {
      ctx.report({
        ruleId: 'ES.47',
        node,
        message: t('Use nullptr rather than {0}.', what),
        fixes: [ctx.fix(t('Replace with nullptr'), [ctx.replace(node, 'nullptr')])],
      });
    };

    for (const n of ctx.nodesOf('null')) if (n.text === 'NULL') report(n, 'NULL');

    const zero = (n: Node | null): n is Node => !!n && n.type === 'number_literal' && isZeroLiteral(n.text);
    const isPointerName = (n: Node | null): boolean => {
      if (!n || n.type !== 'identifier') return false;
      const v = ctx.symbols.resolve(n.text, n);
      return !!v && v.pointer && !v.array;
    };

    // T* p = 0;   T* p{0};
    for (const d of ctx.nodesOf('init_declarator')) {
      const value = field(d, 'value');
      if (zero(value) && shapeOf(d).pointer) report(value, '0');
    }
    // void f(T* p = 0)
    for (const d of ctx.nodesOf('optional_parameter_declaration')) {
      const value = field(d, 'default_value');
      if (zero(value) && shapeOf(field(d, 'declarator')).pointer) report(value, '0');
    }
    // p = 0;   p == 0;   0 != p;
    for (const e of ctx.nodesOf('assignment_expression')) {
      const left = field(e, 'left');
      const right = field(e, 'right');
      if (e.child(1)?.text === '=' && zero(right) && isPointerName(left)) report(right, '0');
    }
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text;
      if (op !== '==' && op !== '!=') continue;
      const left = field(e, 'left');
      const right = field(e, 'right');
      if (zero(right) && isPointerName(left)) report(right, '0');
      else if (zero(left) && isPointerName(right)) report(left, '0');
    }
    // T* f() { return 0; }
    for (const r of ctx.nodesOf('return_statement')) {
      const value = namedKids(r).find((n) => n.type !== 'comment');
      if (!zero(value ?? null)) continue;
      const fn = ancestor(r, 'function_definition');
      if (!fn) continue;
      const shape = shapeOf(field(fn, 'declarator'));
      if (shape.isFunction && shape.pointer && !ancestor(r, 'lambda_expression')) report(value!, '0');
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.10 / NL.21  Declare one name (only) per declaration
// ---------------------------------------------------------------------------------------------
function splitDeclaration(ctx: Context, decl: Node): Fix | null {
  const parent = decl.parent;
  if (!parent || !['compound_statement', 'translation_unit', 'declaration_list', 'field_declaration_list', 'case_statement'].includes(parent.type)) {
    return null;
  }
  const declarators = decl.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
  const prefix = declPrefix(ctx, decl).trimEnd();
  const eol = ctx.eol;
  const indent = ctx.indentAt(decl.startIndex);
  const lines = declarators.map((d) => {
    const text = ctx.src(d);
    const m = /^([*&]+)\s*([\s\S]*)$/.exec(text);
    return m ? `${prefix}${m[1]} ${m[2]};` : `${prefix} ${text};`;
  });
  return ctx.fix(t('Split into one declaration per name'), [ctx.replace(decl, lines.join(eol + indent))]);
}

const oneNameCheck: Check = {
  name: 'ES.10 one name per declaration',
  covers: ['ES.10', 'NL.21'],
  run(ctx) {
    for (const decl of ctx.nodesOf('declaration', 'field_declaration')) {
      const declarators = decl.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      if (declarators.length < 2) continue;
      if (declarators.some((d) => shapeOf(d).isFunction)) continue;
      if (ancestor(decl, 'type_definition')) continue;
      const fix = splitDeclaration(ctx, decl);
      ctx.report({
        ruleId: 'ES.10',
        alsoCovers: ['NL.21'],
        start: declarators[1].startIndex,
        end: declarators[declarators.length - 1].endIndex,
        message: t('Declare one name (only) per declaration.'),
        fixes: fix ? [fix] : [],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.30 / ES.31 / ES.32 / NL.9 / Enum.1  Macros
// ---------------------------------------------------------------------------------------------
function renameEverywhere(ctx: Context, from: string, to: string, skip: Node): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const n of ctx.nodesOf('identifier', 'type_identifier', 'field_identifier', 'namespace_identifier')) {
    if (n.text === from && !(n.startIndex >= skip.startIndex && n.endIndex <= skip.endIndex)) edits.push(ctx.replace(n, to));
  }
  return edits;
}

export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toLowerCase();
}

const SIMPLE_CONSTANT = /^(?:[-+]?(?:0[xX][0-9a-fA-F']+|0[bB][01']+|[0-9][0-9']*(?:\.[0-9']*)?(?:[eE][-+]?[0-9]+)?)[uUlLfFzZ]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')$/;
const INTEGER_CONSTANT = /^[-+]?(?:0[xX][0-9a-fA-F']+|0[bB][01']+|[0-9][0-9']*)[uUlL]*$/;

const macroCheck: Check = {
  name: 'ES.30/31/32 macros',
  covers: ['ES.30', 'ES.31', 'ES.32', 'NL.9', 'Enum.1'],
  run(ctx) {
    for (const def of ctx.nodesOf('preproc_def', 'preproc_function_def')) {
      const nameNode = field(def, 'name');
      if (!nameNode) continue;
      const name = nameNode.text;
      const valueNode = field(def, 'value');
      const value = valueNode ? valueNode.text.trim().replace(/\s*\\\s*$/, '') : '';
      const functionLike = def.type === 'preproc_function_def';

      // ES.32 / NL.9: macro names are ALL_CAPS
      if (/[a-z]/.test(name)) {
        const upper = name.toUpperCase();
        ctx.report({
          ruleId: 'ES.32',
          alsoCovers: ['NL.9'],
          node: nameNode,
          message: t('Macro names must be ALL_CAPS ("{0}").', name),
          fixes: [ctx.fix(t('Rename macro to {0}', upper), [ctx.replace(nameNode, upper), ...renameEverywhere(ctx, name, upper, def)], 'unsafe')],
        });
      }

      // ES.30 / ES.31: no macros for constants, "functions" or text manipulation; Enum.1 for integer values
      if (!functionLike && value === '') continue; // `#define X` / include guards: source control
      const constant = !functionLike && SIMPLE_CONSTANT.test(value);
      const fixes: Fix[] = [];
      if (constant && /^[A-Za-z_]\w*$/.test(name)) {
        const newName = toSnakeCase(name);
        const edits: TextEdit[] = [
          ctx.replace(def, `inline constexpr auto ${newName} = ${value};${/\r?\n$/.test(ctx.src(def)) ? ctx.eol : ''}`),
          ...renameEverywhere(ctx, name, newName, def),
        ];
        fixes.push(ctx.fix(t('Replace with "inline constexpr auto {0}"', newName), edits, 'unsafe'));
      }
      const alsoCovers = ['ES.30'];
      if (!functionLike && INTEGER_CONSTANT.test(value)) alsoCovers.push('Enum.1');
      ctx.report({
        ruleId: 'ES.31',
        alsoCovers,
        node: nameNode,
        message: functionLike
          ? t('Do not use a macro for a "function"; use a constexpr function, a template or a lambda.')
          : t('Do not use a macro for a constant; use constexpr (or an enum for related integers).'),
        fixes,
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.34 / F.55  C-style variadics and <cstdarg>
// ---------------------------------------------------------------------------------------------
const VA_NAMES = new Set(['va_list', 'va_start', 'va_arg', 'va_end', 'va_copy']);

const variadicCheck: Check = {
  name: 'ES.34/F.55 C variadics',
  covers: ['ES.34', 'F.55'],
  run(ctx) {
    for (const fn of ctx.nodesOf('function_definition')) {
      const fd = functionDeclarator(field(fn, 'declarator'));
      const params = fd ? field(fd, 'parameters') : null;
      const dots = params ? kids(params).find((c) => c.type === '...') : undefined;
      if (dots) {
        ctx.report({
          ruleId: 'ES.34',
          alsoCovers: ['F.55'],
          node: dots,
          message: t('Do not define a C-style variadic function; use a variadic template or std::initializer_list.'),
        });
      }
    }
    for (const inc of ctx.nodesOf('preproc_include')) {
      const path = field(inc, 'path')?.text ?? '';
      if (/^[<"](?:cstdarg|stdarg\.h)[>"]$/.test(path)) {
        ctx.report({
          ruleId: 'ES.34',
          alsoCovers: ['F.55'],
          node: inc,
          message: t('<cstdarg> is for C-style variadic functions; use a variadic template or std::initializer_list.'),
        });
      }
    }
    for (const id of ctx.nodesOf('identifier', 'type_identifier')) {
      if (VA_NAMES.has(id.text)) {
        ctx.report({
          ruleId: 'F.55',
          alsoCovers: ['ES.34'],
          node: id,
          message: t('Do not use va_list/va_start/va_arg; use a variadic template or std::initializer_list.'),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.48 / ES.49 / ES.50 / ES.64  Casts
// ---------------------------------------------------------------------------------------------
const CAST_TYPE_NODES = new Set(['primitive_type', 'sized_type_specifier']);

const castCheck: Check = {
  name: 'ES.48/49/50/64 casts',
  covers: ['ES.48', 'ES.49', 'ES.50', 'ES.64'],
  run(ctx) {
    // (T)e
    for (const c of ctx.nodesOf('cast_expression')) {
      const type = field(c, 'type');
      const value = field(c, 'value');
      if (!type || !value) continue;
      const toVoid = type.text.trim() === 'void';
      const operand = value.type === 'parenthesized_expression' ? ctx.src(value).slice(1, -1) : ctx.src(value);
      ctx.report({
        ruleId: 'ES.49',
        alsoCovers: ['ES.48', 'ES.64'],
        node: c,
        message: toVoid
          ? t('Avoid the C-style cast to void; mark the variable [[maybe_unused]] or leave the parameter unnamed.')
          : t('Do not use C-style casts; use a named cast (static_cast, ...) or T{e}.'),
        fixes: [ctx.fix(t('Use static_cast'), [ctx.replace(c, `static_cast<${ctx.src(type)}>(${operand})`)])],
      });
    }

    // const_cast / reinterpret_cast
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'template_function') continue;
      const name = field(fn, 'name')?.text;
      if (name === 'const_cast') {
        ctx.report({
          ruleId: 'ES.50',
          node: call,
          message: t("Don't cast away const; fix the const-correctness of the design instead."),
        });
      } else if (name === 'reinterpret_cast') {
        ctx.report({
          ruleId: 'ES.48',
          node: call,
          message: t('Avoid reinterpret_cast; it defeats the type system (use std::bit_cast, std::span or a proper abstraction).'),
        });
      }
    }

    // T(e) with a builtin type: a functional-style cast
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (!fn || !CAST_TYPE_NODES.has(fn.type)) continue;
      const args = field(call, 'arguments');
      const items = args ? namedKids(args) : [];
      if (items.length !== 1) continue;
      const arg = ctx.src(items[0]);
      ctx.report({
        ruleId: 'ES.64',
        alsoCovers: ['ES.48', 'ES.49'],
        node: call,
        message: t('Use the T{e} notation (or static_cast) instead of the functional cast {0}(e).', ctx.src(fn)),
        fixes: [
          ctx.fix(t('Use static_cast'), [ctx.replace(call, `static_cast<${ctx.src(fn)}>(${arg})`)]),
          ctx.fix(t('Use T{e} (rejects narrowing at compile time)'), [ctx.replace(call, `${ctx.src(fn)}{${arg}}`)], 'unsafe'),
        ],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.75 / ES.76  do-statements and goto
// ---------------------------------------------------------------------------------------------
const doGotoCheck: Check = {
  name: 'ES.75/76 do and goto',
  covers: ['ES.75', 'ES.76'],
  run(ctx) {
    for (const d of ctx.nodesOf('do_statement')) {
      ctx.report({ ruleId: 'ES.75', start: d.startIndex, end: d.startIndex + 2, message: t('Avoid do-statements; prefer a for or while loop.') });
    }
    for (const g of ctx.nodesOf('goto_statement')) {
      ctx.report({ ruleId: 'ES.76', node: g, message: t('Avoid goto; use structured control flow, RAII or a function.') });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.78  No implicit fallthrough;  ES.79 / Enum.2  Switch over an enumeration
// ---------------------------------------------------------------------------------------------
function isExplicitFallthrough(stmt: Node | null): boolean {
  return !!stmt && stmt.type === 'attributed_statement' && /\bfallthrough\b/.test(stmt.text);
}

const switchCheck: Check = {
  name: 'ES.78/79 switch',
  covers: ['ES.78', 'ES.79', 'Enum.2'],
  run(ctx) {
    for (const sw of ctx.nodesOf('switch_statement')) {
      const body = field(sw, 'body');
      if (!body) continue;
      const cases = namedKids(body).filter((n) => n.type === 'case_statement');

      // ES.78
      cases.forEach((c, i) => {
        if (i === cases.length - 1) return;
        const stmts = caseBody(c);
        if (stmts.length === 0) return; // grouped labels
        const last = stmts[stmts.length - 1];
        if (isExplicitFallthrough(last) || alwaysJumps(last)) return;
        const indent = ctx.indentAt(last.startIndex);
        const sameLine = !ctx.startsLine(last.startIndex);
        const insert = (text: string): TextEdit => ctx.insertAt(last.endIndex, sameLine ? ` ${text}` : `${ctx.eol}${indent}${text}`);
        ctx.report({
          ruleId: 'ES.78',
          node: c,
          end: (kids(c).find((k) => k.type === ':')?.endIndex ?? c.startIndex + 4),
          message: t("Don't rely on implicit fallthrough in switch statements; end the case with break/return or mark it [[fallthrough]]."),
          fixes: [
            ctx.fix(t('Mark the fallthrough as intentional'), [insert('[[fallthrough]];')]),
            ctx.fix(t('Add break'), [insert('break;')], 'unsafe'),
          ],
        });
      });

      // ES.79 / Enum.2: enumerators not handled and no default
      if (cases.some((c) => !field(c, 'value'))) continue; // has default
      const labels = cases.map((c) => field(c, 'value')).filter((n): n is Node => !!n);
      if (labels.length === 0) continue;
      const enums = collectEnums(ctx);
      const wanted = labels.map((l) => splitLabel(l));
      for (const e of enums) {
        const matches = wanted.every((w) =>
          e.names.includes(w.name) && (e.scoped ? w.scope === e.name : w.scope === null || w.scope === e.name));
        if (!matches) continue;
        const handled = new Set(wanted.map((w) => w.name));
        const missing = e.names.filter((n) => !handled.has(n));
        if (missing.length === 0) break;
        const last = cases[cases.length - 1];
        const caseIndent = ctx.indentAt(last.startIndex);
        const qualify = (n: string): string => (e.scoped || wanted.some((w) => w.scope !== null) ? `${e.name}::${n}` : n);
        const text = missing.map((m) => `${ctx.eol}${caseIndent}case ${qualify(m)}:${ctx.eol}${caseIndent}${ctx.indentUnit}break;`).join('');
        const insertAt = last.endIndex;
        ctx.report({
          ruleId: 'ES.79',
          alsoCovers: ['Enum.2'],
          start: sw.startIndex,
          end: field(sw, 'condition')?.endIndex ?? sw.startIndex + 6,
          message: t('switch over enumeration {0} does not handle {1} and has no default.', e.name, missing.join(', ')),
          fixes: [ctx.fix(t('Add the missing cases'), [ctx.insertAt(insertAt, text)])],
        });
        break;
      }
    }
  },
};

interface EnumInfo {
  name: string;
  scoped: boolean;
  names: string[];
}

function collectEnums(ctx: Context): EnumInfo[] {
  const out: EnumInfo[] = [];
  for (const e of ctx.nodesOf('enum_specifier')) {
    const name = field(e, 'name');
    const body = field(e, 'body');
    if (!name || !body) continue;
    const names = namedKids(body)
      .filter((n) => n.type === 'enumerator')
      .map((n) => field(n, 'name')?.text ?? '')
      .filter(Boolean);
    out.push({ name: name.text, scoped: /^enum\s+(?:class|struct)\b/.test(ctx.src(e)), names });
  }
  return out;
}

function splitLabel(label: Node): { scope: string | null; name: string } {
  if (label.type === 'qualified_identifier') {
    const scope = field(label, 'scope')?.text ?? null;
    const name = field(label, 'name')?.text ?? label.text;
    return { scope, name };
  }
  return { scope: null, name: label.text };
}

// ---------------------------------------------------------------------------------------------
// ES.85  Make empty statements visible
// ---------------------------------------------------------------------------------------------
const emptyStatementCheck: Check = {
  name: 'ES.85 empty statements',
  covers: ['ES.85'],
  run(ctx) {
    for (const s of ctx.nodesOf('expression_statement')) {
      if (s.namedChildCount !== 0 || s.text !== ';') continue;
      const parent = s.parent;
      if (!parent) continue;
      if (parent.type === 'compound_statement' || parent.type === 'case_statement') {
        const hasComment = ctx.slice(s.endIndex, ctx.lineEnd(ctx.lineOf(s.endIndex))).includes('//');
        if (hasComment) continue;
        ctx.report({
          ruleId: 'ES.85',
          node: s,
          message: t('Make empty statements visible: remove the stray ";".'),
          fixes: [ctx.fix(t('Remove the empty statement'), [ctx.remove(s)])],
        });
      } else if (['for_statement', 'while_statement', 'if_statement', 'else_clause', 'for_range_loop'].includes(parent.type)) {
        const hasComment = ctx.slice(s.endIndex, ctx.lineEnd(ctx.lineOf(s.endIndex))).includes('//');
        if (hasComment) continue;
        ctx.report({
          ruleId: 'ES.85',
          node: s,
          message: t('Make empty statements visible: use an explicit empty block {} or a comment.'),
          fixes: [ctx.fix(t('Replace with an empty block'), [ctx.replace(s, '{}')])],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.105  Don't divide by integer zero
// ---------------------------------------------------------------------------------------------
const divideByZeroCheck: Check = {
  name: 'ES.105 division by zero',
  covers: ['ES.105'],
  run(ctx) {
    const flag = (node: Node): void =>
      ctx.report({ ruleId: 'ES.105', node, message: t("Don't divide by integer zero.") });
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text;
      const right = field(e, 'right');
      if ((op === '/' || op === '%') && right?.type === 'number_literal' && isZeroLiteral(right.text)) flag(e);
    }
    for (const e of ctx.nodesOf('assignment_expression')) {
      const op = field(e, 'operator')?.text;
      const right = field(e, 'right');
      if ((op === '/=' || op === '%=') && right?.type === 'number_literal' && isZeroLiteral(right.text)) flag(e);
    }
  },
};

export const esChecks: Check[] = [
  nullptrCheck,
  oneNameCheck,
  macroCheck,
  variadicCheck,
  castCheck,
  doGotoCheck,
  switchCheck,
  emptyStatementCheck,
  divideByZeroCheck,
];
