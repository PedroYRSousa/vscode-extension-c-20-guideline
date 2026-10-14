import type { Node } from 'web-tree-sitter';
import { field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf, type VarInfo } from '../core/symbols.js';
import type { Check, TextEdit } from '../core/types.js';
import { declPrefix, identifierUses, normalizeType, signednessOfType } from './util.js';

const isIdentifier = (n: Node | null | undefined): n is Node => !!n && n.type === 'identifier';

function pointerVar(ctx: Context, n: Node | null): VarInfo | undefined {
  if (!isIdentifier(n)) return undefined;
  const v = ctx.symbols.resolve(n.text, n);
  return v && v.pointer && !v.array ? v : undefined;
}

function arrayVar(ctx: Context, n: Node | null): VarInfo | undefined {
  if (!isIdentifier(n)) return undefined;
  const v = ctx.symbols.resolve(n.text, n);
  if (!v) return undefined;
  if (v.array) return v;
  if (/^(?:std::)?array\b/.test(v.typeText.replace(/\s+/g, ''))) return v;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// ES.42 / F.22 / R.2 / I.13  Pointer arithmetic and unchecked array indexing
// ---------------------------------------------------------------------------------------------
const pointerCheck: Check = {
  name: 'ES.42 simple pointers',
  covers: ['ES.42'],
  run(ctx) {
    const alsoCovers = ['F.22', 'R.2', 'I.13', 'P.11'];
    const arithmetic = (node: Node, name: string): void =>
      ctx.report({
        ruleId: 'ES.42',
        alsoCovers,
        node,
        message: t('Pointer arithmetic on "{0}": use std::span, a range or an index instead.', name),
      });

    for (const e of ctx.nodesOf('update_expression')) {
      const arg = field(e, 'argument');
      const v = pointerVar(ctx, arg);
      if (v) arithmetic(e, v.name);
    }
    for (const e of ctx.nodesOf('assignment_expression')) {
      const op = e.child(1)?.text;
      if (op !== '+=' && op !== '-=') continue;
      const v = pointerVar(ctx, field(e, 'left'));
      if (v) arithmetic(e, v.name);
    }
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text;
      if (op !== '+' && op !== '-') continue;
      const l = pointerVar(ctx, field(e, 'left'));
      const r = pointerVar(ctx, field(e, 'right'));
      if (l && r) continue; // pointer difference is not a pointer
      if (l) arithmetic(e, l.name);
      else if (r && op === '+') arithmetic(e, r.name);
    }

    for (const e of ctx.nodesOf('subscript_expression')) {
      const base = field(e, 'argument');
      const v = arrayVar(ctx, base);
      if (!v) continue;
      const indices = field(e, 'indices');
      const index = indices ? namedKids(indices)[0] : undefined;
      if (!index) continue;
      if (index.type === 'number_literal') {
        // constant index: only the bound check remains (C arrays with a literal bound)
        const bound = v.declarator.descendantsOfType('array_declarator')[0];
        const size = bound ? field(bound, 'size') : null;
        const n = Number(index.text.replace(/'/g, ''));
        if (size?.type === 'number_literal' && Number.isInteger(n) && n >= 0 && n < Number(size.text)) continue;
        if (!size) continue;
      }
      const isStdArray = !v.array;
      ctx.report({
        ruleId: 'ES.42',
        alsoCovers: ['I.13'],
        node: e,
        message: t('Indexing the array "{0}" with a non-constant index is unchecked; use a range-for, std::span or at().', v.name),
        fixes: isStdArray && indices
          ? [ctx.fix(t('Use at() (bounds-checked)'), [ctx.replace(e, `${ctx.src(base!)}.at(${ctx.src(index)})`)], 'unsafe')]
          : [],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.43 / ES.44  Order of evaluation
// ---------------------------------------------------------------------------------------------
function modifiedNames(node: Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: Node): void => {
    if (n.type === 'update_expression') {
      const arg = field(n, 'argument');
      if (arg?.type === 'identifier') out.add(arg.text);
    } else if (n.type === 'assignment_expression') {
      const left = field(n, 'left');
      if (left?.type === 'identifier') out.add(left.text);
    }
    for (const c of kids(n)) {
      if (c.type === 'lambda_expression') continue;
      visit(c);
    }
  };
  visit(node);
  return out;
}

function usedNames(node: Node): Set<string> {
  return new Set(node.descendantsOfType('identifier').filter((n): n is Node => !!n).map((n) => n.text));
}

const evaluationOrderCheck: Check = {
  name: 'ES.43/44 order of evaluation',
  covers: ['ES.43', 'ES.44'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      const args = field(call, 'arguments');
      const items = args ? namedKids(args).filter((a) => a.type !== 'comment') : [];
      if (items.length < 2) continue;
      for (let i = 0; i < items.length; i++) {
        const mods = modifiedNames(items[i]);
        if (mods.size === 0) continue;
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const used = usedNames(items[j]);
          const clash = [...mods].find((m) => used.has(m));
          if (clash) {
            ctx.report({
              ruleId: 'ES.44',
              alsoCovers: ['ES.43'],
              node: items[i],
              message: t('The order of evaluation of function arguments is unspecified, but "{0}" is modified and used in different arguments.', clash),
            });
            i = items.length;
            break;
          }
        }
      }
    }
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text ?? '';
      if (op === '&&' || op === '||' || op === ',') continue;
      const left = field(e, 'left')!;
      const right = field(e, 'right')!;
      const lm = modifiedNames(left);
      const rm = modifiedNames(right);
      const clash = [...lm].find((m) => usedNames(right).has(m)) ?? [...rm].find((m) => usedNames(left).has(m));
      if (clash) {
        ctx.report({
          ruleId: 'ES.43',
          alsoCovers: ['ES.44'],
          node: e,
          message: t('"{0}" is modified and used in the same expression with an undefined order of evaluation.', clash),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.46  Lossy arithmetic conversions
// ---------------------------------------------------------------------------------------------
const FLOATING = /^(?:float|double|long double)$/;
const INTEGRAL = /^(?:(?:signed |unsigned )?(?:char|short|int|long|long long)|unsigned|bool|(?:std::)?(?:size_t|ptrdiff_t|u?int(?:8|16|32|64)_t))$/;

function builtinName(v: VarInfo | undefined): string | null {
  if (!v || v.pointer || v.array || v.reference || v.rvalueReference) return null;
  const n = normalizeType(v.typeText);
  return FLOATING.test(n) || INTEGRAL.test(n) ? n : null;
}

const narrowingCheck: Check = {
  name: 'ES.46 lossy conversions',
  covers: ['ES.46'],
  run(ctx) {
    const flag = (node: Node, from: string, to: string, valueText: string, replaceNode: Node): void =>
      ctx.report({
        ruleId: 'ES.46',
        node,
        message: t('Lossy conversion from {0} to {1}; make it explicit or avoid it.', from, to),
        fixes: [ctx.fix(t('Make the conversion explicit with static_cast'), [ctx.replace(replaceNode, `static_cast<${to}>(${valueText})`)])],
      });
    const lossy = (from: string, to: string): boolean =>
      (FLOATING.test(from) && INTEGRAL.test(to)) || (FLOATING.test(from) && /^(?:float)$/.test(to) && /^(?:double|long double)$/.test(from)) || (/^(?:long|long long|unsigned long|unsigned long long)$/.test(from) && /^(?:signed |unsigned )?char$/.test(to));

    for (const d of ctx.nodesOf('init_declarator')) {
      const decl = d.parent;
      if (decl?.type !== 'declaration') continue;
      const typeNode = field(decl, 'type');
      const shape = shapeOf(d);
      if (!typeNode || shape.pointer || shape.array || shape.reference) continue;
      const target = normalizeType(ctx.src(typeNode));
      const value = field(d, 'value');
      if (!isIdentifier(value)) continue;
      const src = builtinName(ctx.symbols.resolve(value.text, value));
      if (src && lossy(src, target)) flag(value, src, target, value.text, value);
    }
    for (const a of ctx.nodesOf('assignment_expression')) {
      if (a.child(1)?.text !== '=') continue;
      const left = field(a, 'left');
      const right = field(a, 'right');
      if (!isIdentifier(left) || !isIdentifier(right)) continue;
      const target = builtinName(ctx.symbols.resolve(left.text, left));
      const src = builtinName(ctx.symbols.resolve(right.text, right));
      if (target && src && lossy(src, target)) flag(right, src, target, right.text, right);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.100 / ES.102  Signed / unsigned mixing
// ---------------------------------------------------------------------------------------------
const MIXED_OPS = new Set(['<', '>', '<=', '>=', '==', '!=', '+', '-', '*', '/', '%']);

function typeOfOperand(ctx: Context, n: Node | null): { kind: 'signed' | 'unsigned' | 'size' | 'sizeof' | 'ptrdiff' | 'unknown'; var?: VarInfo } {
  if (!n) return { kind: 'unknown' };
  if (n.type === 'identifier') {
    const v = ctx.symbols.resolve(n.text, n);
    if (!v || v.pointer || v.array || v.isAuto) return { kind: 'unknown' };
    const norm = normalizeType(v.typeText);
    if (/^(?:std::)?ptrdiff_t$|^gsl::index$/.test(norm)) return { kind: 'ptrdiff', var: v };
    const s = signednessOfType(v.typeText);
    return s === 'unknown' ? { kind: 'unknown' } : { kind: s, var: v };
  }
  if (n.type === 'sizeof_expression') return { kind: 'sizeof' };
  if (n.type === 'call_expression') {
    const fn = field(n, 'function');
    if (fn?.type === 'field_expression' && field(fn, 'field')?.text === 'size' && namedKids(field(n, 'arguments')!).length === 0) return { kind: 'size' };
    if (fn && /^(?:std::)?size$/.test(fn.text)) return { kind: 'size' };
  }
  if (n.type === 'parenthesized_expression') return typeOfOperand(ctx, namedKids(n)[0] ?? null);
  return { kind: 'unknown' };
}

const signedMixCheck: Check = {
  name: 'ES.100/102 signed-unsigned',
  covers: ['ES.100', 'ES.102'],
  run(ctx) {
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text ?? '';
      if (!MIXED_OPS.has(op)) continue;
      const left = field(e, 'left');
      const right = field(e, 'right');
      const l = typeOfOperand(ctx, left);
      const r = typeOfOperand(ctx, right);
      const sizeLike = (k: string): boolean => k === 'size' || k === 'sizeof';
      let mixed = false;
      if ((l.kind === 'signed' && r.kind === 'unsigned') || (l.kind === 'unsigned' && r.kind === 'signed')) mixed = true;
      if (l.kind === 'signed' && sizeLike(r.kind)) mixed = true;
      if (r.kind === 'signed' && sizeLike(l.kind)) mixed = true;
      if (!mixed) continue; // `ptrdiff_t` vs size() is explicitly allowed by the guideline
      const fixes = [];
      const sizeCall = sizeLike(l.kind) ? left : sizeLike(r.kind) ? right : null;
      if (sizeCall?.type === 'call_expression') {
        const fn = field(sizeCall, 'function');
        if (fn?.type === 'field_expression') {
          const recv = field(fn, 'argument')!;
          const arrow = ctx.slice(recv.endIndex, field(fn, 'field')!.startIndex).includes('->');
          const argText = arrow ? `*${ctx.src(recv)}` : ctx.src(recv);
          fixes.push(
            ctx.fix(t('Use std::ssize'), [ctx.replace(sizeCall, `std::ssize(${argText})`), ...ctx.includeEdits('iterator')]),
          );
        }
      }
      ctx.report({
        ruleId: 'ES.100',
        alsoCovers: ['ES.102'],
        node: e,
        message: t("Don't mix signed and unsigned arithmetic or comparisons."),
        fixes,
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.71  Prefer a range-for statement
// ---------------------------------------------------------------------------------------------
const MUTATORS = new Set([
  'push_back', 'emplace_back', 'insert', 'emplace', 'erase', 'clear', 'resize', 'pop_back', 'pop_front',
  'push_front', 'emplace_front', 'assign', 'swap', 'reserve', 'shrink_to_fit', 'remove', 'remove_if', 'splice', 'merge', 'extract',
]);

function containerMutated(body: Node, containerText: string): boolean {
  for (const call of body.descendantsOfType('call_expression')) {
    const fn = call ? field(call, 'function') : null;
    if (fn?.type === 'field_expression' && field(fn, 'argument')?.text === containerText && MUTATORS.has(field(fn, 'field')?.text ?? '')) return true;
  }
  for (const a of body.descendantsOfType('assignment_expression')) {
    if (a && field(a, 'left')?.text === containerText) return true;
  }
  return false;
}

function freshName(body: Node, ctx: Context): string {
  const used = new Set(body.descendantsOfType('identifier').map((n) => n?.text ?? ''));
  const all = new Set(ctx.symbols.vars.map((v) => v.name));
  for (const c of ['element', 'item', 'value', 'entry', 'x']) if (!used.has(c) && !all.has(c)) return c;
  return 'element_';
}

function isReadOnlyUse(use: Node): boolean {
  let n = use;
  let p = n.parent;
  while (p?.type === 'parenthesized_expression') {
    n = p;
    p = p.parent;
  }
  if (!p) return false;
  switch (p.type) {
    case 'binary_expression':
    case 'return_statement':
    case 'conditional_expression':
    case 'condition_clause':
    case 'subscript_argument_list':
      return true;
    case 'unary_expression':
      return true;
    case 'init_declarator': {
      const decl = p.parent;
      return !!decl && !shapeOf(p).reference && !shapeOf(p).rvalueReference && !shapeOf(p).pointer;
    }
    case 'field_expression': {
      const parent = p.parent;
      if (parent?.type === 'call_expression' && field(parent, 'function')?.id === p.id) return false;
      if (parent?.type === 'assignment_expression' && field(parent, 'left')?.id === p.id) return false;
      return parent?.type !== 'update_expression';
    }
    default:
      return false;
  }
}

const rangeForCheck: Check = {
  name: 'ES.71 range-for',
  covers: ['ES.71'],
  run(ctx) {
    for (const loop of ctx.nodesOf('for_statement')) {
      const init = field(loop, 'initializer');
      const cond = field(loop, 'condition');
      const update = field(loop, 'update');
      const body = field(loop, 'body');
      if (!init || !cond || !update || !body || init.type !== 'declaration') continue;
      const declarators = init.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      if (declarators.length !== 1 || declarators[0].type !== 'init_declarator') continue;
      const d = declarators[0];
      const loopVar = shapeOf(d).nameNode?.text;
      const initValue = field(d, 'value');
      if (!loopVar || !initValue) continue;
      if (cond.type !== 'binary_expression') continue;
      const op = field(cond, 'operator')?.text;
      const condLeft = field(cond, 'left');
      const condRight = field(cond, 'right');
      if (condLeft?.text !== loopVar || !condRight) continue;

      const header = (container: Node | string, element: string, constness: boolean): TextEdit => {
        const c = typeof container === 'string' ? container : ctx.src(container);
        const bodyStart = body.startIndex;
        return ctx.replaceRange(loop.startIndex, bodyStart, `for (${constness ? 'const ' : ''}auto& ${element} : ${c}) `);
      };

      // (a) index loop:  for (T i = 0; i < c.size(); ++i)  { ... c[i] ... }
      const isZeroInit = /^0[uUlL]*$/.test(initValue.text) || initValue.text === '{0}' || initValue.type === 'initializer_list';
      const incr =
        (update.type === 'update_expression' && field(update, 'argument')?.text === loopVar && update.text.includes('++')) ||
        (update.type === 'assignment_expression' && field(update, 'left')?.text === loopVar && update.child(1)?.text === '+=' && field(update, 'right')?.text === '1');
      if (isZeroInit && incr && (op === '<' || op === '!=')) {
        let container: Node | null = null;
        if (condRight.type === 'call_expression') {
          const fn = field(condRight, 'function');
          const noArgs = namedKids(field(condRight, 'arguments')!).length === 0;
          if (fn?.type === 'field_expression' && field(fn, 'field')?.text === 'size' && noArgs) container = field(fn, 'argument');
          else if (fn && /^std::(?:size|ssize)$/.test(fn.text)) container = namedKids(field(condRight, 'arguments')!)[0] ?? null;
        }
        if (container && ['identifier', 'field_expression'].includes(container.type)) {
          const containerText = container.text;
          const uses = identifierUses(body, loopVar);
          const allSubscripts = uses.length > 0 && uses.every((u) => {
            const list = u.parent;
            const sub = list?.parent;
            return list?.type === 'subscript_argument_list' && sub?.type === 'subscript_expression' && field(sub, 'argument')?.text === containerText && namedKids(list).length === 1;
          });
          if (allSubscripts && !containerMutated(body, containerText)) {
            const subs = uses.map((u) => u.parent!.parent!);
            const element = freshName(body, ctx);
            const readOnly = subs.every(isReadOnlyUse);
            const edits: TextEdit[] = [header(container, element, readOnly), ...subs.map((s) => ctx.replace(s, element))];
            ctx.report({
              ruleId: 'ES.71',
              alsoCovers: ['P.3'],
              start: loop.startIndex,
              end: body.startIndex,
              message: t('Prefer a range-for statement: the loop only visits the elements of "{0}".', containerText),
              fixes: [ctx.fix(t('Convert to a range-for statement'), edits)],
            });
            continue;
          }
        }
      }

      // (b) iterator loop:  for (auto it = c.begin(); it != c.end(); ++it) { ... *it ... }
      if (initValue.type === 'call_expression' && op === '!=' && condRight.type === 'call_expression') {
        const bf = field(initValue, 'function');
        const ef = field(condRight, 'function');
        let container: Node | null = null;
        let isConst = false;
        if (bf?.type === 'field_expression' && ef?.type === 'field_expression') {
          const bn = field(bf, 'field')?.text;
          const en = field(ef, 'field')?.text;
          if ((bn === 'begin' && en === 'end') || (bn === 'cbegin' && en === 'cend')) {
            const a = field(bf, 'argument');
            const b = field(ef, 'argument');
            if (a && b && a.text === b.text && ['identifier', 'field_expression'].includes(a.type)) {
              container = a;
              isConst = bn === 'cbegin';
            }
          }
        }
        const incrIt = update.type === 'update_expression' && field(update, 'argument')?.text === loopVar;
        if (container && incrIt) {
          const containerText = container.text;
          const uses = identifierUses(body, loopVar);
          const derefs: Node[] = [];
          let ok = uses.length > 0;
          for (const u of uses) {
            const p = u.parent;
            if (p?.type === 'pointer_expression' && p.text.startsWith('*') && field(p, 'argument')?.id === u.id) derefs.push(p);
            else if (p?.type === 'field_expression' && field(p, 'argument')?.id === u.id && ctx.slice(u.endIndex, field(p, 'field')!.startIndex).includes('->')) derefs.push(p);
            else ok = false;
          }
          if (ok && !containerMutated(body, containerText)) {
            const element = freshName(body, ctx);
            const edits: TextEdit[] = [];
            let readOnly = isConst;
            if (!isConst) readOnly = derefs.every(isReadOnlyUse);
            for (const dref of derefs) {
              if (dref.type === 'pointer_expression') edits.push(ctx.replace(dref, element));
              else edits.push(ctx.replace(dref, `${element}.${field(dref, 'field')!.text}`));
            }
            edits.unshift(header(container, element, readOnly));
            ctx.report({
              ruleId: 'ES.71',
              start: loop.startIndex,
              end: body.startIndex,
              message: t('Prefer a range-for statement: the loop only visits the elements of "{0}".', containerText),
              fixes: [ctx.fix(t('Convert to a range-for statement'), edits)],
            });
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.6 / ES.74  Declare the loop variable in the for-initializer
// ---------------------------------------------------------------------------------------------
const loopScopeCheck: Check = {
  name: 'ES.6 loop variable scope',
  covers: ['ES.6'],
  run(ctx) {
    for (const loop of ctx.nodesOf('for_statement')) {
      const prev = loop.previousNamedSibling;
      if (prev?.type === 'comment') continue;
      if (prev?.type !== 'declaration' || prev.parent?.type !== 'compound_statement') continue;
      const declarators = prev.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      if (declarators.length !== 1) continue;
      const d = declarators[0];
      const shape = shapeOf(d);
      if (!shape.nameNode || shape.isFunction || shape.reference || shape.array) continue;
      const name = shape.nameNode.text;
      const init = field(loop, 'initializer');
      const cond = field(loop, 'condition');
      const update = field(loop, 'update');
      const body = field(loop, 'body');
      if (!body) continue;
      const loopMentions = (n: Node | null): boolean => !!n && identifierUses(n, name).length > 0;

      let edits: TextEdit[] | null = null;
      if (d.type !== 'init_declarator' && init?.type === 'assignment_expression') {
        // T i;  for (i = x; ...)  ->  for (T i = x; ...)
        if (field(init, 'left')?.text === name && init.child(1)?.text === '=') {
          const right = field(init, 'right')!;
          edits = [
            ctx.replace(init, `${declPrefix(ctx, prev).trimEnd()} ${ctx.src(d)} = ${ctx.src(right)}`),
            ctx.replaceRange(prev.startIndex, loop.startIndex, ''),
          ];
        }
      } else if (d.type === 'init_declarator' && !init && (loopMentions(cond) || loopMentions(update))) {
        // T i = x;  for (; i < n; ++i)  ->  for (T i = x; i < n; ++i)
        const firstSemicolon = kids(loop).find((k) => k.type === ';');
        if (firstSemicolon) {
          edits = [ctx.replace(firstSemicolon, ctx.src(prev)), ctx.replaceRange(prev.startIndex, loop.startIndex, '')];
        }
      }
      if (!edits) continue;
      // the variable must not be used after the loop
      const scope = prev.parent!;
      const after = identifierUses(scope, name).filter((u) => u.startIndex >= loop.endIndex);
      if (after.length > 0) continue;
      ctx.report({
        ruleId: 'ES.6',
        alsoCovers: ['ES.5', 'ES.74'],
        node: shape.nameNode,
        message: t('Declare "{0}" in the for-statement initializer to limit its scope.', name),
        fixes: [ctx.fix(t('Move the declaration into the for-statement'), edits)],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.84 / CP.44  Unnamed temporaries
// ---------------------------------------------------------------------------------------------
const LOCK_TYPES = /^(?:std::)?(?:lock_guard|unique_lock|scoped_lock|shared_lock)\b/;

const temporaryCheck: Check = {
  name: 'ES.84 unnamed temporaries',
  covers: ['ES.84', 'CP.44'],
  run(ctx) {
    for (const stmt of ctx.nodesOf('expression_statement')) {
      const e = namedKids(stmt)[0];
      if (!e) continue;
      let typeNode: Node | null = null;
      let init = '';
      if (e.type === 'compound_literal_expression') {
        typeNode = field(e, 'type');
        init = ctx.src(field(e, 'value')!);
      } else if (e.type === 'call_expression') {
        const fn = field(e, 'function');
        if (fn && (fn.type === 'qualified_identifier' || fn.type === 'template_function') && fn.text.includes('<')) {
          typeNode = fn;
          init = `{${ctx.src(field(e, 'arguments')!).slice(1, -1)}}`;
        }
      }
      if (!typeNode) continue;
      const typeText = ctx.src(typeNode);
      const isLock = LOCK_TYPES.test(typeText);
      if (!isLock && !typeText.includes('<')) continue;
      const names = new Set(ctx.symbols.vars.map((v) => v.name));
      let name = isLock ? 'lock' : 'tmp';
      for (let i = 2; names.has(name); i++) name = `${isLock ? 'lock' : 'tmp'}_${i}`;
      ctx.report({
        ruleId: isLock ? 'CP.44' : 'ES.84',
        alsoCovers: isLock ? ['ES.84'] : [],
        node: stmt,
        message: isLock
          ? t('Remember to name your lock_guard/unique_lock; an unnamed one is destroyed immediately.')
          : t("Don't try to declare a local variable with no name; this statement is just a temporary."),
        fixes: [ctx.fix(t('Give the object a name'), [ctx.replace(stmt, `${typeText} ${name}${init};`)], 'unsafe')],
      });
    }
  },
};

export const es3Checks: Check[] = [
  pointerCheck,
  evaluationOrderCheck,
  narrowingCheck,
  signedMixCheck,
  rangeForCheck,
  loopScopeCheck,
  temporaryCheck,
];

export { pointerVar, arrayVar };
