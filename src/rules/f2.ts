import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf, type VarInfo } from '../core/symbols.js';
import type { Check, Fix } from '../core/types.js';
import { functionsOf } from './funcs.js';
import { alwaysJumps, identifierUses, isCallTo } from './util.js';

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
function templateTypeParams(fn: Node): Set<string> {
  const names = new Set<string>();
  const tpl = fn.parent?.type === 'template_declaration' ? fn.parent : null;
  const list = tpl ? field(tpl, 'parameters') : null;
  if (!list) return names;
  for (const p of namedKids(list)) {
    if (p.type === 'type_parameter_declaration' || p.type === 'variadic_type_parameter_declaration' || p.type === 'optional_type_parameter_declaration') {
      const id = kids(p).find((k) => k.type === 'type_identifier');
      if (id) names.add(id.text);
    }
  }
  return names;
}

function movedIn(call: Node, name: string): boolean {
  if (!isCallTo(call, 'move')) return false;
  const args = field(call, 'arguments');
  const first = args ? namedKids(args)[0] : undefined;
  return first?.type === 'identifier' && first.text === name;
}

function forwardedIn(call: Node, name: string): boolean {
  if (!isCallTo(call, 'forward')) return false;
  const args = field(call, 'arguments');
  const first = args ? namedKids(args)[0] : undefined;
  return first?.type === 'identifier' && first.text === name;
}

/** Identity of the straight-line path a node is on (changes across if/else, case, ?: and && / || branches). */
function pathKey(node: Node, stop: Node): string {
  const parts: string[] = [];
  for (let n: Node | null = node; n && n.id !== stop.id; n = n.parent) {
    const p = n.parent;
    if (!p) break;
    if (p.type === 'if_statement' && field(p, 'condition')?.id !== n.id) parts.push(`${p.id}:${n.id}`);
    else if (p.type === 'else_clause' || p.type === 'case_statement' || p.type === 'catch_clause') parts.push(`${p.id}`);
    else if (p.type === 'conditional_expression' && field(p, 'condition')?.id !== n.id) parts.push(`${p.id}:${n.id}`);
    else if (p.type === 'binary_expression' && ['&&', '||'].includes(field(p, 'operator')?.text ?? '') && field(p, 'right')?.id === n.id) parts.push(`${p.id}`);
  }
  return parts.join('|');
}

// ---------------------------------------------------------------------------------------------
// F.18 / F.19 / ES.56  rvalue-reference and forwarding-reference parameters
// ---------------------------------------------------------------------------------------------
const rvalueParamCheck: Check = {
  name: 'F.18/F.19 rvalue parameters',
  covers: ['F.18', 'F.19', 'ES.56'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      if (!f.body || f.node.type !== 'function_definition') continue;
      const tparams = templateTypeParams(f.node);
      for (const p of f.params) {
        const decl = field(p, 'declarator');
        const shape = shapeOf(decl);
        if (!shape.rvalueReference || !shape.nameNode) continue;
        const name = shape.nameNode.text;
        const typeNode = field(p, 'type');
        if (!typeNode) continue;
        if (kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const')) continue;
        const typeText = ctx.src(typeNode).trim();
        const forwarding = typeNode.type === 'placeholder_type_specifier' || tparams.has(typeText);
        const uses = identifierUses(f.body, name);
        if (uses.length === 0) continue;
        const calls = f.body.descendantsOfType('call_expression').filter((c): c is Node => !!c);
        const moves = calls.filter((c) => movedIn(c, name));
        const forwards = calls.filter((c) => forwardedIn(c, name));

        if (!forwarding) {
          // F.18: X&& must be std::move'd
          if (moves.length === 0) {
            ctx.report({
              ruleId: 'F.18',
              node: p,
              message: t('"{0}" is an X&& parameter but is never passed to std::move.', name),
            });
          }
          if (forwards.length > 0) {
            ctx.report({
              ruleId: 'ES.56',
              node: forwards[0],
              message: t('Do not std::forward an rvalue reference of a non-template type; use std::move.'),
            });
          }
          continue;
        }

        // F.19: forwarding reference must only be std::forward'ed, exactly once on every path
        if (moves.length > 0) {
          ctx.report({
            ruleId: 'ES.56',
            alsoCovers: ['F.19'],
            node: moves[0],
            message: t('Do not std::move a forwarding reference; use std::forward<T>({0}).', name),
          });
          continue;
        }
        const otherUse = uses.find((u) => {
          const call = ancestor(u, 'call_expression');
          return !(call && forwards.some((fw) => fw.id === call.id)) && !ancestor(u, 'decltype') && u.parent?.type !== 'decltype';
        });
        if (otherUse) {
          ctx.report({
            ruleId: 'F.19',
            node: otherUse,
            message: t('The forwarding reference "{0}" must only be passed to std::forward<T>({0}).', name),
          });
          continue;
        }
        const keys = new Map<string, number>();
        for (const fw of forwards) keys.set(pathKey(fw, f.body), (keys.get(pathKey(fw, f.body)) ?? 0) + 1);
        if ([...keys.values()].some((n) => n > 1)) {
          ctx.report({
            ruleId: 'F.19',
            node: forwards[1] ?? forwards[0],
            message: t('"{0}" is forwarded more than once on the same path.', name),
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.48 / F.26 / F.43  Returning locals
// ---------------------------------------------------------------------------------------------
function isAutomatic(v: VarInfo | undefined): v is VarInfo {
  return !!v && (v.kind === 'local' || v.kind === 'param') && !v.isStatic && !v.reference && !v.rvalueReference && !v.isExtern;
}

function rootIdentifier(n: Node): Node | null {
  let cur: Node | null = n;
  while (cur) {
    if (cur.type === 'identifier') return cur;
    if (cur.type === 'subscript_expression' || cur.type === 'field_expression') cur = field(cur, 'argument');
    else if (cur.type === 'parenthesized_expression') cur = namedKids(cur)[0] ?? null;
    else return null;
  }
  return null;
}

const returnLocalCheck: Check = {
  name: 'F.43 returning locals',
  covers: ['F.43', 'F.48'],
  run(ctx) {
    for (const ret of ctx.nodesOf('return_statement')) {
      const fnNode = ancestor(ret, 'function_definition', 'lambda_expression');
      if (!fnNode || fnNode.type !== 'function_definition') continue;
      const value = namedKids(ret).find((n) => n.type !== 'comment');
      if (!value) continue;
      const shape = shapeOf(field(fnNode, 'declarator'));

      // F.48: return std::move(local)
      if (value.type === 'call_expression' && isCallTo(value, 'move')) {
        const arg = namedKids(field(value, 'arguments')!)[0];
        if (arg?.type === 'identifier') {
          const v = ctx.symbols.resolve(arg.text, arg);
          if (isAutomatic(v) && !v.pointer) {
            ctx.report({
              ruleId: 'F.48',
              alsoCovers: ['ES.56'],
              node: value,
              message: t("Don't return std::move(local): it prevents copy elision."),
              fixes: [ctx.fix(t('Remove std::move'), [ctx.replace(value, arg.text)])],
            });
          }
        }
        continue;
      }

      // F.43: pointer / reference to a local object
      if (shape.pointer && shape.isFunction) {
        if (value.type === 'pointer_expression' && value.text.startsWith('&')) {
          const root = rootIdentifier(field(value, 'argument') ?? value);
          const v = root ? ctx.symbols.resolve(root.text, root) : undefined;
          if (isAutomatic(v) && !v.pointer) {
            ctx.report({ ruleId: 'F.43', node: value, message: t('Never return a pointer to a local object ("{0}").', v.name) });
          }
        } else if (value.type === 'identifier') {
          const v = ctx.symbols.resolve(value.text, value);
          if (isAutomatic(v) && v.array) {
            ctx.report({ ruleId: 'F.43', node: value, message: t('Never return a pointer to a local object ("{0}").', v.name) });
          }
        }
      } else if ((shape.reference || shape.rvalueReference) && shape.isFunction) {
        const root = rootIdentifier(value);
        const direct = value.type === 'identifier' || value.type === 'subscript_expression' || value.type === 'field_expression';
        const v = root && direct ? ctx.symbols.resolve(root.text, root) : undefined;
        if (isAutomatic(v) && !v.pointer) {
          ctx.report({ ruleId: 'F.43', node: value, message: t('Never return a reference to a local object ("{0}").', v.name) });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.50 / F.53 / F.54  Lambdas
// ---------------------------------------------------------------------------------------------
interface Captures {
  defaultCapture: '=' | '&' | null;
  items: string[];
}

function parseCaptures(text: string): Captures {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      items.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  let defaultCapture: Captures['defaultCapture'] = null;
  if (items[0] === '=' || items[0] === '&') defaultCapture = items.shift() as '=' | '&';
  return { defaultCapture, items };
}

function enclosingOf(l: Node): Node | null {
  return ancestor(l, 'function_definition');
}

/** Locals/params of the enclosing function that the lambda body mentions. */
function capturedLocals(ctx: Context, lambda: Node): VarInfo[] {
  const body = field(lambda, 'body');
  const outer = enclosingOf(lambda);
  if (!body || !outer) return [];
  const seen = new Map<string, VarInfo>();
  for (const id of body.descendantsOfType('identifier')) {
    if (!id || seen.has(id.text)) continue;
    const v = ctx.symbols.resolve(id.text, id);
    if (v && (v.kind === 'local' || v.kind === 'param') && v.nameNode.startIndex < lambda.startIndex && !v.isStatic && !(v.scope.startIndex >= lambda.startIndex && v.scope.endIndex <= lambda.endIndex)) {
      seen.set(id.text, v);
    }
  }
  return [...seen.values()];
}

function usesThis(ctx: Context, lambda: Node): boolean {
  const body = field(lambda, 'body');
  if (!body) return false;
  if (body.descendantsOfType('this').length > 0) return true;
  for (const id of body.descendantsOfType('identifier')) {
    if (!id) continue;
    const v = ctx.symbols.resolve(id.text, id);
    if (v?.kind === 'member') return true;
  }
  return false;
}

const lambdaCheck: Check = {
  name: 'F.50/53/54 lambdas',
  covers: ['F.50', 'F.53', 'F.54'],
  run(ctx) {
    for (const l of ctx.nodesOf('lambda_expression')) {
      const capNode = field(l, 'captures');
      if (!capNode) continue;
      const caps = parseCaptures(ctx.src(capNode));

      // F.54: [=] together with this
      const explicitThis = caps.items.some((i) => i === 'this' || i === '*this');
      if (caps.defaultCapture === '=' && (explicitThis || usesThis(ctx, l))) {
        const fixes: Fix[] = [];
        const locals = capturedLocals(ctx, l);
        const body = field(l, 'body');
        if (!caps.items.includes('*this') && body) {
          const others = caps.items.filter((i) => i !== 'this');
          const list = ['this', ...others, ...locals.map((v) => v.name).filter((n) => !others.includes(n))];
          fixes.push(ctx.fix(t('List the captures explicitly (keeps this by pointer)'), [ctx.replace(capNode, `[${list.join(', ')}]`)]));
        }
        if (!caps.items.includes('*this')) {
          const rest = caps.items.filter((i) => i !== 'this');
          fixes.push(ctx.fix(t('Capture *this by copy'), [ctx.replace(capNode, `[=, *this${rest.length ? ', ' + rest.join(', ') : ''}]`)], 'unsafe'));
        }
        ctx.report({
          ruleId: 'F.54',
          node: capNode,
          message: t("When a lambda captures this or a data member, don't use the [=] default capture."),
          fixes,
        });
      }

      // F.53: by-reference captures of locals in a lambda that outlives them
      const byRef = caps.defaultCapture === '&' ? capturedLocals(ctx, l).map((v) => v.name) : caps.items.filter((i) => /^&\s*\w+$/.test(i)).map((i) => i.replace(/^&\s*/, ''));
      const refLocals = byRef.filter((name) => {
        const v = ctx.symbols.resolve(name, l);
        return v && (v.kind === 'local' || v.kind === 'param');
      });
      if (refLocals.length > 0) {
        const parent = l.parent;
        let escapes = false;
        if (parent?.type === 'return_statement') escapes = true;
        else if (parent?.type === 'argument_list' || parent?.type === 'initializer_list') {
          const holder = parent.parent;
          if (holder?.type === 'call_expression') {
            const fn = field(holder, 'function');
            if (fn && /^(?:std::)?(?:thread|jthread|async|packaged_task)\b/.test(fn.text)) escapes = true;
          } else if (holder?.type === 'init_declarator') {
            const type = holder.parent ? field(holder.parent, 'type') : null;
            if (type && /^(?:std::)?(?:thread|jthread|packaged_task)\b/.test(ctx.src(type))) escapes = true;
          }
        } else if (parent?.type === 'init_declarator') {
          const decl = parent.parent;
          const type = decl ? field(decl, 'type') : null;
          if (type && /^(?:std::)?(?:thread|jthread)\b/.test(ctx.src(type))) escapes = true;
        }
        if (escapes) {
          ctx.report({
            ruleId: 'F.53',
            node: capNode,
            message: t('Avoid capturing by reference ({0}) in a lambda that outlives the enclosing function.', refLocals.join(', ')),
          });
        }
      }

      // F.50: capture-less, non-generic lambda bound to a namespace-scope name
      if (caps.defaultCapture === null && caps.items.length === 0) {
        const init = l.parent;
        const decl = init?.type === 'init_declarator' ? init.parent : null;
        if (decl?.type === 'declaration' && ['translation_unit', 'declaration_list'].includes(decl.parent?.type ?? '') && field(decl, 'type')?.type === 'placeholder_type_specifier') {
          const ld = field(l, 'declarator');
          const params = ld ? field(ld, 'parameters') : null;
          const generic = !!params && params.descendantsOfType('placeholder_type_specifier').length > 0;
          const hasTemplate = kids(l).some((k) => k.type === 'template_parameter_list');
          const body = field(l, 'body');
          if (!generic && !hasTemplate && body) {
            const name = shapeOf(init).nameNode?.text ?? '';
            const specs = ld ? kids(ld).filter((k) => k.type === 'type_qualifier' || k.type === 'noexcept' || k.type === 'constexpr').length : 0;
            const trailing = ld ? kids(ld).find((k) => k.type === 'trailing_return_type') : undefined;
            const retType = trailing ? ctx.src(trailing).replace(/^->\s*/, '') : 'auto';
            const storage = kids(decl).filter((k) => k.type === 'storage_class_specifier' || (k.type === 'type_qualifier' && k.text === 'constexpr')).map((k) => k.text);
            const fixes: Fix[] = [];
            if (specs === 0 && decl.childrenForFieldName('declarator').length === 1) {
              const prefix = [...storage, retType].join(' ');
              fixes.push(ctx.fix(t('Write an ordinary function'), [ctx.replace(decl, `${prefix} ${name}${params ? ctx.src(params) : '()'} ${ctx.src(body)}`)], 'unsafe'));
            }
            ctx.report({
              ruleId: 'F.50',
              node: init ?? l,
              message: t('A named lambda that captures nothing at namespace scope should be an ordinary function.'),
              fixes,
            });
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.56  Avoid unnecessary condition nesting
// ---------------------------------------------------------------------------------------------
function declarationFree(block: Node): boolean {
  return !kids(block).some((k) => k.type === 'declaration' || k.type === 'type_definition' || k.type === 'alias_declaration' || k.type === 'using_declaration');
}

function dedent(ctx: Context, text: string): string {
  const unit = ctx.indentUnit;
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith(unit) ? line.slice(unit.length) : line.replace(/^\t/, '')))
    .join(ctx.eol);
}

const nestingCheck: Check = {
  name: 'F.56 nesting',
  covers: ['F.56'],
  run(ctx) {
    for (const s of ctx.nodesOf('if_statement')) {
      const alt = field(s, 'alternative');
      const cons = field(s, 'consequence');
      if (!alt || !cons || !alwaysJumps(cons)) continue;
      const elseKeyword = kids(alt).find((k) => k.type === 'else');
      if (!elseKeyword) continue;
      const fixes: Fix[] = [];
      const body = namedKids(alt).find((n) => n.type !== 'comment');
      const parent = s.parent;
      if (body && parent && (parent.type === 'compound_statement' || parent.type === 'case_statement')) {
        const indent = ctx.indentAt(s.startIndex);
        let replacement: string | null = null;
        if (body.type === 'compound_statement') {
          if (declarationFree(body)) {
            const inner = ctx.slice(body.startIndex + 1, body.endIndex - 1);
            if (inner.includes('\n')) {
              const trimmed = inner.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
              replacement = `${ctx.eol}${dedent(ctx, trimmed)}`;
            } else {
              replacement = `${ctx.eol}${indent}${inner.trim()}`;
            }
          }
        } else {
          replacement = `${ctx.eol}${indent}${ctx.src(body)}`;
        }
        if (replacement !== null) fixes.push(ctx.fix(t('Remove the redundant else'), [ctx.replaceRange(cons.endIndex, alt.endIndex, replacement)]));
      }
      ctx.report({
        ruleId: 'F.56',
        node: elseKeyword,
        message: t('Redundant else: the if-branch always jumps; remove the else and un-nest its body.'),
        fixes,
      });
    }

    for (const f of functionsOf(ctx)) {
      if (f.node.type !== 'function_definition' || !f.body) continue;
      const stmts = namedKids(f.body).filter((n) => n.type !== 'comment');
      if (stmts.length === 1 && stmts[0].type === 'if_statement' && !field(stmts[0], 'alternative') && field(stmts[0], 'consequence')?.type === 'compound_statement') {
        ctx.report({
          ruleId: 'F.56',
          node: stmts[0],
          start: stmts[0].startIndex,
          end: field(stmts[0], 'condition')?.endIndex ?? stmts[0].endIndex,
          message: t('The whole function body is one conditional; invert the condition and return early.'),
        });
      }
    }
  },
};

export const f2Checks: Check[] = [rvalueParamCheck, returnLocalCheck, lambdaCheck, nestingCheck];
