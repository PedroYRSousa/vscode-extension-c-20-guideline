import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { callArgs, isZeroLiteral } from './util.js';

const CONCEPT_CHOICES = ['std::regular', 'std::copyable', 'std::movable', 'std::integral', 'std::floating_point', 'std::equality_comparable', 'std::totally_ordered'];

function templateTarget(tpl: Node): Node | null {
  return namedKids(tpl).find((k) => !['template_parameter_list', 'requires_clause', 'comment'].includes(k.type)) ?? null;
}

function isPartialSpecialization(target: Node | null): boolean {
  if (!target) return false;
  const name = field(target, 'name');
  if (name?.type === 'template_type') return true;
  const decl = field(target, 'declarator');
  return decl?.type === 'function_declarator' && field(decl, 'declarator')?.type === 'template_function';
}

function constraintMentions(tpl: Node, target: Node | null, name: string): boolean {
  const clauses: Node[] = [];
  const own = kids(tpl).find((k) => k.type === 'requires_clause');
  if (own) clauses.push(own);
  if (target) for (const rc of target.descendantsOfType('requires_clause')) if (rc) clauses.push(rc);
  return clauses.some((c) => c.descendantsOfType(['identifier', 'type_identifier']).some((n) => n?.text === name));
}

/** Source text of a requires-clause constraint (the grammar attaches the field to parentheses as well). */
function constraintSource(ctx: Context, rc: Node): string {
  const parts = rc.childrenForFieldName('constraint').filter((n): n is Node => n !== null);
  if (parts.length === 0) return '';
  return ctx.slice(parts[0].startIndex, parts[parts.length - 1].endIndex);
}

function conceptFixes(ctx: Context, replace: Node, rebuild: (concept: string) => string): Fix[] {
  return CONCEPT_CHOICES.map((c) =>
    ctx.fix(t('Constrain it with {0}', c), [ctx.replace(replace, rebuild(c)), ...ctx.includeEdits('concepts')], 'unsafe'),
  );
}

// ---------------------------------------------------------------------------------------------
// T.10 / I.9  Specify concepts for all template arguments
// ---------------------------------------------------------------------------------------------
const constrainCheck: Check = {
  name: 'T.10 constrained templates',
  covers: ['T.10'],
  run(ctx) {
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const target = templateTarget(tpl);
      if (!target || target.type === 'concept_definition' || target.type === 'template_declaration') continue;
      const params = field(tpl, 'parameters');
      if (!params || namedKids(params).length === 0 || isPartialSpecialization(target)) continue;
      for (const p of namedKids(params)) {
        if (p.type !== 'type_parameter_declaration' && p.type !== 'optional_type_parameter_declaration') continue;
        const id = kids(p).find((k) => k.type === 'type_identifier');
        const keyword = kids(p).find((k) => k.type === 'typename' || k.type === 'class');
        if (!id || !keyword) continue;
        if (constraintMentions(tpl, target, id.text)) continue;
        ctx.report({
          ruleId: 'T.10',
          alsoCovers: ['I.9', 'T.1', 'T.11'],
          node: p,
          message: t('Specify a concept for the template parameter "{0}".', id.text),
          fixes: conceptFixes(ctx, keyword, (c) => c),
        });
      }
    }

    // abbreviated function templates and generic lambdas: `auto` without a constraint
    const lists = [
      ...ctx.nodesOf('function_declarator').map((d) => field(d, 'parameters')),
      ...ctx.nodesOf('lambda_expression').map((l) => {
        const d = field(l, 'declarator');
        return d ? field(d, 'parameters') : null;
      }),
    ];
    for (const list of lists) {
      if (!list) continue;
      for (const p of namedKids(list)) {
        if (p.type !== 'parameter_declaration' && p.type !== 'optional_parameter_declaration') continue;
        const type = field(p, 'type');
        if (type?.type !== 'placeholder_type_specifier' || type.text !== 'auto') continue;
        ctx.report({
          ruleId: 'T.10',
          alsoCovers: ['I.9', 'T.1', 'T.11'],
          node: p,
          message: t('A parameter declared with auto is an unconstrained template argument; specify a concept.'),
          fixes: conceptFixes(ctx, type, (c) => `${c} auto`),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.13  Shorthand notation for simple, single-type argument concepts
// ---------------------------------------------------------------------------------------------
const shorthandCheck: Check = {
  name: 'T.13 concept shorthand',
  covers: ['T.13'],
  run(ctx) {
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const rc = kids(tpl).find((k) => k.type === 'requires_clause');
      const params = field(tpl, 'parameters');
      if (!rc || !params) continue;
      const m = /^((?:\w+::)*\w+)\s*<\s*(\w+)\s*>$/.exec(constraintSource(ctx, rc).trim());
      if (!m) continue;
      const decl = namedKids(params).find((p) => (p.type === 'type_parameter_declaration') && kids(p).some((k) => k.type === 'type_identifier' && k.text === m[2]));
      if (!decl) continue;
      const keyword = kids(decl).find((k) => k.type === 'typename' || k.type === 'class');
      if (!keyword) continue;
      const edits: TextEdit[] = [ctx.replace(keyword, m[1]), ctx.replaceRange(params.endIndex, rc.endIndex, '')];
      ctx.report({
        ruleId: 'T.13',
        node: rc,
        message: t('Prefer the shorthand notation: template <{0} {1}>.', m[1], m[2]),
        fixes: [ctx.fix(t('Use the shorthand notation'), edits)],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.25  Avoid complementary constraints
// ---------------------------------------------------------------------------------------------
const complementaryCheck: Check = {
  name: 'T.25 complementary constraints',
  covers: ['T.25'],
  run(ctx) {
    const byScope = new Map<number, Array<{ tpl: Node; constraint: string; name: string }>>();
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const target = templateTarget(tpl);
      const rcs = [...kids(tpl).filter((k) => k.type === 'requires_clause'), ...(target ? target.descendantsOfType('requires_clause').filter((n): n is Node => !!n) : [])];
      const rc = rcs[0];
      const constraint = rc ? constraintSource(ctx, rc) : '';
      const fd = target?.descendantsOfType('function_declarator')[0];
      const name = fd ? field(fd, 'declarator')?.text : undefined;
      if (!constraint || !name || !tpl.parent) continue;
      const list = byScope.get(tpl.parent.id) ?? [];
      let text = constraint.replace(/\s+/g, '');
      while (/^\(.*\)$/.test(text) && !/\)\(/.test(text)) text = text.slice(1, -1);
      list.push({ tpl, constraint: text, name });
      byScope.set(tpl.parent.id, list);
    }
    for (const list of byScope.values()) {
      for (const a of list) {
        if (!a.constraint.startsWith('!')) continue;
        const positive = a.constraint.slice(1);
        if (list.some((b) => b !== a && b.name === a.name && b.constraint === positive)) {
          ctx.report({ ruleId: 'T.25', node: a.tpl, start: a.tpl.startIndex, end: a.tpl.startIndex + 8, message: t('Avoid complementary constraints ({0} and !{0}); use a constrained overload and an unconstrained one.', positive) });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.43  using instead of typedef
// ---------------------------------------------------------------------------------------------
const typedefCheck: Check = {
  name: 'T.43 typedef',
  covers: ['T.43'],
  run(ctx) {
    for (const td of ctx.nodesOf('type_definition')) {
      const type = field(td, 'type');
      const declarators = td.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      const fixes: Fix[] = [];
      if (type && declarators.length === 1 && !['struct_specifier', 'class_specifier', 'union_specifier', 'enum_specifier'].includes(type.type)) {
        const d = declarators[0];
        const nameNode = shapeOf(d).nameNode ?? (d.type === 'type_identifier' ? d : d.descendantsOfType('type_identifier')[0]);
        if (nameNode) {
          const quals = kids(td).filter((k) => k.type === 'type_qualifier').map((k) => k.text);
          const declText = (ctx.slice(d.startIndex, nameNode.startIndex) + ctx.slice(nameNode.endIndex, d.endIndex)).replace(/\s+/g, ' ').trim();
          const base = [...quals, ctx.src(type)].join(' ');
          const aliased = declText ? (/^[*&(]/.test(declText) ? `${base}${declText.startsWith('(') ? ' ' : ''}${declText}` : `${base} ${declText}`) : base;
          fixes.push(ctx.fix(t('Use an alias declaration'), [ctx.replace(td, `using ${nameNode.text} = ${aliased};`)]));
        }
      }
      ctx.report({ ruleId: 'T.43', node: td, start: td.startIndex, end: td.startIndex + 7, message: t('Prefer using over typedef for defining aliases.'), fixes });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.61  Do not over-parameterize members (SCARY)
// ---------------------------------------------------------------------------------------------
const scaryCheck: Check = {
  name: 'T.61 SCARY members',
  covers: ['T.61'],
  run(ctx) {
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const target = templateTarget(tpl);
      if (!target || !['class_specifier', 'struct_specifier'].includes(target.type) || isPartialSpecialization(target)) continue;
      const params = field(tpl, 'parameters');
      const names = params ? namedKids(params).map((p) => kids(p).filter((k) => k.type === 'type_identifier' || k.type === 'identifier').pop()?.text).filter((n): n is string => !!n) : [];
      if (names.length === 0) continue;
      const body = field(target, 'body');
      if (!body) continue;
      for (const m of namedKids(body)) {
        const isType = ['alias_declaration', 'type_definition', 'class_specifier', 'struct_specifier', 'enum_specifier', 'union_specifier'].includes(m.type) || (m.type === 'field_declaration' && ['struct_specifier', 'class_specifier', 'enum_specifier', 'union_specifier'].includes(field(m, 'type')?.type ?? ''));
        if (!isType) continue;
        const idents = new Set(m.descendantsOfType(['identifier', 'type_identifier']).map((n) => n?.text));
        const missing = names.filter((n) => !idents.has(n));
        if (missing.length > 0) {
          const nameNode = field(m, 'name') ?? field(field(m, 'type') ?? m, 'name');
          ctx.report({
            ruleId: 'T.61',
            node: nameNode ?? m,
            message: t('This member type does not depend on {0}; move it out of the class template (SCARY).', missing.join(', ')),
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.68  Use {} rather than () within templates
// ---------------------------------------------------------------------------------------------
const bracesInTemplatesCheck: Check = {
  name: 'T.68 braces in templates',
  covers: ['T.68'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'identifier' && fn?.type !== 'type_identifier') continue;
      const tpl = ancestor(call, 'template_declaration');
      if (!tpl) continue;
      const params = field(tpl, 'parameters');
      const typeParams = params ? namedKids(params).filter((p) => p.type === 'type_parameter_declaration' || p.type === 'optional_type_parameter_declaration').map((p) => kids(p).find((k) => k.type === 'type_identifier')?.text) : [];
      if (!typeParams.includes(fn.text)) continue;
      const args = callArgs(call);
      ctx.report({
        ruleId: 'T.68',
        node: call,
        message: t('Use {} rather than () within templates to avoid ambiguities ("{0}(...)").', fn.text),
        fixes: [ctx.fix(t('Use braces'), [ctx.replace(call, `${fn.text}{${args.map((a) => ctx.src(a)).join(', ')}}`)], 'unsafe')],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.123  Template metaprogramming that yields a value
// ---------------------------------------------------------------------------------------------
const metaprogramCheck: Check = {
  name: 'T.123 constexpr instead of TMP',
  covers: ['T.123'],
  run(ctx) {
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const target = templateTarget(tpl);
      if (!target || !['class_specifier', 'struct_specifier'].includes(target.type)) continue;
      const name = field(target, 'name');
      const body = field(target, 'body');
      if (!name || !body) continue;
      const cls = name.text.replace(/<.*$/, '');
      for (const m of namedKids(body)) {
        const recursiveValue = (init: string): boolean => new RegExp(`\\b${cls}\\s*<[^;]*>\\s*::\\s*value\\b`).test(init);
        if (m.type === 'field_declaration' && kids(m).some((k) => k.type === 'storage_class_specifier' && k.text === 'static')) {
          const d = m.childrenForFieldName('declarator')[0];
          if (d && shapeOf(d).nameNode?.text === 'value' && recursiveValue(ctx.src(m))) {
            ctx.report({ ruleId: 'T.123', node: m, message: t('Use a constexpr function to compute values at compile time instead of template metaprogramming.') });
          }
        } else if (m.type === 'enum_specifier' && recursiveValue(ctx.src(m))) {
          ctx.report({ ruleId: 'T.123', node: m, message: t('Use a constexpr function to compute values at compile time instead of template metaprogramming.') });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.143  Don't write unintentionally non-generic code
// ---------------------------------------------------------------------------------------------
const genericCodeCheck: Check = {
  name: 'T.143 generic code',
  covers: ['T.143'],
  run(ctx) {
    const sizeCall = (n: Node | null): { recv: Node; arrow: boolean } | null => {
      if (n?.type !== 'call_expression') return null;
      const fn = field(n, 'function');
      if (fn?.type !== 'field_expression' || field(fn, 'field')?.text !== 'size' || callArgs(n).length !== 0) return null;
      const recv = field(fn, 'argument')!;
      return { recv, arrow: ctx.slice(recv.endIndex, field(fn, 'field')!.startIndex).includes('->') };
    };
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text ?? '';
      const left = field(e, 'left');
      const right = field(e, 'right');
      // size() compared with 0 / 1
      let emptyForm: boolean | null = null;
      let call = sizeCall(left);
      let lit = right;
      let flipped = false;
      if (!call) {
        call = sizeCall(right);
        lit = left;
        flipped = true;
      }
      if (call && lit?.type === 'number_literal') {
        const zero = isZeroLiteral(lit.text);
        const one = /^1[uUlL]*$/.test(lit.text);
        const o = flipped ? ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=', '==': '==', '!=': '!=' } as Record<string, string>)[op] ?? op : op;
        if (zero && o === '==') emptyForm = true;
        else if (zero && (o === '!=' || o === '>')) emptyForm = false;
        else if (one && o === '<') emptyForm = true;
        else if (one && o === '>=') emptyForm = false;
        if (emptyForm !== null) {
          const recvText = ctx.src(call.recv);
          const access = call.arrow ? '->' : '.';
          ctx.report({
            ruleId: 'T.143',
            node: e,
            message: t('Use empty() instead of comparing size() with {0}.', lit.text),
            fixes: [ctx.fix(t('Use empty()'), [ctx.replace(e, `${emptyForm ? '' : '!'}${recvText}${access}empty()`)])],
          });
          continue;
        }
      }
      // iterators compared with < instead of !=
      if (op === '<') {
        const isEnd = (n: Node | null): boolean => {
          if (n?.type !== 'call_expression') return false;
          const fn = field(n, 'function');
          return fn?.type === 'field_expression' && /^c?end$/.test(field(fn, 'field')?.text ?? '') && callArgs(n).length === 0;
        };
        if (isEnd(right) && left?.type === 'identifier') {
          ctx.report({
            ruleId: 'T.143',
            node: e,
            message: t('Compare iterators with != rather than <.'),
            fixes: [ctx.fix(t('Use !='), [ctx.replaceRange(left.endIndex, right!.startIndex, ' != ')])],
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.144  Don't specialize function templates
// ---------------------------------------------------------------------------------------------
const specializationCheck: Check = {
  name: 'T.144 function template specialization',
  covers: ['T.144'],
  run(ctx) {
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const params = field(tpl, 'parameters');
      if (!params || namedKids(params).length > 0) continue;
      const target = templateTarget(tpl);
      if (!target || !['function_definition', 'declaration'].includes(target.type)) continue;
      const fd = shapeOf(field(target, 'declarator'));
      if (!fd.isFunction) continue;
      ctx.report({
        ruleId: 'T.144',
        node: tpl,
        start: tpl.startIndex,
        end: params.endIndex,
        message: t("Don't specialize function templates; overload them instead."),
      });
    }
  },
};

export const m3Checks: Check[] = [
  constrainCheck,
  shorthandCheck,
  complementaryCheck,
  typedefCheck,
  scaryCheck,
  bracesInTemplatesCheck,
  metaprogramCheck,
  genericCodeCheck,
  specializationCheck,
];
