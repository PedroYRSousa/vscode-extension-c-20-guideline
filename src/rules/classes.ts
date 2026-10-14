import type { Node } from 'web-tree-sitter';
import { field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { shapeOf } from '../core/symbols.js';
import { functionsOf, isSingleParamOf, type FuncInfo } from './funcs.js';

export type Access = 'public' | 'protected' | 'private';

export interface FieldInfo {
  node: Node;
  access: Access;
  names: Node[];
  isStatic: boolean;
  isConst: boolean;
  isReference: boolean;
  isPointer: boolean;
  isArray: boolean;
  typeText: string;
  /** Has a default member initializer. */
  hasInitializer: boolean;
}

export interface MemberFunction {
  info: FuncInfo;
  access: Access;
  isVirtual: boolean;
  isOverride: boolean;
  isFinal: boolean;
  isPure: boolean;
}

export interface ClassInfo {
  node: Node;
  keyword: 'class' | 'struct' | 'union';
  name: string;
  nameNode: Node | null;
  body: Node;
  bases: Array<{ name: string; access: Access | null; node: Node }>;
  fields: FieldInfo[];
  functions: MemberFunction[];
  isFinal: boolean;
  /** Access sections in order of appearance (the implicit first one is included when non-empty). */
  accessLabels: Array<{ node: Node | null; access: Access }>;
}

const cache = new WeakMap<Context, ClassInfo[]>();

function stripTemplate(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.trim();
}

export function classesOf(ctx: Context): ClassInfo[] {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const out: ClassInfo[] = [];
  const allFuncs = functionsOf(ctx);
  for (const node of ctx.nodesOf('class_specifier', 'struct_specifier', 'union_specifier')) {
    const body = field(node, 'body');
    if (!body) continue;
    const keyword = node.type === 'class_specifier' ? 'class' : node.type === 'struct_specifier' ? 'struct' : 'union';
    const nameNode = field(node, 'name');
    const name = nameNode ? stripTemplate(nameNode.text) : '';
    const bases: ClassInfo['bases'] = [];
    const baseClause = kids(node).find((k) => k.type === 'base_class_clause');
    if (baseClause) {
      const parts = kids(baseClause);
      let access: Access | null = null;
      for (const p of parts) {
        if (p.type === 'access_specifier') access = p.text as Access;
        else if (p.type === 'type_identifier' || p.type === 'qualified_identifier' || p.type === 'template_type') {
          bases.push({ name: stripTemplate(p.text).split('::').pop() ?? p.text, access, node: p });
          access = null;
        } else if (p.type === ',') access = null;
      }
    }
    let current: Access = keyword === 'class' ? 'private' : 'public';
    const fields: FieldInfo[] = [];
    const functions: MemberFunction[] = [];
    const accessLabels: ClassInfo['accessLabels'] = [{ node: null, access: current }];
    const funcByNode = new Map<number, FuncInfo>();
    for (const f of allFuncs) funcByNode.set(f.node.id, f);

    for (const child of kids(body)) {
      if (child.type === 'access_specifier') {
        current = child.text as Access;
        accessLabels.push({ node: child, access: current });
        continue;
      }
      let target = child;
      if (target.type === 'template_declaration') target = namedKids(target).find((k) => k.type !== 'template_parameter_list' && k.type !== 'comment') ?? target;
      if (target.type === 'friend_declaration') continue;
      const fi = funcByNode.get(target.id);
      if (fi) {
        const specs = kids(target).concat(kids(fi.declarator));
        const text = (types: string[], val?: string): boolean => specs.some((k) => types.includes(k.type) && (!val || k.text === val));
        functions.push({
          info: fi,
          access: current,
          isVirtual: fi.isVirtualSpecified || text(['virtual_function_specifier']) || specs.some((k) => k.text === 'virtual'),
          isOverride: specs.some((k) => k.type === 'virtual_specifier' && k.text === 'override'),
          isFinal: specs.some((k) => k.type === 'virtual_specifier' && k.text === 'final'),
          isPure: kids(target).some((k) => k.type === 'number_literal' && k.text === '0') || /=\s*0\s*;?\s*$/.test(ctx.src(target)),
        });
        continue;
      }
      if (target.type === 'field_declaration') {
        const declarators = target.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
        const typeNode = field(target, 'type');
        const quals = kids(target).filter((k) => k.type === 'type_qualifier').map((k) => k.text);
        const storage = kids(target).filter((k) => k.type === 'storage_class_specifier').map((k) => k.text);
        const shapes = declarators.map((d) => shapeOf(d));
        if (shapes.some((s) => s.isFunction)) continue;
        fields.push({
          node: target,
          access: current,
          names: shapes.map((s) => s.nameNode).filter((n): n is Node => !!n),
          isStatic: storage.includes('static'),
          isConst: quals.includes('const') || quals.includes('constexpr') || shapes.some((s) => s.topConst),
          isReference: shapes.some((s) => s.reference || s.rvalueReference),
          isPointer: shapes.some((s) => s.pointer),
          isArray: shapes.some((s) => s.array),
          typeText: typeNode ? ctx.src(typeNode) : '',
          hasInitializer: kids(target).some((k) => k.type === 'initializer_list' || k.text === '=') || declarators.some((d) => d.type === 'init_declarator') || kids(target).some((k) => k.type === 'default_value'),
        });
      }
    }
    out.push({
      node,
      keyword,
      name,
      nameNode,
      body,
      bases,
      fields,
      functions,
      isFinal: kids(node).some((k) => k.type === 'virtual_specifier' && k.text === 'final'),
      accessLabels,
    });
  }
  cache.set(ctx, out);
  return out;
}

export function classByName(ctx: Context, name: string): ClassInfo | undefined {
  return classesOf(ctx).find((c) => c.name === name);
}

// ---- special member classification ---------------------------------------------------------

export interface SpecialMembers {
  defaultCtor: MemberFunction[];
  copyCtor: MemberFunction[];
  moveCtor: MemberFunction[];
  copyAssign: MemberFunction[];
  moveAssign: MemberFunction[];
  dtor: MemberFunction[];
  otherCtors: MemberFunction[];
}

export function specialMembers(ctx: Context, c: ClassInfo): SpecialMembers {
  const sm: SpecialMembers = { defaultCtor: [], copyCtor: [], moveCtor: [], copyAssign: [], moveAssign: [], dtor: [], otherCtors: [] };
  for (const m of c.functions) {
    const f = m.info;
    if (f.isDestructor) sm.dtor.push(m);
    else if (f.isConstructor) {
      if (isSingleParamOf(ctx, f, 'move')) sm.moveCtor.push(m);
      else if (isSingleParamOf(ctx, f, 'copy') || (isSingleParamOf(ctx, f, 'any-ref') && !isSingleParamOf(ctx, f, 'move'))) sm.copyCtor.push(m);
      else if (f.params.every((p) => p.type === 'optional_parameter_declaration' || p.type === 'variadic_parameter_declaration')) sm.defaultCtor.push(m);
      else sm.otherCtors.push(m);
    } else if (f.name === 'operator=') {
      if (isSingleParamOf(ctx, f, 'move')) sm.moveAssign.push(m);
      else if (isSingleParamOf(ctx, f, 'any-ref')) sm.copyAssign.push(m);
      else if (f.params.length === 1) sm.copyAssign.push(m); // by-value (copy-and-swap) assignment
    }
  }
  return sm;
}

export function isDataMember(f: FieldInfo): boolean {
  return !f.isStatic;
}
