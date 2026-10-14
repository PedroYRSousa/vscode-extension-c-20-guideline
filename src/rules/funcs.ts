import type { Node } from 'web-tree-sitter';
import { ancestor, field, functionDeclarator, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { shapeOf } from '../core/symbols.js';

export interface FuncInfo {
  /** function_definition | declaration | field_declaration */
  node: Node;
  declarator: Node;
  nameNode: Node;
  /** Unqualified name as spelled: `swap`, `operator=`, `~X`, `X`. */
  name: string;
  /** Enclosing class (in-class) or the qualifier of an out-of-line definition, without template arguments. */
  className: string | null;
  body: Node | null;
  params: Node[];
  returnType: Node | null;
  returnsPointer: boolean;
  returnsReference: boolean;
  returnsRvalueReference: boolean;
  isConst: boolean;
  noexcept: 'none' | 'true' | 'false' | 'expr';
  noexceptNode: Node | null;
  isDefaulted: boolean;
  isDeleted: boolean;
  isDestructor: boolean;
  isConstructor: boolean;
  isOperator: boolean;
  isVirtualSpecified: boolean;
  isTemplate: boolean;
  isStatic: boolean;
}

const cache = new WeakMap<Context, FuncInfo[]>();

function stripTemplateArgs(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.trim();
}

export function functionsOf(ctx: Context): FuncInfo[] {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const out: FuncInfo[] = [];
  for (const node of ctx.nodesOf('function_definition', 'declaration', 'field_declaration')) {
    const declarator = field(node, 'declarator');
    const fd = functionDeclarator(declarator);
    if (!fd || !declarator) continue;
    // `int x(5);` style declarations inside functions are variables, not functions
    if (node.type === 'declaration' && ancestor(node, 'function_definition', 'lambda_expression')) continue;
    const shape = shapeOf(declarator);
    if (!shape.nameNode) continue;
    const nameNode = shape.nameNode;
    const full = ctx.src(nameNode);
    const parts = stripTemplateArgs(full).split('::');
    const name = parts[parts.length - 1].trim();
    const cls = ancestor(node, 'class_specifier', 'struct_specifier', 'union_specifier');
    let className: string | null = cls ? (field(cls, 'name') ? stripTemplateArgs(field(cls, 'name')!.text) : null) : null;
    if (!className && parts.length > 1) className = parts[parts.length - 2].trim();
    const params = field(fd, 'parameters');
    const noexceptNode = kids(fd).find((k) => k.type === 'noexcept') ?? null;
    let noexcept: FuncInfo['noexcept'] = 'none';
    if (noexceptNode) {
      const compact = ctx.src(noexceptNode).replace(/\s+/g, '');
      noexcept = compact === 'noexcept' || compact === 'noexcept(true)' ? 'true' : compact === 'noexcept(false)' ? 'false' : 'expr';
    }
    const isDestructor = name.startsWith('~');
    out.push({
      node,
      declarator: fd,
      nameNode,
      name,
      className,
      body: field(node, 'body'),
      params: params ? namedKids(params).filter((p) => p.type === 'parameter_declaration' || p.type === 'optional_parameter_declaration' || p.type === 'variadic_parameter_declaration') : [],
      returnType: field(node, 'type'),
      returnsPointer: shape.pointer,
      returnsReference: shape.reference,
      returnsRvalueReference: shape.rvalueReference,
      isConst: kids(fd).some((k) => k.type === 'type_qualifier' && k.text === 'const'),
      noexcept,
      noexceptNode,
      isDefaulted: kids(node).some((k) => k.type === 'default_method_clause'),
      isDeleted: kids(node).some((k) => k.type === 'delete_method_clause'),
      isDestructor,
      isConstructor: !isDestructor && !!className && name === className,
      isOperator: name.startsWith('operator'),
      isVirtualSpecified: kids(node).some((k) => k.type === 'virtual' || k.type === 'virtual_function_specifier'),
      isTemplate: ancestor(node, 'template_declaration') !== null,
      isStatic: kids(node).some((k) => k.type === 'storage_class_specifier' && k.text === 'static'),
    });
  }
  cache.set(ctx, out);
  return out;
}

/** Spelled type of a parameter without its name (`const X&`, `X&&`, `int*`). */
export function paramTypeText(ctx: Context, param: Node): string {
  const type = field(param, 'type');
  if (!type) return ctx.src(param);
  const quals = kids(param).filter((k) => k.type === 'type_qualifier').map((k) => k.text);
  const decl = field(param, 'declarator');
  let suffix = '';
  if (decl) {
    const t = ctx.src(decl);
    const name = shapeOf(decl).nameNode?.text ?? '';
    suffix = name ? t.replace(new RegExp(`\\s*\\b${name}\\b[\\s\\S]*$`), '') : t;
  }
  return [...quals, ctx.src(type)].join(' ') + suffix.replace(/\s+/g, '');
}

export function paramName(param: Node): string | null {
  return shapeOf(field(param, 'declarator')).nameNode?.text ?? null;
}

/** True when `params` is a single parameter of type `X&&` / `const X&` / `X&` for class `cls`. */
export function isSingleParamOf(ctx: Context, f: FuncInfo, form: 'move' | 'copy' | 'any-ref'): boolean {
  if (!f.className) return false;
  const real = f.params.filter((p, i) => i === 0 || p.type === 'optional_parameter_declaration');
  if (real.length === 0 || f.params.length < 1) return false;
  const p = f.params[0];
  if (f.params.slice(1).some((q) => q.type !== 'optional_parameter_declaration')) return false;
  const type = field(p, 'type');
  const shape = shapeOf(field(p, 'declarator') ?? null);
  const abstractDecl = field(p, 'declarator');
  const rvalue = shape.rvalueReference || abstractDecl?.type === 'abstract_reference_declarator' && abstractDecl.text.startsWith('&&');
  const lvalue = shape.reference || (abstractDecl?.type === 'abstract_reference_declarator' && !abstractDecl.text.startsWith('&&'));
  const tname = type ? stripTemplateArgs(ctx.src(type)).split('::').pop() : '';
  const isClass = tname === f.className;
  const isConstP = kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const');
  if (!isClass) return false;
  if (form === 'move') return !!rvalue && !isConstP;
  if (form === 'copy') return !!lvalue && isConstP;
  return !!rvalue || !!lvalue;
}
