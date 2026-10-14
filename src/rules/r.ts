import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { calleeName, isCallTo } from './util.js';

const SMART = /(?:^|::)(unique_ptr|shared_ptr)\b/;

interface NewInfo {
  node: Node;
  typeText: string;
  array: boolean;
  length: string;
  /** Text inside `( )` for a parenthesised initializer, null for none, undefined for `{ }` (aggregate semantics). */
  ctorArgs: string | null | undefined;
  placement: boolean;
}

function newInfo(ctx: Context, node: Node): NewInfo {
  const type = field(node, 'type');
  const declarator = field(node, 'declarator');
  const args = field(node, 'arguments');
  const length = declarator ? field(declarator, 'length') : null;
  let ctorArgs: string | null | undefined = null;
  if (args) ctorArgs = args.type === 'argument_list' ? ctx.src(args).slice(1, -1) : undefined;
  return {
    node,
    typeText: type ? ctx.src(type) : '',
    array: declarator?.type === 'new_declarator',
    length: length ? ctx.src(length) : '',
    ctorArgs,
    placement: !!field(node, 'placement'),
  };
}

/** True when the function that contains `n` returns the variable `name`. */
function returnedByName(n: Node, name: string): boolean {
  const fn = ancestor(n, 'function_definition');
  if (!fn) return false;
  return fn.descendantsOfType('return_statement').some((r) => {
    const v = r ? namedKids(r).find((k) => k.type !== 'comment') : undefined;
    return v?.type === 'identifier' && v.text === name;
  });
}

function makeCall(info: NewInfo, kind: 'unique' | 'shared'): string | null {
  const fn = kind === 'unique' ? 'std::make_unique' : 'std::make_shared';
  if (info.array) return info.length ? `${fn}<${info.typeText}[]>(${info.length})` : null;
  if (info.ctorArgs === undefined) return null;
  return `${fn}<${info.typeText}>(${info.ctorArgs ?? ''})`;
}

/** Constructors, destructors, operator new/delete, assignment, reset/release: where raw new/delete is acceptable. */
function inResourceFunction(ctx: Context, node: Node): boolean {
  const fn = ancestor(node, 'function_definition');
  if (!fn) return false;
  const nameNode = shapeOf(field(fn, 'declarator')).nameNode;
  if (!nameNode) return false;
  const full = ctx.src(nameNode);
  const last = full.split('::').pop() ?? full;
  if (last.startsWith('~') || /^operator\s*(?:new|delete)\b/.test(last) || /^operator\s*=$/.test(last) || last === 'reset' || last === 'release') return true;
  const cls = ancestor(fn, 'class_specifier', 'struct_specifier');
  const className = cls ? field(cls, 'name')?.text : full.includes('::') ? full.split('::').slice(-2, -1)[0] : undefined;
  return !!className && last === className;
}

function isFieldInitializerOfSmartMember(ctx: Context, init: Node): { smart: 'unique' | 'shared' | null } {
  const nameNode = kids(init).find((k) => k.type === 'field_identifier');
  if (!nameNode) return { smart: null };
  const v = ctx.symbols.resolve(nameNode.text, nameNode);
  const m = v ? SMART.exec(v.typeText) : null;
  return { smart: m ? (m[1] === 'unique_ptr' ? 'unique' : 'shared') : null };
}

// ---------------------------------------------------------------------------------------------
// R.11 / ES.60 / R.20 / R.22 / R.23 / C.149 / C.150 / C.151 / R.3 / R.12 / ES.24  Explicit allocation
// ---------------------------------------------------------------------------------------------
function declaredSmart(ctx: Context, decl: Node | null): 'unique' | 'shared' | null {
  const type = decl ? field(decl, 'type') : null;
  const m = type ? SMART.exec(ctx.src(type)) : null;
  return m ? (m[1] === 'unique_ptr' ? 'unique' : 'shared') : null;
}

const allocationCheck: Check = {
  name: 'R.11 explicit new/delete',
  covers: ['R.11', 'R.20', 'R.22', 'R.23', 'R.13', 'ES.61'],
  run(ctx) {
    const news = ctx.nodesOf('new_expression');
    for (const n of news) {
      const info = newInfo(ctx, n);
      if (info.placement) continue;
      const parent = n.parent;
      let smart: 'unique' | 'shared' | null = null;
      let replace: Node | null = null; // node replaced by make_*
      let reset: Node | null = null;

      if (parent?.type === 'argument_list') {
        const call = parent.parent;
        const fn = call?.type === 'call_expression' ? field(call, 'function') : null;
        if (fn && SMART.test(fn.text) && call) {
          smart = SMART.exec(fn.text)![1] === 'unique_ptr' ? 'unique' : 'shared';
          replace = call;
        } else if (fn?.type === 'field_expression' && field(fn, 'field')?.text === 'reset' && call) {
          const recv = field(fn, 'argument');
          const v = recv?.type === 'identifier' ? ctx.symbols.resolve(recv.text, recv) : undefined;
          const m = v ? SMART.exec(v.typeText) : null;
          if (m) {
            smart = m[1] === 'unique_ptr' ? 'unique' : 'shared';
            reset = call;
          }
        } else if (parent.parent?.type === 'init_declarator' || parent.parent?.type === 'field_initializer') {
          const holder = parent.parent;
          if (holder.type === 'init_declarator') smart = declaredSmart(ctx, holder.parent);
          else smart = isFieldInitializerOfSmartMember(ctx, holder).smart;
          replace = n;
        }
      } else if (parent?.type === 'initializer_list' && parent.parent?.type === 'init_declarator') {
        smart = declaredSmart(ctx, parent.parent.parent);
        replace = n;
      }

      if (smart) {
        const made = makeCall(info, smart);
        const edits: TextEdit[] = [];
        if (made && reset) {
          const recv = field(field(reset, 'function')!, 'argument')!;
          edits.push(ctx.replace(reset, `${ctx.src(recv)} = ${made}`));
        } else if (made && replace) edits.push(ctx.replace(replace, made));
        const fixes: Fix[] = made && edits.length > 0 ? [ctx.fix(t('Use {0}', smart === 'unique' ? 'std::make_unique' : 'std::make_shared'), [...edits, ...ctx.includeEdits('memory')])] : [];
        ctx.report({
          ruleId: smart === 'unique' ? 'R.23' : 'R.22',
          alsoCovers: [smart === 'unique' ? 'C.150' : 'C.151', 'R.11', 'ES.60'],
          node: n,
          message: smart === 'unique'
            ? t('Use std::make_unique to construct objects owned by a unique_ptr.')
            : t('Use std::make_shared to construct objects owned by a shared_ptr.'),
          fixes,
        });
        continue;
      }

      if (inResourceFunction(ctx, n)) continue;

      // new assigned to a raw pointer (an explicit gsl::owner<T*> is acceptable ownership)
      let ownerDecl: Node | null = null;
      let ownerName: string | null = null;
      let rawTarget = false;
      if (parent?.type === 'init_declarator' && field(parent, 'value')?.id === n.id) {
        const decl = parent.parent;
        const declType = decl ? field(decl, 'type') : null;
        if (declType && /^gsl::owner\s*</.test(ctx.src(declType).trim())) continue;
        const shape = shapeOf(parent);
        const auto = decl && field(decl, 'type')?.type === 'placeholder_type_specifier';
        if (decl?.type === 'declaration' && (shape.pointer || auto)) {
          rawTarget = true;
          ownerDecl = decl;
          ownerName = shape.nameNode?.text ?? null;
        }
      } else if (parent?.type === 'assignment_expression' && field(parent, 'right')?.id === n.id && parent.child(1)?.text === '=') {
        const left = field(parent, 'left');
        const v = left?.type === 'identifier' ? ctx.symbols.resolve(left.text, left) : undefined;
        if (v?.pointer || (left && left.type !== 'identifier' && /->|\./.test(left.text))) {
          rawTarget = true;
          ownerName = left?.text ?? null;
        }
      }

      if (rawTarget) {
        const fixes: Fix[] = [];
        const made = makeCall(info, 'unique');
        if (made && ownerDecl && ownerName && ownerDecl.type === 'declaration' && ownerDecl.childrenForFieldName('declarator').length === 1) {
          const edits: TextEdit[] = [ctx.replace(ownerDecl, `auto ${ownerName} = ${made};`), ...ctx.includeEdits('memory')];
          // drop the matching `delete` statements of the same function
          const fn = ancestor(ownerDecl, 'function_definition');
          if (fn) {
            for (const del of fn.descendantsOfType('delete_expression')) {
              const arg = del ? namedKids(del).find((k) => k.type !== 'comment') : null;
              const stmt = del?.parent;
              if (arg?.text === ownerName && stmt?.type === 'expression_statement') {
                edits.push(ctx.replaceRange(stmt.startIndex, stmt.endIndex, ''));
              }
            }
          }
          fixes.push(ctx.fix(t('Own it with std::unique_ptr'), edits, 'unsafe'));
        }
        if (ctx.config.gslEnabled && ownerDecl?.type === 'declaration' && ownerDecl.childrenForFieldName('declarator').length === 1) {
          const declType = field(ownerDecl, 'type');
          const initDecl = ownerDecl.childrenForFieldName('declarator')[0];
          const nm = shapeOf(initDecl).nameNode;
          if (declType && nm && declType.type !== 'placeholder_type_specifier') {
            const stars = ctx.slice(declType.endIndex, nm.startIndex).replace(/\s+/g, '');
            fixes.push(ctx.fix(t('Mark the pointer as gsl::owner'), [ctx.replaceRange(declType.startIndex, nm.startIndex, `gsl::owner<${ctx.src(declType)}${stars}> `)], 'unsafe'));
          }
        }
        ctx.report({
          ruleId: 'R.20',
          alsoCovers: ['R.3', 'R.11', 'R.12', 'ES.60', 'ES.24', 'C.149', 'I.11', 'F.42', 'P.8', 'P.3', ...(ownerName && returnedByName(n, ownerName) ? ['F.26'] : [])],
          node: n,
          message: t('Do not assign the result of new to a raw pointer; use std::unique_ptr (std::make_unique) or std::shared_ptr.'),
          fixes,
        });
        continue;
      }

      ctx.report({
        ruleId: 'R.11',
        alsoCovers: ['ES.60', 'P.8', 'P.3', ...(parent?.type === 'return_statement' ? ['F.26'] : [])],
        node: n,
        message: t('Avoid calling new explicitly; use std::make_unique, std::make_shared or a container.'),
      });
    }

    for (const d of ctx.nodesOf('delete_expression')) {
      if (inResourceFunction(ctx, d)) continue;
      ctx.report({
        ruleId: 'R.11',
        alsoCovers: ['ES.60', 'R.3', 'F.42', 'P.8'],
        node: d,
        message: t('Avoid calling delete explicitly; let a resource handle (RAII) own the object.'),
      });
    }

    // R.13: at most one explicit resource allocation in a single expression statement
    const STATEMENTS = ['expression_statement', 'declaration', 'return_statement'];
    for (const stmt of ctx.nodesOf(...STATEMENTS)) {
      if (!ancestor(stmt, 'function_definition')) continue;
      if (stmt.type !== 'return_statement' && ancestor(stmt, 'expression_statement', 'declaration')) continue;
      const allocations = [...stmt.descendantsOfType('new_expression'), ...stmt.descendantsOfType('call_expression').filter((c) => c && isCallTo(c, 'malloc', 'calloc', 'realloc'))].filter((n): n is Node => !!n && !field(n, 'placement'));
      const inLambda = (n: Node): boolean => !!ancestor(n, 'lambda_expression') && ancestor(n, 'lambda_expression')!.startIndex >= stmt.startIndex;
      const real = allocations.filter((n) => !inLambda(n));
      if (real.length > 1) {
        ctx.report({
          ruleId: 'R.13',
          node: real[1],
          message: t('Perform at most one explicit resource allocation in a single expression statement.'),
        });
      }
    }

    // ES.61: mismatched new / delete
    const checkMismatch = (kindOf: Map<string, boolean>, del: Node): void => {
      const arg = namedKids(del).find((k) => k.type !== 'comment');
      if (!arg) return;
      const isArrayDelete = /^delete\s*\[\s*\]/.test(ctx.src(del));
      const allocatedAsArray = kindOf.get(arg.text);
      if (allocatedAsArray === undefined || allocatedAsArray === isArrayDelete) return;
      const text = ctx.src(del);
      const fixed = allocatedAsArray ? text.replace(/^delete\b/, 'delete[]') : text.replace(/^delete\s*\[\s*\]/, 'delete');
      ctx.report({
        ruleId: 'ES.61',
        node: del,
        message: allocatedAsArray
          ? t('"{0}" was allocated with new[]; delete it with delete[].', arg.text)
          : t('"{0}" was allocated with new; delete it with delete (not delete[]).', arg.text),
        fixes: [ctx.fix(t('Fix the delete form'), [ctx.replace(del, fixed)])],
      });
    };
    for (const fn of ctx.nodesOf('function_definition')) {
      const kinds = new Map<string, boolean>();
      for (const n of fn.descendantsOfType('new_expression')) {
        if (!n || field(n, 'placement')) continue;
        const parent = n.parent;
        let name: string | null = null;
        if (parent?.type === 'init_declarator') name = shapeOf(parent).nameNode?.text ?? null;
        else if (parent?.type === 'assignment_expression') name = field(parent, 'left')?.text ?? null;
        if (name) kinds.set(name, field(n, 'declarator')?.type === 'new_declarator');
      }
      if (kinds.size === 0) continue;
      for (const del of fn.descendantsOfType('delete_expression')) if (del) checkMismatch(kinds, del);
    }
    // constructor / destructor pair of the same class
    for (const cls of ctx.nodesOf('class_specifier', 'struct_specifier')) {
      const body = field(cls, 'body');
      if (!body) continue;
      const kinds = new Map<string, boolean>();
      for (const n of body.descendantsOfType('new_expression')) {
        if (!n || field(n, 'placement')) continue;
        const parent = n.parent;
        let name: string | null = null;
        if (parent?.type === 'argument_list' && parent.parent?.type === 'field_initializer') name = kids(parent.parent).find((k) => k.type === 'field_identifier')?.text ?? null;
        else if (parent?.type === 'assignment_expression') name = field(parent, 'left')?.text ?? null;
        if (name) kinds.set(name, field(n, 'declarator')?.type === 'new_declarator');
      }
      if (kinds.size === 0) continue;
      for (const del of body.descendantsOfType('delete_expression')) if (del) checkMismatch(kinds, del);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// R.10  Avoid malloc() and free()
// ---------------------------------------------------------------------------------------------
const mallocCheck: Check = {
  name: 'R.10 malloc/free',
  covers: ['R.10'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      if (!isCallTo(call, 'malloc', 'calloc', 'realloc', 'free', 'aligned_alloc')) continue;
      const fn = field(call, 'function')!;
      if (fn.type === 'qualified_identifier' && field(fn, 'scope')?.text && field(fn, 'scope')!.text !== 'std') continue;
      ctx.report({
        ruleId: 'R.10',
        node: fn,
        message: t('Avoid {0}(); use std::vector, std::make_unique or another RAII type.', calleeName(fn)),
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// R.14  Avoid [] parameters, prefer span
// ---------------------------------------------------------------------------------------------
const arrayParamCheck: Check = {
  name: 'R.14 array parameters',
  covers: ['R.14'],
  run(ctx) {
    for (const p of ctx.nodesOf('parameter_declaration', 'optional_parameter_declaration')) {
      const d = field(p, 'declarator');
      if (d?.type !== 'array_declarator') continue;
      const fd = ancestor(p, 'function_declarator');
      const fname = fd ? field(fd, 'declarator')?.text : '';
      if (fname === 'main') continue; // `int main(int argc, char* argv[])` is the standard signature
      const type = field(p, 'type');
      const inner = field(d, 'declarator');
      const size = field(d, 'size');
      if (!type || inner?.type !== 'identifier') {
        ctx.report({ ruleId: 'R.14', node: d, message: t('Avoid [] parameters; use std::span instead.') });
        continue;
      }
      const qualifiers = kids(p).filter((k) => k.type === 'type_qualifier').map((k) => k.text);
      const elem = [...qualifiers, ctx.src(type)].join(' ');
      const span = size ? `std::span<${elem}, ${ctx.src(size)}>` : `std::span<${elem}>`;
      ctx.report({
        ruleId: 'R.14',
        node: d,
        message: t('Avoid [] parameters; use std::span instead.'),
        fixes: [ctx.fix(t('Use std::span'), [ctx.replaceRange(p.startIndex, p.endIndex, `${span} ${inner.text}`), ...ctx.includeEdits('span')], 'unsafe')],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// R.15  Always overload matched allocation/deallocation pairs
// ---------------------------------------------------------------------------------------------
const allocationPairCheck: Check = {
  name: 'R.15 allocation pairs',
  covers: ['R.15'],
  run(ctx) {
    const scopes = [...ctx.nodesOf('field_declaration_list'), ctx.root, ...ctx.nodesOf('declaration_list')];
    for (const scope of scopes) {
      const found = new Map<string, Node>();
      for (const decl of namedKids(scope)) {
        if (!['function_definition', 'field_declaration', 'declaration', 'template_declaration'].includes(decl.type)) continue;
        const target = decl.type === 'template_declaration' ? namedKids(decl).find((k) => k.type.endsWith('_definition') || k.type.endsWith('_declaration')) ?? decl : decl;
        const op = target.descendantsOfType('operator_name')[0];
        const m = op ? /^operator\s*(new|delete)(\s*\[\s*\])?$/.exec(op.text) : null;
        if (m) found.set(m[1] + (m[2] ? '[]' : ''), decl);
      }
      for (const [alloc, dealloc] of [['new', 'delete'], ['new[]', 'delete[]']]) {
        const a = found.get(alloc);
        const d = found.get(dealloc);
        if (a && !d) ctx.report({ ruleId: 'R.15', node: a, message: t('operator {0} is overloaded without a matching operator {1}.', alloc, dealloc) });
        if (d && !a) ctx.report({ ruleId: 'R.15', node: d, message: t('operator {0} is overloaded without a matching operator {1}.', dealloc, alloc) });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.7 / R.32-R.36  Smart pointer parameters
// ---------------------------------------------------------------------------------------------
const smartParamCheck: Check = {
  name: 'F.7 smart pointer parameters',
  covers: ['F.7', 'R.33', 'R.35'],
  run(ctx) {
    for (const fn of ctx.nodesOf('function_definition')) {
      const body = field(fn, 'body');
      if (!body) continue;
      const fd = fn.descendantsOfType('function_declarator')[0];
      const params = fd ? field(fd, 'parameters') : null;
      if (!params) continue;
      for (const p of namedKids(params)) {
        if (p.type !== 'parameter_declaration' && p.type !== 'optional_parameter_declaration') continue;
        const type = field(p, 'type');
        const m = type ? SMART.exec(ctx.src(type)) : null;
        if (!type || !m) continue;
        const shape = shapeOf(field(p, 'declarator'));
        const name = shape.nameNode?.text;
        if (!name) continue;
        const isConst = kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const');
        const uses = body.descendantsOfType('identifier').filter((n): n is Node => !!n && n.text === name);
        if (uses.length === 0) continue;

        const onlyPointee = uses.every((u) => {
          const parent = u.parent;
          if (parent?.type === 'pointer_expression' && parent.text.startsWith('*')) return true;
          if (parent?.type === 'field_expression' && field(parent, 'argument')?.id === u.id) {
            const f = field(parent, 'field')?.text;
            const arrow = ctx.slice(u.endIndex, field(parent, 'field')!.startIndex).includes('->');
            return arrow || f === 'get' || f === 'operator bool';
          }
          if (parent?.type === 'condition_clause' || (parent?.type === 'unary_expression' && parent.text.startsWith('!'))) return true;
          if (parent?.type === 'binary_expression' && ['==', '!='].includes(field(parent, 'operator')?.text ?? '')) return true;
          return false;
        });

        if (shape.reference && !isConst) {
          // R.33 / R.35: non-const lvalue reference to a smart pointer that is never reseated
          const reseats = uses.some((u) => {
            const parent = u.parent;
            if (parent?.type === 'assignment_expression' && field(parent, 'left')?.id === u.id) return true;
            if (parent?.type === 'field_expression' && ['reset', 'swap', 'release'].includes(field(parent, 'field')?.text ?? '')) return true;
            if (parent?.type === 'argument_list') return true; // may be passed on to something that reseats it
            return false;
          });
          if (!reseats) {
            ctx.report({
              ruleId: m[1] === 'unique_ptr' ? 'R.33' : 'R.35',
              node: p,
              message: t('"{0}" is never reseated; take a T* or T& instead of a reference to the smart pointer.', name),
            });
          }
        } else if (m[1] === 'shared_ptr' && (!shape.reference || isConst) && !shape.pointer && onlyPointee) {
          ctx.report({
            ruleId: 'F.7',
            alsoCovers: ['R.34', 'R.36'],
            node: p,
            message: t('"{0}" is only dereferenced; take a T* or T& instead of a shared_ptr.', name),
          });
        }
      }
    }
  },
};

export const rChecks: Check[] = [allocationCheck, mallocCheck, arrayParamCheck, allocationPairCheck, smartParamCheck];

export { SMART };
