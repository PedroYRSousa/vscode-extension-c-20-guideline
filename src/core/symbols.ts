import type { Node } from 'web-tree-sitter';
import { ancestor, ancestorWhere, field, kids, namedKids } from './ast.js';

/**
 * A lightweight, syntax-only symbol table: which names are declared where, and with what declarator
 * shape (pointer / reference / array / const). It does not know types beyond the spelled declaration,
 * so every consumer must stay conservative.
 */
export interface VarInfo {
  name: string;
  kind: 'local' | 'param' | 'member' | 'global';
  nameNode: Node;
  /** declaration | parameter_declaration | optional_parameter_declaration | field_declaration | ... */
  declNode: Node;
  /** The declarator that introduces the name (init_declarator unwrapped). */
  declarator: Node;
  /** Spelled base type, without declarator parts (`const std::string`). */
  typeText: string;
  /** The node of the `type` field, when present. */
  typeNode: Node | null;
  pointer: boolean;
  reference: boolean;
  rvalueReference: boolean;
  array: boolean;
  isAuto: boolean;
  isStatic: boolean;
  isExtern: boolean;
  isConstexpr: boolean;
  /** The object itself is const (`const int x`, `int* const p`). */
  isConst: boolean;
  /** The pointee/referee is const (`const int* p`, `const T& r`). */
  pointeeConst: boolean;
  initializer: Node | null;
  /** Innermost scope node: compound_statement, function_definition (params), for/if/while/switch, class body, namespace, unit. */
  scope: Node;
}

const SCOPE_TYPES = new Set([
  'compound_statement',
  'for_statement',
  'for_range_loop',
  'if_statement',
  'while_statement',
  'switch_statement',
  'do_statement',
  'lambda_expression',
  'function_definition',
  'field_declaration_list',
  'namespace_definition',
  'declaration_list',
  'translation_unit',
  'catch_clause',
]);

const DECL_TYPES = [
  'declaration',
  'parameter_declaration',
  'optional_parameter_declaration',
  'field_declaration',
  'for_range_loop',
  'condition_clause',
];

export function scopeOf(node: Node): Node {
  const fn = ancestorWhere(node, (n) => SCOPE_TYPES.has(n.type));
  return fn ?? node;
}

interface DeclaratorShape {
  nameNode: Node | null;
  pointer: boolean;
  reference: boolean;
  rvalueReference: boolean;
  array: boolean;
  isFunction: boolean;
  /** `const` qualifier located after the outermost `*` (`T* const`). */
  topConst: boolean;
}

/** Walk a declarator chain down to the declared name. */
export function shapeOf(declarator: Node | null): DeclaratorShape {
  const shape: DeclaratorShape = {
    nameNode: null,
    pointer: false,
    reference: false,
    rvalueReference: false,
    array: false,
    isFunction: false,
    topConst: false,
  };
  let d = declarator;
  let outermostPointer = true;
  while (d) {
    switch (d.type) {
      case 'init_declarator':
      case 'parenthesized_declarator':
        d = field(d, 'declarator') ?? namedKids(d)[0] ?? null;
        continue;
      case 'pointer_declarator':
        shape.pointer = true;
        if (outermostPointer && kids(d).some((c) => c.type === 'type_qualifier' && c.text === 'const')) shape.topConst = true;
        outermostPointer = false;
        d = field(d, 'declarator');
        continue;
      case 'reference_declarator':
        if (d.text.startsWith('&&')) shape.rvalueReference = true;
        else shape.reference = true;
        d = namedKids(d).find((c) => /declarator$|identifier$/.test(c.type)) ?? null;
        continue;
      case 'array_declarator':
        shape.array = true;
        d = field(d, 'declarator');
        continue;
      case 'function_declarator':
        shape.isFunction = true;
        d = field(d, 'declarator');
        continue;
      case 'identifier':
      case 'field_identifier':
      case 'qualified_identifier':
      case 'operator_name':
      case 'destructor_name':
        shape.nameNode = d;
        return shape;
      default:
        d = field(d, 'declarator') ?? null;
    }
  }
  return shape;
}

function hasQualifier(node: Node, ...names: string[]): boolean {
  return kids(node).some((c) => (c.type === 'type_qualifier' || c.type === 'storage_class_specifier') && names.includes(c.text));
}

export class SymbolTable {
  readonly vars: VarInfo[] = [];
  private byName = new Map<string, VarInfo[]>();

  constructor(root: Node, private readonly text: string) {
    for (const type of DECL_TYPES) {
      for (const decl of root.descendantsOfType(type)) if (decl) this.collect(decl);
    }
    for (const v of this.vars) {
      const list = this.byName.get(v.name);
      if (list) list.push(v);
      else this.byName.set(v.name, [v]);
    }
  }

  private collect(decl: Node): void {
    const typeNode = field(decl, 'type');
    // declarators: the `declarator` field may repeat (`int a, b;`)
    const declarators: Node[] = decl.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
    if (decl.type === 'for_range_loop' || decl.type === 'condition_clause') {
      const d = field(decl, 'declarator') ?? field(decl, 'value');
      if (decl.type === 'condition_clause' && !field(decl, 'initializer')) {
        // `if (T x = ...)` is a declaration, `if (x)` is not
        const value = field(decl, 'value');
        if (!value || value.type !== 'declaration') return;
      }
      if (decl.type === 'for_range_loop' && d) declarators.push(d);
      if (declarators.length === 0) return;
    }
    if (declarators.length === 0) return;
    const baseText = typeNode ? this.text.slice(typeNode.startIndex, typeNode.endIndex) : '';
    const declConst = hasQualifier(decl, 'const', 'constexpr', 'consteval');
    const isStatic = hasQualifier(decl, 'static', 'thread_local');
    const isExtern = hasQualifier(decl, 'extern');
    const isConstexpr = hasQualifier(decl, 'constexpr');
    const kind = this.kindOf(decl);
    for (const declarator of declarators) {
      const shape = shapeOf(declarator);
      if (!shape.nameNode || shape.isFunction) continue;
      const init = declarator.type === 'init_declarator' ? field(declarator, 'value') : null;
      const isAuto = typeNode?.type === 'placeholder_type_specifier';
      this.vars.push({
        name: this.text.slice(shape.nameNode.startIndex, shape.nameNode.endIndex),
        kind,
        nameNode: shape.nameNode,
        declNode: decl,
        declarator,
        typeText: baseText,
        typeNode,
        pointer: shape.pointer,
        reference: shape.reference,
        rvalueReference: shape.rvalueReference,
        array: shape.array,
        isAuto,
        isStatic,
        isExtern,
        isConstexpr,
        isConst: shape.pointer ? shape.topConst : declConst && !shape.reference && !shape.rvalueReference,
        pointeeConst: declConst && (shape.pointer || shape.reference || shape.rvalueReference),
        initializer: init,
        scope: this.scopeFor(decl, kind),
      });
    }
  }

  private kindOf(decl: Node): VarInfo['kind'] {
    if (decl.type === 'field_declaration') return 'member';
    if (decl.type === 'parameter_declaration' || decl.type === 'optional_parameter_declaration') return 'param';
    const fn = ancestor(decl, 'function_definition', 'lambda_expression');
    return fn ? 'local' : 'global';
  }

  private scopeFor(decl: Node, kind: VarInfo['kind']): Node {
    if (kind === 'param') {
      return ancestorWhere(decl, (n) => n.type === 'function_definition' || n.type === 'lambda_expression') ?? scopeOf(decl);
    }
    if (decl.type === 'for_range_loop') return decl;
    if (decl.type === 'condition_clause') return decl.parent ?? decl;
    const parent = decl.parent;
    // `for (int i = 0; ...)`: the declaration lives in the for statement's scope
    if (parent?.type === 'for_statement') return parent;
    return scopeOf(decl);
  }

  all(name: string): VarInfo[] {
    return this.byName.get(name) ?? [];
  }

  /** Innermost declaration of `name` visible at `at` (declared earlier, in an enclosing scope). */
  resolve(name: string, at: Node): VarInfo | undefined {
    let best: VarInfo | undefined;
    for (const v of this.all(name)) {
      if (v.kind === 'member') continue;
      if (v.nameNode.startIndex > at.startIndex && v.kind !== 'param') continue;
      if (!(v.scope.startIndex <= at.startIndex && at.endIndex <= v.scope.endIndex)) continue;
      if (!best || v.scope.startIndex > best.scope.startIndex || (v.scope.id !== best.scope.id && v.scope.startIndex === best.scope.startIndex && v.nameNode.startIndex > best.nameNode.startIndex) || (v.scope.id === best.scope.id && v.nameNode.startIndex > best.nameNode.startIndex)) {
        best = v;
      }
    }
    if (best) return best;
    // class members when `at` is inside a member function of the class that declares them
    const owner = this.enclosingClassName(at);
    if (owner) {
      return this.all(name).find((v) => v.kind === 'member' && this.classNameOfMember(v) === owner);
    }
    return undefined;
  }

  classNameOfMember(v: VarInfo): string | null {
    const cls = ancestor(v.declNode, 'class_specifier', 'struct_specifier', 'union_specifier');
    const name = cls ? field(cls, 'name') : null;
    return name ? this.text.slice(name.startIndex, name.endIndex) : null;
  }

  enclosingClassName(at: Node): string | null {
    const cls = ancestor(at, 'class_specifier', 'struct_specifier', 'union_specifier');
    if (cls) {
      const name = field(cls, 'name');
      if (name) return this.text.slice(name.startIndex, name.endIndex);
    }
    // out-of-line definition: `void Foo::bar() { ... }`
    const fn = ancestor(at, 'function_definition');
    const decl = fn ? field(fn, 'declarator') : null;
    const q = decl?.descendantsOfType('qualified_identifier')[0];
    const scope = q ? field(q, 'scope') : null;
    return scope ? this.text.slice(scope.startIndex, scope.endIndex) : null;
  }
}
