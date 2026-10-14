import type { Node } from 'web-tree-sitter';

/** Non-null children (web-tree-sitter types them as nullable). */
export function kids(node: Node): Node[] {
  return node.children.filter((c): c is Node => c !== null);
}

export function namedKids(node: Node): Node[] {
  return node.namedChildren.filter((c): c is Node => c !== null);
}

export function same(a: Node | null | undefined, b: Node | null | undefined): boolean {
  return !!a && !!b && a.id === b.id;
}

/** Pre-order traversal. Return `false` from `visit` to skip the children of a node. */
export function walk(node: Node, visit: (n: Node) => boolean | void): void {
  if (visit(node) === false) return;
  for (const c of kids(node)) walk(c, visit);
}

export function* descendants(node: Node): Generator<Node> {
  for (const c of kids(node)) {
    yield c;
    yield* descendants(c);
  }
}

export function descendantsOfType(node: Node, ...types: string[]): Node[] {
  return node.descendantsOfType(types).filter((n): n is Node => n !== null);
}

export function ancestor(node: Node, ...types: string[]): Node | null {
  for (let p = node.parent; p; p = p.parent) if (types.includes(p.type)) return p;
  return null;
}

/** Nearest ancestor (excluding the node itself) that satisfies `pred`. */
export function ancestorWhere(node: Node, pred: (n: Node) => boolean): Node | null {
  for (let p = node.parent; p; p = p.parent) if (pred(p)) return p;
  return null;
}

export function isWithin(node: Node, container: Node): boolean {
  return node.startIndex >= container.startIndex && node.endIndex <= container.endIndex;
}

export function field(node: Node, name: string): Node | null {
  return node.childForFieldName(name);
}

/** The innermost function definition (or lambda) that contains `node`. */
export function enclosingFunction(node: Node): Node | null {
  return ancestor(node, 'function_definition', 'lambda_expression');
}

export function enclosingClass(node: Node): Node | null {
  return ancestor(node, 'class_specifier', 'struct_specifier', 'union_specifier');
}

/** Peel declarators (pointer/reference/array/parenthesized/function/init) until the declared identifier. */
export function declaredName(declarator: Node | null): Node | null {
  let d = declarator;
  while (d) {
    switch (d.type) {
      case 'identifier':
      case 'field_identifier':
      case 'type_identifier':
      case 'operator_name':
      case 'destructor_name':
      case 'qualified_identifier':
      case 'operator_cast':
        return d;
      case 'structured_binding_declarator':
        return null;
      default: {
        const next = d.childForFieldName('declarator') ?? namedKids(d).find((c) => /declarator$/.test(c.type) || c.type === 'identifier' || c.type === 'field_identifier');
        if (!next || next.id === d.id) return null;
        d = next;
      }
    }
  }
  return null;
}

/** Find the function_declarator inside a (possibly pointer/reference wrapped) declarator. */
export function functionDeclarator(declarator: Node | null): Node | null {
  let d = declarator;
  while (d) {
    if (d.type === 'function_declarator') return d;
    d = d.childForFieldName('declarator') ?? namedKids(d).find((c) => /declarator$/.test(c.type)) ?? null;
  }
  return null;
}

export function hasChildOfType(node: Node, type: string): boolean {
  return kids(node).some((c) => c.type === type);
}

export function childrenOfType(node: Node, ...types: string[]): Node[] {
  return kids(node).filter((c) => types.includes(c.type));
}

export function firstChildOfType(node: Node, ...types: string[]): Node | null {
  return kids(node).find((c) => types.includes(c.type)) ?? null;
}

export function prevSibling(node: Node): Node | null {
  return node.previousSibling;
}
