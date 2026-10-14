import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { classesOf } from './classes.js';
import { functionsOf, paramName } from './funcs.js';
import { STD_HEADERS } from './m2.js';
import { callArgs, isCallTo, normalizeType } from './util.js';

/** Split `a, b<c, d>, e` at top-level commas. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('<([{'.includes(ch)) depth++;
    else if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const isDiscarded = (call: Node): boolean => call.parent?.type === 'expression_statement';

// ---------------------------------------------------------------------------------------------
// CPP20.ranges  std::algorithm(c.begin(), c.end(), ...) -> std::ranges::algorithm(c, ...)
// ---------------------------------------------------------------------------------------------
type Use = 'always' | 'discarded';
const RANGE_ALGORITHMS: Record<string, { use: Use; arity?: number }> = {
  sort: { use: 'always' }, stable_sort: { use: 'always' }, partial_sort: { use: 'always' },
  find: { use: 'always' }, find_if: { use: 'always' }, find_if_not: { use: 'always' },
  count: { use: 'always' }, count_if: { use: 'always' },
  any_of: { use: 'always' }, all_of: { use: 'always' }, none_of: { use: 'always' },
  min_element: { use: 'always' }, max_element: { use: 'always' },
  lower_bound: { use: 'always' }, upper_bound: { use: 'always' }, binary_search: { use: 'always' },
  reverse: { use: 'always' }, fill: { use: 'always' }, generate: { use: 'always' },
  replace: { use: 'always' }, replace_if: { use: 'always' },
  for_each: { use: 'discarded' }, copy: { use: 'discarded' }, copy_if: { use: 'discarded' },
  transform: { use: 'discarded', arity: 4 }, remove: { use: 'discarded' }, remove_if: { use: 'discarded' },
  unique: { use: 'discarded' }, equal_range: { use: 'discarded' }, rotate: { use: 'discarded' },
};

const rangesCheck: Check = {
  name: 'CPP20.ranges',
  covers: ['CPP20.ranges'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'qualified_identifier' || field(fn, 'scope')?.text !== 'std') continue;
      const name = field(fn, 'name')?.text ?? '';
      const info = RANGE_ALGORITHMS[name];
      if (!info) continue;
      const args = callArgs(call);
      if (args.length < 2 || (info.arity !== undefined && args.length !== info.arity)) continue;
      const begin = rangeEnd(args[0], 'begin');
      const end = rangeEnd(args[1], 'end');
      if (!begin || !end || begin.text !== end.text) continue;
      if (/^std::execution::/.test(args[0].text)) continue;
      const rest = args.slice(2).map((a) => ctx.src(a));
      const replacement = `std::ranges::${name}(${[begin.text, ...rest].join(', ')})`;
      const safe = info.use === 'always' || isDiscarded(call);
      ctx.report({
        ruleId: 'CPP20.ranges',
        node: call,
        message: t('Prefer the constrained algorithm std::ranges::{0} over passing an iterator pair.', name),
        fixes: [ctx.fix(t('Use std::ranges::{0}', name), [ctx.replace(call, replacement), ...ctx.includeEdits('algorithm')], safe ? 'safe' : 'unsafe')],
      });
    }
  },
};

/** `c.begin()` / `std::begin(c)` -> the container expression `c`. */
function rangeEnd(n: Node, which: 'begin' | 'end'): { text: string } | null {
  if (n.type !== 'call_expression') return null;
  const fn = field(n, 'function');
  const args = field(n, 'arguments');
  const items = args ? namedKids(args) : [];
  if (fn?.type === 'field_expression' && field(fn, 'field')?.text === which && items.length === 0) {
    const recv = field(fn, 'argument')!;
    return ['identifier', 'field_expression', 'this', 'pointer_expression'].includes(recv.type) && !ctxArrow(fn) ? { text: recv.text } : null;
  }
  if (fn?.type === 'qualified_identifier' && fn.text === `std::${which}` && items.length === 1) return { text: items[0].text };
  return null;
}

function ctxArrow(fn: Node): boolean {
  const recv = field(fn, 'argument')!;
  return fn.text.slice(recv.text.length).trimStart().startsWith('->');
}

// ---------------------------------------------------------------------------------------------
// CPP20.erase_if  erase-remove idiom
// ---------------------------------------------------------------------------------------------
const eraseIfCheck: Check = {
  name: 'CPP20.erase_if',
  covers: ['CPP20.erase_if'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'field_expression' || field(fn, 'field')?.text !== 'erase') continue;
      const recv = field(fn, 'argument')!;
      const args = callArgs(call);
      if (args.length !== 2 || !isDiscarded(call)) continue;
      const rm = args[0];
      if (rm.type !== 'call_expression' || !isCallTo(rm, 'remove', 'remove_if')) continue;
      const rmFn = field(rm, 'function')!;
      if (rmFn.type === 'qualified_identifier' && field(rmFn, 'scope')?.text !== 'std') continue;
      const rmArgs = callArgs(rm);
      if (rmArgs.length !== 3) continue;
      const b = rangeEnd(rmArgs[0], 'begin');
      const e = rangeEnd(rmArgs[1], 'end');
      const tail = rangeEnd(args[1], 'end');
      if (!b || !e || !tail || b.text !== recv.text || e.text !== recv.text || tail.text !== recv.text) continue;
      const which = rmFn.text.endsWith('remove_if') ? 'erase_if' : 'erase';
      ctx.report({
        ruleId: 'CPP20.erase_if',
        node: call,
        message: t('Use std::{0}(container, ...) instead of the erase-remove idiom.', which),
        fixes: [ctx.fix(t('Use std::{0}', which), [ctx.replace(call, `std::${which}(${recv.text}, ${ctx.src(rmArgs[2])})`)])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.contains  find() != end() -> contains(); find(x) == 0 -> starts_with(x)
// ---------------------------------------------------------------------------------------------
const ASSOC = /(?:^|::)(?:map|set|multimap|multiset|unordered_map|unordered_set|unordered_multimap|unordered_multiset|flat_map|flat_set)\b/;
const STRINGISH = /(?:^|::)(?:basic_)?(?:string|string_view|wstring|u8string|u16string|u32string|wstring_view)\b/;

const containsCheck: Check = {
  name: 'CPP20.contains',
  covers: ['CPP20.contains'],
  run(ctx) {
    const typeOf = (n: Node | null): string | undefined => {
      if (n?.type !== 'identifier') return undefined;
      return ctx.symbols.resolve(n.text, n)?.typeText;
    };
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text;
      if (op !== '==' && op !== '!=') continue;
      const left = field(e, 'left');
      const right = field(e, 'right');
      if (left?.type !== 'call_expression') continue;
      const lfn = field(left, 'function');
      if (lfn?.type !== 'field_expression') continue;
      const recv = field(lfn, 'argument')!;
      const method = field(lfn, 'field')?.text;
      const largs = callArgs(left);

      // m.find(k) != m.end()
      if (method === 'find' && largs.length === 1 && right?.type === 'call_expression') {
        const rf = field(right, 'function');
        if (rf?.type === 'field_expression' && field(rf, 'field')?.text === 'end' && field(rf, 'argument')?.text === recv.text && callArgs(right).length === 0) {
          const ty = typeOf(recv);
          if (ty !== undefined && !ASSOC.test(ty)) continue;
          ctx.report({
            ruleId: 'CPP20.contains',
            node: e,
            message: t('Use contains() instead of find() compared with end().'),
            fixes: [ctx.fix(t('Use contains()'), [ctx.replace(e, `${op === '!=' ? '' : '!'}${recv.text}.contains(${ctx.src(largs[0])})`)], ty !== undefined ? 'safe' : 'unsafe')],
          });
          continue;
        }
      }
      // s.find(x) == 0   /   s.rfind(x, 0) == 0
      if (op === '==' && right?.type === 'number_literal' && right.text === '0') {
        const ty = typeOf(recv);
        if (ty !== undefined && !STRINGISH.test(ty)) continue;
        if (method === 'find' && largs.length === 1) {
          ctx.report({
            ruleId: 'CPP20.contains',
            node: e,
            message: t('Use starts_with() instead of find(...) == 0.'),
            fixes: [ctx.fix(t('Use starts_with()'), [ctx.replace(e, `${recv.text}.starts_with(${ctx.src(largs[0])})`)], ty !== undefined ? 'safe' : 'unsafe')],
          });
        } else if (method === 'rfind' && largs.length === 2 && largs[1].text === '0') {
          ctx.report({
            ruleId: 'CPP20.contains',
            node: e,
            message: t('Use starts_with() instead of rfind(..., 0) == 0.'),
            fixes: [ctx.fix(t('Use starts_with()'), [ctx.replace(e, `${recv.text}.starts_with(${ctx.src(largs[0])})`)], ty !== undefined ? 'safe' : 'unsafe')],
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.spaceship  operator!= and the four relational operators
// ---------------------------------------------------------------------------------------------
const spaceshipCheck: Check = {
  name: 'CPP20.spaceship',
  covers: ['CPP20.spaceship'],
  run(ctx) {
    const byScope = new Map<number, Array<{ f: ReturnType<typeof functionsOf>[number]; scope: Node }>>();
    for (const f of functionsOf(ctx)) {
      if (!/^operator(?:==|!=|<|>|<=|>=)$/.test(f.name)) continue;
      const friend = ancestor(f.node, 'friend_declaration');
      const holder = friend ?? f.node;
      const scope = holder.parent;
      if (!scope) continue;
      const list = byScope.get(scope.id) ?? [];
      list.push({ f, scope });
      byScope.set(scope.id, list);
    }
    for (const list of byScope.values()) {
      const has = (op: string): boolean => list.some((x) => x.f.name === `operator${op}`);
      for (const { f } of list) {
        if (f.name === 'operator!=' && has('==')) {
          const holder = ancestor(f.node, 'friend_declaration') ?? f.node;
          ctx.report({
            ruleId: 'CPP20.spaceship',
            node: f.nameNode,
            message: t('operator!= is rewritten from operator== in C++20; remove it.'),
            fixes: [ctx.fix(t('Remove operator!='), [ctx.remove(holder)], 'unsafe')],
          });
        }
      }
      const relational = list.filter((x) => ['<', '>', '<=', '>='].some((op) => x.f.name === `operator${op}`));
      if (relational.length >= 2) {
        ctx.report({
          ruleId: 'CPP20.spaceship',
          node: relational[0].f.nameNode,
          message: t('Define operator<=> (defaulted if possible) instead of the individual relational operators.'),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.source_location
// ---------------------------------------------------------------------------------------------
const sourceLocationCheck: Check = {
  name: 'CPP20.source_location',
  covers: ['CPP20.source_location'],
  run(ctx) {
    const MAP: Record<string, { call: string; safe: boolean }> = {
      __FILE__: { call: 'file_name()', safe: true },
      __LINE__: { call: 'line()', safe: true },
      __func__: { call: 'function_name()', safe: false },
      __FUNCTION__: { call: 'function_name()', safe: false },
      __PRETTY_FUNCTION__: { call: 'function_name()', safe: false },
    };
    for (const id of ctx.nodesOf('identifier')) {
      const m = MAP[id.text];
      if (!m || id.parent?.type === 'preproc_def') continue;
      if (id.text === '__func__' && ancestor(id, 'function_definition') === null) continue;
      ctx.report({
        ruleId: 'CPP20.source_location',
        node: id,
        message: t('Prefer std::source_location to the macro {0}.', id.text),
        fixes: [ctx.fix(t('Use std::source_location'), [ctx.replace(id, `std::source_location::current().${m.call}`), ...ctx.includeEdits('source_location')], m.safe ? 'safe' : 'unsafe')],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.type_traits  ::value -> _v,  ::type -> _t
// ---------------------------------------------------------------------------------------------
const TRAITS_V = new Set([
  'is_same', 'is_integral', 'is_floating_point', 'is_pointer', 'is_reference', 'is_lvalue_reference', 'is_rvalue_reference', 'is_const', 'is_volatile', 'is_base_of', 'is_convertible',
  'is_constructible', 'is_default_constructible', 'is_copy_constructible', 'is_move_constructible', 'is_assignable', 'is_copy_assignable', 'is_move_assignable', 'is_destructible',
  'is_trivially_copyable', 'is_trivial', 'is_enum', 'is_class', 'is_union', 'is_array', 'is_void', 'is_arithmetic', 'is_scalar', 'is_fundamental', 'is_compound', 'is_signed', 'is_unsigned',
  'is_empty', 'is_abstract', 'is_polymorphic', 'is_final', 'is_invocable', 'is_nothrow_constructible', 'is_nothrow_move_constructible', 'is_nothrow_copy_constructible',
  'is_nothrow_destructible', 'is_nothrow_invocable', 'is_nothrow_swappable', 'is_swappable', 'is_standard_layout', 'is_member_pointer', 'is_function', 'is_object', 'is_member_function_pointer',
  'has_virtual_destructor', 'is_aggregate', 'rank', 'extent', 'alignment_of',
]);
const TRAITS_T = new Set([
  'remove_cv', 'remove_const', 'remove_volatile', 'remove_reference', 'remove_pointer', 'remove_extent', 'add_pointer', 'add_const', 'add_volatile', 'add_cv', 'add_lvalue_reference',
  'add_rvalue_reference', 'decay', 'enable_if', 'conditional', 'underlying_type', 'common_type', 'make_signed', 'make_unsigned', 'invoke_result',
]);

const traitsCheck: Check = {
  name: 'CPP20.type_traits',
  covers: ['CPP20.type_traits'],
  run(ctx) {
    for (const q of ctx.nodesOf('qualified_identifier', 'dependent_type')) {
      if (q.parent?.type === 'qualified_identifier') continue;
      const text = ctx.src(q).replace(/\s+/g, ' ');
      const typename = /^typename\s+/.test(text);
      const body = text.replace(/^typename\s+/, '');
      let m = /^std::(\w+)(<.*>)::value$/s.exec(body);
      if (m && TRAITS_V.has(m[1]) && !typename) {
        ctx.report({
          ruleId: 'CPP20.type_traits',
          node: q,
          message: t('Use the variable template std::{0}_v instead of std::{0}<...>::value.', m[1]),
          fixes: [ctx.fix(t('Use std::{0}_v', m[1]), [ctx.replace(q, `std::${m[1]}_v${m[2]}`)])],
        });
        continue;
      }
      m = /^std::(\w+)(<.*>)::type$/s.exec(body);
      if (m && TRAITS_T.has(m[1])) {
        ctx.report({
          ruleId: 'CPP20.type_traits',
          node: q,
          message: t('Use the alias template std::{0}_t instead of typename std::{0}<...>::type.', m[1]),
          fixes: [ctx.fix(t('Use std::{0}_t', m[1]), [ctx.replace(q, `std::${m[1]}_t${m[2]}`)])],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.concepts  enable_if -> requires
// ---------------------------------------------------------------------------------------------
interface EnableIf {
  node: Node;
  cond: string;
  result: string | null;
}

function parseEnableIf(ctx: Context, node: Node): EnableIf | null {
  const text = ctx.src(node).replace(/\s+/g, ' ').trim();
  let m = /^(?:typename\s+)?std::enable_if_t\s*<(.*)>$/s.exec(text);
  if (!m) m = /^typename\s+std::enable_if\s*<(.*)>\s*::type$/s.exec(text);
  if (!m) return null;
  const parts = splitArgs(m[1]);
  if (parts.length < 1 || parts.length > 2) return null;
  return { node, cond: parts[0], result: parts[1] ?? null };
}

function wrapCondition(cond: string): string {
  return /^[\w:]+(?:<.*>)?(?:::value)?$/s.test(cond) || /^\(.*\)$/s.test(cond) ? cond : `(${cond})`;
}

const conceptsCheck: Check = {
  name: 'CPP20.concepts',
  covers: ['CPP20.concepts'],
  run(ctx) {
    const handled = new Set<number>();
    for (const tpl of ctx.nodesOf('template_declaration')) {
      const params = field(tpl, 'parameters');
      const target = namedKids(tpl).find((k) => !['template_parameter_list', 'requires_clause', 'comment'].includes(k.type));
      if (!params || !target) continue;
      const hasRequires = kids(tpl).some((k) => k.type === 'requires_clause');

      // (a) default template argument:  typename = std::enable_if_t<COND>   /   std::enable_if_t<COND, int> = 0
      const plist = namedKids(params);
      for (const p of plist) {
        let found: EnableIf | null = null;
        if (p.type === 'optional_type_parameter_declaration') {
          const dflt = field(p, 'default_type');
          if (dflt) found = parseEnableIf(ctx, dflt);
        } else if (p.type === 'optional_parameter_declaration' || p.type === 'parameter_declaration') {
          const type = field(p, 'type');
          if (type) found = parseEnableIf(ctx, type);
        }
        if (!found) continue;
        handled.add(found.node.id);
        const fixes: Fix[] = [];
        const remaining = plist.filter((x) => x.id !== p.id);
        if (!hasRequires && remaining.length > 0) {
          const idx = plist.findIndex((x) => x.id === p.id);
          const from = idx > 0 ? plist[idx - 1].endIndex : p.startIndex;
          const to = idx > 0 ? p.endIndex : plist[idx + 1].startIndex;
          fixes.push(ctx.fix(t('Replace enable_if with a requires clause'), [ctx.replaceRange(from, to, ''), ctx.insertAt(params.endIndex, ` requires ${wrapCondition(found.cond)}`)], 'unsafe'));
        }
        ctx.report({ ruleId: 'CPP20.concepts', node: p, message: t('Use concepts (requires clauses) instead of std::enable_if.'), fixes });
      }

      // (b) return type
      const type = field(target, 'type');
      const fd = target.descendantsOfType('function_declarator')[0];
      if (type && fd && !handled.has(type.id)) {
        const found = parseEnableIf(ctx, type);
        if (found) {
          handled.add(found.node.id);
          const fixes: Fix[] = [];
          const trailing = kids(fd).find((k) => k.type === 'requires_clause');
          if (!hasRequires && !trailing && fd.parent?.id === target.id) {
            const afterDecl = kids(fd).filter((k) => k.type === 'type_qualifier' || k.type === 'noexcept' || k.type === 'ref_qualifier' || k.type === 'virtual_specifier' || k.type === 'trailing_return_type').pop();
            const at = afterDecl ? afterDecl.endIndex : fd.endIndex;
            fixes.push(ctx.fix(t('Replace enable_if with a requires clause'), [ctx.replace(type, found.result ?? 'void'), ctx.insertAt(at, ` requires ${wrapCondition(found.cond)}`)], 'unsafe'));
          }
          ctx.report({ ruleId: 'CPP20.concepts', node: type, message: t('Use concepts (requires clauses) instead of std::enable_if.'), fixes });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.nodiscard
// ---------------------------------------------------------------------------------------------
const hasNodiscard = (n: Node): boolean => kids(n).some((k) => k.type === 'attribute_declaration' && /nodiscard/.test(k.text)) || /^\s*\[\[\s*nodiscard/.test(n.text);

const nodiscardCheck: Check = {
  name: 'CPP20.nodiscard',
  covers: ['CPP20.nodiscard'],
  run(ctx) {
    const report = (node: Node, name: string): void => {
      ctx.report({
        ruleId: 'CPP20.nodiscard',
        node: shapeOf(field(node, 'declarator')).nameNode ?? node,
        message: t('Mark "{0}" [[nodiscard]]: ignoring its result is almost certainly a bug.', name),
        fixes: [ctx.fix(t('Add [[nodiscard]]'), [ctx.insertAt(node.startIndex, '[[nodiscard]] ')])],
      });
    };
    const returnsValue = (f: ReturnType<typeof functionsOf>[number]): boolean => !!f.returnType && normalizeType(ctx.src(f.returnType)) !== 'void';
    for (const c of classesOf(ctx)) {
      for (const m of c.functions) {
        const f = m.info;
        if (!f.isConst || f.isStatic || f.isConstructor || f.isDestructor || f.isOperator || m.isOverride || m.isFinal || !returnsValue(f) || f.isTemplate) continue;
        if (hasNodiscard(f.node) || f.isDeleted) continue;
        report(f.node, f.name);
      }
    }
    if (ctx.file.isHeader) {
      for (const f of functionsOf(ctx)) {
        if (f.className || f.isOperator || f.name === 'main' || f.name === 'swap' || f.isTemplate || !returnsValue(f)) continue;
        if (ancestor(f.node, 'class_specifier', 'struct_specifier', 'union_specifier') || hasNodiscard(f.node)) continue;
        const pure = f.params.every((p) => {
          const shape = shapeOf(field(p, 'declarator'));
          const isConst = kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const');
          return (!shape.reference && !shape.pointer && !shape.rvalueReference) || isConst;
        });
        if (!pure || f.returnsReference) continue;
        report(f.node, f.name);
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.constinit
// ---------------------------------------------------------------------------------------------
const constinitCheck: Check = {
  name: 'CPP20.constinit',
  covers: ['CPP20.constinit'],
  run(ctx) {
    for (const v of ctx.symbols.vars) {
      const global = v.kind === 'global' && v.declNode.type === 'declaration' && ['translation_unit', 'declaration_list'].includes(v.declNode.parent?.type ?? '');
      if (!global && !(v.kind === 'local' && v.isStatic)) continue;
      if (v.isConst || v.isConstexpr || v.reference || v.array || !v.initializer || v.isExtern) continue;
      if (kids(v.declNode).some((k) => k.text === 'constinit' || k.text === 'thread_local')) continue;
      const builtin = v.typeNode && (['primitive_type', 'sized_type_specifier'].includes(v.typeNode.type) || /^(?:std::)?(?:size_t|u?int(?:8|16|32|64)_t)$/.test(v.typeText));
      if (!builtin && !v.pointer) continue;
      if (!['number_literal', 'true', 'false', 'null', 'char_literal'].includes(v.initializer.type) && !(v.initializer.type === 'initializer_list' && namedKids(v.initializer).length === 0)) continue;
      if (v.declNode.childrenForFieldName('declarator').length !== 1) continue;
      ctx.report({
        ruleId: 'CPP20.constinit',
        node: v.nameNode,
        message: t('Declare "{0}" constinit: it is constant-initialised, which avoids the static initialisation order problem.', v.name),
        fixes: [ctx.fix(t('Add constinit'), [ctx.insertAt(v.declNode.startIndex, 'constinit ')])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.bit_cast
// ---------------------------------------------------------------------------------------------
const bitCastCheck: Check = {
  name: 'CPP20.bit_cast',
  covers: ['CPP20.bit_cast'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      if (!isCallTo(call, 'memcpy') || !isDiscarded(call)) continue;
      const args = callArgs(call);
      if (args.length !== 3) continue;
      const addr = (n: Node): Node | null => (n.type === 'pointer_expression' && n.text.startsWith('&') && field(n, 'argument')?.type === 'identifier' ? field(n, 'argument') : null);
      const dst = addr(args[0]);
      const src = addr(args[1]);
      if (!dst || !src) continue;
      const sz = args[2].text.replace(/\s+/g, '');
      if (sz !== `sizeof(${dst.text})` && sz !== `sizeof${dst.text}` && sz !== `sizeof(${src.text})` && sz !== `sizeof${src.text}`) continue;
      ctx.report({
        ruleId: 'CPP20.bit_cast',
        node: call,
        message: t('Use std::bit_cast instead of memcpy for type punning.'),
        fixes: [ctx.fix(t('Use std::bit_cast'), [ctx.replace(call.parent!, `${dst.text} = std::bit_cast<decltype(${dst.text})>(${src.text});`), ...ctx.includeEdits('bit')])],
      });
    }
    // *reinterpret_cast<T*>(&x)
    for (const p of ctx.nodesOf('pointer_expression')) {
      if (!p.text.startsWith('*')) continue;
      const inner = field(p, 'argument');
      if (inner?.type !== 'call_expression') continue;
      const fn = field(inner, 'function');
      if (fn?.type !== 'template_function' || field(fn, 'name')?.text !== 'reinterpret_cast') continue;
      const targs = field(fn, 'arguments');
      const td = targs ? namedKids(targs)[0] : undefined;
      const arg = callArgs(inner)[0];
      if (!td || !arg || !/^(?:const\s+)?[\w:]+\s*\*$/.test(ctx.src(td).trim()) || !(arg.type === 'pointer_expression' && arg.text.startsWith('&'))) continue;
      const target = ctx.src(td).trim().replace(/\s*\*$/, '').replace(/^const\s+/, '');
      ctx.report({
        ruleId: 'CPP20.bit_cast',
        node: p,
        message: t('Use std::bit_cast instead of dereferencing a reinterpret_cast (undefined behaviour).'),
        fixes: [ctx.fix(t('Use std::bit_cast'), [ctx.replace(p, `std::bit_cast<${target}>(${ctx.src(field(arg, 'argument')!)})`), ...ctx.includeEdits('bit')])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.gsl_to_std  GSL entities that have a C++20 equivalent
// ---------------------------------------------------------------------------------------------
const GSL_MAP: Record<string, string> = { span: 'std::span', joining_thread: 'std::jthread', byte: 'std::byte', index: 'std::ptrdiff_t' };

const gslCheck: Check = {
  name: 'CPP20.gsl_to_std',
  covers: ['CPP20.gsl_to_std'],
  run(ctx) {
    for (const q of ctx.nodesOf('qualified_identifier', 'template_type')) {
      if (q.type === 'template_type' && q.parent?.type === 'qualified_identifier') continue;
      const scopeNode = q.type === 'qualified_identifier' ? field(q, 'scope') : null;
      if (scopeNode?.text !== 'gsl') continue;
      const nameNode = field(q, 'name')!;
      const base = nameNode.text.replace(/<.*$/s, '');
      const std = GSL_MAP[base];
      if (std) {
        const include = base === 'span' ? 'span' : base === 'joining_thread' ? 'thread' : base === 'byte' ? 'cstddef' : null;
        ctx.report({
          ruleId: 'CPP20.gsl_to_std',
          node: q,
          message: t('gsl::{0} has a C++20 standard equivalent: use {1}.', base, std),
          fixes: [ctx.fix(t('Use {0}', std), [ctx.replaceRange(q.startIndex, scopeNode.endIndex + 2 + base.length, std), ...(include ? ctx.includeEdits(include) : [])])],
        });
      }
    }
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'qualified_identifier' || field(fn, 'scope')?.text !== 'gsl') continue;
      const name = field(fn, 'name');
      if (name?.type !== 'template_function' || field(name, 'name')?.text !== 'narrow_cast') continue;
      ctx.report({
        ruleId: 'CPP20.gsl_to_std',
        node: call,
        message: t('gsl::narrow_cast is just static_cast.'),
        fixes: [ctx.fix(t('Use static_cast'), [ctx.replaceRange(fn.startIndex, name.startIndex + 'narrow_cast'.length, 'static_cast')])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.string_view  const std::string& parameters
// ---------------------------------------------------------------------------------------------
const stringViewCheck: Check = {
  name: 'CPP20.string_view',
  covers: ['CPP20.string_view'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      if (f.isVirtualSpecified || f.isOperator) continue;
      for (const p of f.params) {
        if (p.type !== 'parameter_declaration' && p.type !== 'optional_parameter_declaration') continue;
        const type = field(p, 'type');
        const shape = shapeOf(field(p, 'declarator'));
        const isConst = kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const');
        if (!type || !isConst || !shape.reference || shape.pointer || normalizeType(ctx.src(type)) !== 'std::string') continue;
        const name = paramName(p);
        if (name && f.body && f.body.descendantsOfType('call_expression').some((c) => {
          const fn = c ? field(c, 'function') : null;
          return fn?.type === 'field_expression' && field(fn, 'argument')?.text === name && ['c_str', 'data'].includes(field(fn, 'field')?.text ?? '');
        })) continue;
        const dflt = p.type === 'optional_parameter_declaration' ? field(p, 'default_value') : null;
        ctx.report({
          ruleId: 'CPP20.string_view',
          node: p,
          message: t('A read-only string parameter should be a std::string_view, not a reference to a std::string.'),
          fixes: [ctx.fix(t('Use std::string_view'), [ctx.replace(p, `std::string_view${name ? ' ' + name : ''}${dflt ? ' = ' + ctx.src(dflt) : ''}`), ...ctx.includeEdits('string_view')], 'unsafe')],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.numbers  M_PI & co.
// ---------------------------------------------------------------------------------------------
const NUMBERS: Record<string, string> = { M_PI: 'pi', M_E: 'e', M_LOG2E: 'log2e', M_LOG10E: 'log10e', M_LN2: 'ln2', M_LN10: 'ln10', M_SQRT2: 'sqrt2', M_1_PI: 'inv_pi' };

const numbersCheck: Check = {
  name: 'CPP20.numbers',
  covers: ['CPP20.numbers'],
  run(ctx) {
    for (const id of ctx.nodesOf('identifier')) {
      const std = NUMBERS[id.text];
      if (!std || id.parent?.type === 'preproc_def') continue;
      ctx.report({
        ruleId: 'CPP20.numbers',
        node: id,
        message: t('Use std::numbers::{0} instead of the non-standard macro {1}.', std, id.text),
        fixes: [ctx.fix(t('Use std::numbers::{0}', std), [ctx.replace(id, `std::numbers::${std}`), ...ctx.includeEdits('numbers')])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.removed  removed / deprecated library facilities and keywords
// ---------------------------------------------------------------------------------------------
const REMOVED: Record<string, string> = {
  auto_ptr: 'std::unique_ptr',
  random_shuffle: 'std::shuffle (with a <random> engine)',
  bind1st: 'a lambda or std::bind_front',
  bind2nd: 'a lambda or std::bind_front',
  ptr_fun: 'a lambda',
  mem_fun: 'std::mem_fn',
  mem_fun_ref: 'std::mem_fn',
  unary_function: 'nothing (it is not needed)',
  binary_function: 'nothing (it is not needed)',
  not1: 'std::not_fn',
  not2: 'std::not_fn',
  is_literal_type: 'a requirement on the type itself',
  uncaught_exception: 'std::uncaught_exceptions',
};

const removedCheck: Check = {
  name: 'CPP20.removed',
  covers: ['CPP20.removed'],
  run(ctx) {
    for (const q of ctx.nodesOf('qualified_identifier')) {
      if (q.parent?.type === 'qualified_identifier' || field(q, 'scope')?.text !== 'std') continue;
      const nameNode = field(q, 'name');
      const name = nameNode?.text.replace(/<.*$/s, '') ?? '';
      if (REMOVED[name]) {
        ctx.report({
          ruleId: 'CPP20.removed',
          node: q,
          message: t('std::{0} is removed or deprecated; use {1}.', name, REMOVED[name]),
          fixes: name === 'auto_ptr' ? [ctx.fix(t('Use std::unique_ptr'), [ctx.replaceRange(q.startIndex, q.startIndex + 'std::auto_ptr'.length, 'std::unique_ptr')], 'unsafe')] : [],
        });
      } else if (name === 'result_of' || nameNode?.text.startsWith('result_of')) {
        const m = /^std::result_of\s*<\s*(.+?)\s*\(\s*(.*?)\s*\)\s*>::type$/s.exec(ctx.src(q).replace(/\s+/g, ' '));
        ctx.report({
          ruleId: 'CPP20.removed',
          node: q,
          message: t('std::result_of is removed; use std::invoke_result_t.'),
          fixes: m ? [ctx.fix(t('Use std::invoke_result_t'), [ctx.replace(q, `std::invoke_result_t<${[m[1], ...(m[2] ? splitArgs(m[2]) : [])].join(', ')}>`)], 'unsafe')] : [],
        });
      }
    }
    for (const spec of ctx.nodesOf('storage_class_specifier')) {
      if (spec.text !== 'register') continue;
      const end = ctx.slice(spec.endIndex, spec.endIndex + 1) === ' ' ? spec.endIndex + 1 : spec.endIndex;
      ctx.report({
        ruleId: 'CPP20.removed',
        node: spec,
        message: t('The register keyword was removed in C++17.'),
        fixes: [ctx.fix(t('Remove register'), [ctx.replaceRange(spec.startIndex, end, '')])],
      });
    }
    for (const c of ctx.nodesOf('base_class_clause')) {
      for (const b of kids(c)) {
        if (b.type === 'qualified_identifier' || b.type === 'template_type') {
          if (/^std::iterator\b/.test(b.text)) ctx.report({ ruleId: 'CPP20.removed', node: b, message: t('std::iterator is deprecated; define the iterator member types yourself.') });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPP20.modules  (opt-in)
// ---------------------------------------------------------------------------------------------
const modulesCheck: Check = {
  name: 'CPP20.modules',
  covers: ['CPP20.modules'],
  run(ctx) {
    if (!ctx.config.enforceModules) return;
    for (const inc of ctx.nodesOf('preproc_include')) {
      const path = field(inc, 'path');
      const m = path ? /^<([\w]+)>$/.exec(path.text) : null;
      if (!m || !STD_HEADERS.has(m[1])) continue;
      ctx.report({
        ruleId: 'CPP20.modules',
        node: inc,
        message: t('Import the standard header unit instead of including <{0}>.', m[1]),
        fixes: [ctx.fix(t('Use import <{0}>;', m[1]), [ctx.replace(inc, `import <${m[1]}>;${/\n$/.test(ctx.src(inc)) ? ctx.eol : ''}`)], 'unsafe')],
      });
    }
  },
};

export const cpp20Checks: Check[] = [
  rangesCheck,
  eraseIfCheck,
  containsCheck,
  spaceshipCheck,
  sourceLocationCheck,
  traitsCheck,
  conceptsCheck,
  nodiscardCheck,
  constinitCheck,
  bitCastCheck,
  gslCheck,
  stringViewCheck,
  numbersCheck,
  removedCheck,
  modulesCheck,
];
