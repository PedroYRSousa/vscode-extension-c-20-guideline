import type { Node } from 'web-tree-sitter';
import { field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';

/** Builtin arithmetic type keywords as spelled by tree-sitter (`primitive_type`, `sized_type_specifier`). */
export const SIGNED_NAMES = /^(?:(?:signed\s+)?(?:short|int|long|long\s+long|char)|(?:std::)?(?:ptrdiff_t|ssize_t|int(?:8|16|32|64)_t|intptr_t|intmax_t))$/;
export const UNSIGNED_NAMES = /^(?:(?:unsigned)(?:\s+(?:short|int|long|long\s+long|char))?|(?:std::)?(?:size_t|uint(?:8|16|32|64)_t|uintptr_t|uintmax_t))$/;

export function normalizeType(text: string): string {
  return text
    .replace(/\b(?:const|volatile|constexpr|static|inline|extern|register|mutable)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Signedness = 'signed' | 'unsigned' | 'unknown';

export function signednessOfType(typeText: string): Signedness {
  const n = normalizeType(typeText);
  if (UNSIGNED_NAMES.test(n)) return 'unsigned';
  if (SIGNED_NAMES.test(n)) return 'signed';
  return 'unknown';
}

export function isStdQualified(node: Node | null, name: string): boolean {
  if (!node) return false;
  if (node.type !== 'qualified_identifier') return false;
  const scope = field(node, 'scope');
  const nm = field(node, 'name');
  return !!scope && !!nm && scope.text === 'std' && (nm.text === name || nm.text.startsWith(name + '<'));
}

/** `std::move`, `move` → 'move'; `std::vector<int>::size` → 'size'. Template arguments are dropped. */
export function calleeName(fn: Node | null): string {
  if (!fn) return '';
  switch (fn.type) {
    case 'identifier':
    case 'field_identifier':
    case 'type_identifier':
      return fn.text;
    case 'qualified_identifier': {
      const name = field(fn, 'name');
      return calleeName(name);
    }
    case 'template_function':
    case 'template_type': {
      const name = field(fn, 'name');
      return calleeName(name);
    }
    case 'field_expression': {
      const f = field(fn, 'field');
      return calleeName(f);
    }
    default:
      return '';
  }
}

/** True for `std::name(...)` / `name(...)` calls (when not explicitly qualified by another namespace). */
export function isCallTo(call: Node, ...names: string[]): boolean {
  if (call.type !== 'call_expression') return false;
  const fn = field(call, 'function');
  if (!fn) return false;
  const name = calleeName(fn);
  if (!names.includes(name)) return false;
  if (fn.type === 'qualified_identifier') {
    const scope = field(fn, 'scope');
    return !scope || scope.text === 'std' || scope.text === '';
  }
  return fn.type === 'identifier' || fn.type === 'template_function';
}

export function callArgs(call: Node): Node[] {
  const args = field(call, 'arguments');
  return args ? namedKids(args).filter((n) => n.type !== 'comment') : [];
}

export function isIntegerLiteral(text: string): boolean {
  return /^(?:0[xX][0-9a-fA-F']+|0[bB][01']+|[0-9][0-9']*)(?:[uU]?[lL]{0,2}|[lL]{1,2}[uU]?|[zZ][uU]?|[uU][zZ])$/.test(text);
}

export function isZeroLiteral(text: string): boolean {
  return /^(?:0[xX]0+|0[bB]0+|0+)(?:[uU]?[lL]{0,2}|[lL]{1,2}[uU]?)$/.test(text);
}

/** Text of the declaration's leading specifiers + type (everything before the first declarator). */
export function declPrefix(ctx: Context, decl: Node): string {
  const first = decl.childrenForFieldName('declarator').find((n): n is Node => n !== null);
  return first ? ctx.slice(decl.startIndex, first.startIndex) : ctx.src(decl);
}

/** Last statement of a block-like node (skips comments). */
export function lastStatement(block: Node): Node | null {
  const items = namedKids(block).filter((n) => n.type !== 'comment');
  return items.length > 0 ? items[items.length - 1] : null;
}

const NORETURN_CALLS = new Set(['abort', 'exit', 'quick_exit', '_Exit', 'terminate', 'unreachable', '__builtin_unreachable']);

/** True when control can never continue past `stmt` (return/throw/break/continue/goto/noreturn call). */
export function alwaysJumps(stmt: Node | null): boolean {
  if (!stmt) return false;
  switch (stmt.type) {
    case 'return_statement':
    case 'throw_statement':
    case 'break_statement':
    case 'continue_statement':
    case 'goto_statement':
    case 'co_return_statement':
      return true;
    case 'compound_statement':
      return alwaysJumps(lastStatement(stmt));
    case 'expression_statement': {
      const e = namedKids(stmt)[0];
      if (!e) return false;
      if (e.type === 'throw_expression') return true;
      return e.type === 'call_expression' && isCallTo(e, ...NORETURN_CALLS);
    }
    case 'if_statement': {
      const alt = field(stmt, 'alternative');
      if (!alt) return false;
      const consequence = field(stmt, 'consequence');
      const altBody = namedKids(alt).find((n) => n.type !== 'comment') ?? null;
      return alwaysJumps(consequence) && alwaysJumps(altBody);
    }
    default:
      return false;
  }
}

/** Statements of a `case_statement` (everything after the label). */
export function caseBody(c: Node): Node[] {
  const value = field(c, 'value');
  return namedKids(c).filter((n) => n.type !== 'comment' && (!value || n.id !== value.id));
}

export function isIdentifierLike(node: Node | null): boolean {
  return !!node && (node.type === 'identifier' || node.type === 'field_identifier' || node.type === 'type_identifier');
}

/** All nodes in `scope` whose text is the identifier `name` (identifier kinds only). */
export function identifierUses(scope: Node, name: string): Node[] {
  return scope
    .descendantsOfType(['identifier', 'field_identifier', 'type_identifier'])
    .filter((n): n is Node => n !== null && n.text === name);
}

export function directChildren(node: Node, type: string): Node[] {
  return kids(node).filter((c) => c.type === type);
}
