import type { Node } from 'web-tree-sitter';
import { ancestor, field, namedKids } from '../core/ast.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, TextEdit } from '../core/types.js';
import { declPrefix } from './util.js';

const BUILTIN_TYPE_NODES = new Set(['primitive_type', 'sized_type_specifier']);
const SIZE_TYPES = /^(?:std::)?(?:size_t|ptrdiff_t|ssize_t|u?int(?:8|16|32|64)_t|u?intptr_t|u?intmax_t)$/;

function isBuiltinType(typeNode: Node | null, text: string): boolean {
  if (!typeNode) return false;
  return BUILTIN_TYPE_NODES.has(typeNode.type) || SIZE_TYPES.test(text.trim());
}

// ---------------------------------------------------------------------------------------------
// ES.87  Don't add redundant == or != to conditions
// ---------------------------------------------------------------------------------------------
const redundantCompareCheck: Check = {
  name: 'ES.87 redundant comparison',
  covers: ['ES.87'],
  run(ctx) {
    const conditions: Node[] = [];
    for (const c of ctx.nodesOf('condition_clause')) {
      const value = field(c, 'value');
      if (value && value.type !== 'declaration') conditions.push(value);
      const init = field(c, 'initializer');
      if (value?.type === 'declaration' && init) conditions.push(init);
    }
    for (const f of ctx.nodesOf('for_statement')) {
      const cond = field(f, 'condition');
      if (cond) conditions.push(cond);
    }
    for (const t of ctx.nodesOf('conditional_expression')) {
      const cond = field(t, 'condition');
      if (cond) conditions.push(cond);
    }

    const seen = new Set<number>();
    const visit = (node: Node): void => {
      switch (node.type) {
        case 'parenthesized_expression':
          for (const k of namedKids(node)) visit(k);
          return;
        case 'unary_expression':
          if (node.text.startsWith('!')) for (const k of namedKids(node)) visit(k);
          return;
        case 'binary_expression': {
          const op = field(node, 'operator')?.text;
          if (op === '&&' || op === '||') {
            visit(field(node, 'left')!);
            visit(field(node, 'right')!);
            return;
          }
          if ((op === '==' || op === '!=') && !seen.has(node.id)) {
            seen.add(node.id);
            check(node, op);
          }
          return;
        }
        default:
      }
    };

    const check = (node: Node, op: string): void => {
      const left = field(node, 'left')!;
      const right = field(node, 'right')!;
      const isConst = (n: Node): string | null => {
        if (n.type === 'null' && n.text === 'nullptr') return 'null';
        if (n.type === 'true') return 'true';
        if (n.type === 'false') return 'false';
        return null;
      };
      let other = left;
      let kind = isConst(right);
      if (!kind) {
        kind = isConst(left);
        other = right;
      }
      if (!kind) return;
      if (isConst(other)) return;
      const positive = (op === '!=') === (kind !== 'false'); // result is "other is truthy"
      const wrap = ['binary_expression', 'conditional_expression', 'assignment_expression', 'cast_expression'].includes(other.type);
      const body = wrap ? `(${ctx.src(other)})` : ctx.src(other);
      let safe = true;
      if (kind === 'true' || kind === 'false') {
        const v = other.type === 'identifier' ? ctx.symbols.resolve(other.text, other) : undefined;
        safe = other.type === 'binary_expression' || (v ? /^\s*(?:const\s+)?bool\s*$/.test(v.typeText) : false);
      }
      const replacement = positive ? ctx.src(other) : `!${body}`;
      ctx.report({
        ruleId: 'ES.87',
        node,
        message: t("Don't add a redundant {0} to a condition.", op + ' ' + (kind === 'null' ? 'nullptr' : kind)),
        fixes: [ctx.fix(t('Simplify the condition'), [ctx.replace(node, replacement)], safe ? 'safe' : 'unsafe')],
      });
    };

    for (const c of conditions) visit(c);
  },
};

// ---------------------------------------------------------------------------------------------
// ES.45  Avoid magic constants
// ---------------------------------------------------------------------------------------------
function stripSuffix(text: string): string {
  return text.replace(/'/g, '').replace(/(?<=[0-9.])[uUlLfFzZ]+$/, '');
}

const magicConstantCheck: Check = {
  name: 'ES.45 magic constants',
  covers: ['ES.45'],
  run(ctx) {
    const allow = new Set(ctx.config.magicConstantAllowList.map((s) => stripSuffix(s)));
    const allowedAncestors = [
      'enumerator',
      'preproc_def',
      'preproc_function_def',
      'preproc_if',
      'preproc_elif',
      'static_assert_declaration',
      'template_argument_list',
      'alignas_qualifier',
      'attribute_declaration',
      'attribute',
      'array_declarator',
      'optional_parameter_declaration',
      'optional_type_parameter_declaration',
      'bitfield_clause',
      'lambda_capture_specifier',
      'new_declarator',
      'type_descriptor',
      'case_statement',
    ];
    for (const lit of ctx.nodesOf('number_literal', 'char_literal')) {
      let text = lit.text;
      let node = lit;
      const parent = lit.parent;
      if (parent?.type === 'unary_expression' && parent.text.startsWith('-')) {
        text = '-' + text;
        node = parent;
      }
      if (allow.has(stripSuffix(text)) || allow.has(text)) continue;
      if (lit.type === 'char_literal' && allow.has(text.replace(/\\\\/g, '\\'))) continue;
      const up = node.parent;
      if (!up) continue;
      // `const double pi = 3.14;` and `int n = 42;` give the literal a name.
      if (up.type === 'init_declarator' || up.type === 'field_declaration' || up.type === 'initializer_list') {
        if (up.type === 'initializer_list') {
          const owner = up.parent;
          if (owner?.type === 'init_declarator' || owner?.type === 'field_declaration' || owner?.type === 'compound_literal_expression') continue;
        } else continue;
      }
      if (ancestor(node, ...allowedAncestors)) continue;
      // inside a named constant: `constexpr auto x = 2 * 3;`
      const decl = ancestor(node, 'declaration', 'field_declaration');
      if (decl && /\b(?:constexpr|const|constinit|consteval)\b/.test(declPrefix(ctx, decl))) continue;
      if (ancestor(node, 'ERROR')) continue;
      ctx.report({
        ruleId: 'ES.45',
        node,
        message: t('Avoid magic constants: give "{0}" a name (constexpr).', text),
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.20 / ES.22  Always initialize; declare when you have a value
// ---------------------------------------------------------------------------------------------
const initializeCheck: Check = {
  name: 'ES.20/22 initialization',
  covers: ['ES.20', 'ES.22'],
  run(ctx) {
    for (const decl of ctx.nodesOf('declaration')) {
      const parent = decl.parent;
      if (!parent || !['compound_statement', 'case_statement'].includes(parent.type)) {
        if (parent?.type !== 'for_statement') continue;
      }
      if (!ancestor(decl, 'function_definition', 'lambda_expression')) continue;
      const typeNode = field(decl, 'type');
      if (!typeNode) continue;
      const typeText = ctx.src(typeNode);
      const prefix = declPrefix(ctx, decl);
      if (/\b(?:static|extern|thread_local|typedef|constexpr)\b/.test(prefix)) continue;
      const builtin = isBuiltinType(typeNode, typeText);
      const declarators = decl.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      const bare = declarators.filter((d) => {
        if (d.type === 'init_declarator') return false;
        const shape = shapeOf(d);
        if (!shape.nameNode || shape.isFunction || shape.array || shape.reference || shape.rvalueReference) return false;
        return builtin || shape.pointer;
      });
      if (bare.length === 0) continue;

      // ES.22: `int x; x = f();` -> `int x = f();`
      const next = decl.nextNamedSibling;
      if (bare.length === 1 && declarators.length === 1 && next?.type === 'expression_statement' && parent?.type === 'compound_statement') {
        const assign = namedKids(next)[0];
        const name = shapeOf(bare[0]).nameNode!.text;
        if (assign?.type === 'assignment_expression' && field(assign, 'left')?.text === name && assign.child(1)?.text === '=') {
          const right = field(assign, 'right')!;
          const uses = right.descendantsOfType('identifier').some((i) => i?.text === name);
          if (!uses) {
            const edits: TextEdit[] = [
              ctx.insertAt(bare[0].endIndex, ` = ${ctx.src(right)}`),
              ctx.replaceRange(decl.endIndex, next.endIndex, ''),
            ];
            ctx.report({
              ruleId: 'ES.22',
              alsoCovers: ['ES.20'],
              node: bare[0],
              message: t("Don't declare a variable until you have a value to initialize it with."),
              fixes: [ctx.fix(t('Merge the declaration with the assignment'), edits, builtin ? 'safe' : 'unsafe')],
            });
            continue;
          }
        }
      }

      for (const d of bare) {
        const nameNode = shapeOf(d).nameNode!;
        ctx.report({
          ruleId: 'ES.20',
          node: nameNode,
          message: t('Always initialize an object: "{0}" is uninitialized.', nameNode.text),
          fixes: [ctx.fix(t('Value-initialize with {}'), [ctx.insertAt(d.endIndex, '{}')])],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.23  Prefer {}-initialization: narrowing literals
// ---------------------------------------------------------------------------------------------
const INT_LIMITS: Record<string, [bigint, bigint]> = {
  'char': [-128n, 255n],
  'signed char': [-128n, 127n],
  'unsigned char': [0n, 255n],
  'short': [-32768n, 32767n],
  'unsigned short': [0n, 65535n],
  'int': [-2147483648n, 2147483647n],
  'unsigned': [0n, 4294967295n],
  'unsigned int': [0n, 4294967295n],
};

const narrowingLiteralCheck: Check = {
  name: 'ES.23 narrowing literal',
  covers: ['ES.23'],
  run(ctx) {
    for (const d of ctx.nodesOf('init_declarator')) {
      const decl = d.parent;
      if (!decl || decl.type !== 'declaration') continue;
      const typeNode = field(decl, 'type');
      if (!typeNode || !BUILTIN_TYPE_NODES.has(typeNode.type)) continue;
      const shape = shapeOf(d);
      if (shape.pointer || shape.reference || shape.array) continue;
      const value = field(d, 'value');
      if (!value || value.type === 'initializer_list') continue;
      const typeName = ctx.src(typeNode).replace(/\s+/g, ' ').trim();
      let lit = value;
      let neg = false;
      if (lit.type === 'unary_expression' && lit.text.startsWith('-')) {
        neg = true;
        lit = namedKids(lit)[0] ?? lit;
      }
      if (lit.type !== 'number_literal') continue;
      let text = lit.text.replace(/'/g, '');
      if (text.startsWith('-') || text.startsWith('+')) {
        neg = neg !== (text[0] === '-');
        text = text.slice(1);
      }
      const isFloat = /^(?:[0-9]*\.[0-9]*|[0-9]+[eE][-+]?[0-9]+|[0-9]*\.[0-9]*[eE][-+]?[0-9]+)[fFlL]?$/.test(text) && !/^0[xX]/.test(text);
      const integral = typeName in INT_LIMITS || /^(?:long|long long|unsigned long|unsigned long long)$/.test(typeName);
      let narrowing = false;
      if (isFloat && integral) narrowing = true;
      else if (!isFloat && typeName in INT_LIMITS && /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)[uUlL]*$/.test(text)) {
        const n = BigInt(text.replace(/[uUlL]+$/, '').replace(/^0[bB]/, '0b'));
        const v = neg ? -n : n;
        const [lo, hi] = INT_LIMITS[typeName];
        narrowing = v < lo || v > hi;
      }
      if (narrowing) {
        ctx.report({
          ruleId: 'ES.23',
          node: value,
          message: t('Narrowing initialization of "{0}" with "{1}"; prefer {} initialization, which rejects it.', typeName, ctx.src(value)),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.41  Parenthesize when in doubt about precedence
// ---------------------------------------------------------------------------------------------
const precedenceCheck: Check = {
  name: 'ES.41 precedence',
  covers: ['ES.41'],
  run(ctx) {
    const bitwise = new Set(['&', '|', '^']);
    for (const e of ctx.nodesOf('binary_expression')) {
      const op = field(e, 'operator')?.text ?? '';
      if (!bitwise.has(op)) continue;
      for (const side of [field(e, 'left'), field(e, 'right')]) {
        if (side?.type !== 'binary_expression') continue;
        const inner = field(side, 'operator')?.text ?? '';
        if (inner === op) continue;
        ctx.report({
          ruleId: 'ES.41',
          node: side,
          message: t('Parenthesize "{0}": it is mixed with the bitwise operator "{1}".', ctx.src(side), op),
          fixes: [ctx.fix(t('Add parentheses'), [ctx.replace(side, `(${ctx.src(side)})`)])],
        });
      }
    }
    for (const a of ctx.nodesOf('assignment_expression')) {
      const parent = a.parent;
      if (!parent) continue;
      if (parent.type === 'assignment_expression' && field(parent, 'right')?.id === a.id) {
        ctx.report({
          ruleId: 'ES.41',
          node: a,
          message: t('An assignment must be the leftmost operator of an expression; split the chained assignment.'),
        });
      } else if (['binary_expression', 'unary_expression', 'conditional_expression', 'argument_list', 'subscript_expression', 'parenthesized_expression'].includes(parent.type)) {
        const grand = parent.parent;
        // `if ((x = f()))` / `while ((x = f()))`: the parentheses make the intent visible, but the rule still asks for a separate statement.
        void grand;
        ctx.report({
          ruleId: 'ES.41',
          node: a,
          message: t('An assignment must be the leftmost operator of an expression; move it into its own statement.'),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.12  Do not reuse names in nested scopes
// ---------------------------------------------------------------------------------------------
const shadowCheck: Check = {
  name: 'ES.12 shadowing',
  covers: ['ES.12'],
  run(ctx) {
    const sym = ctx.symbols;
    const within = (inner: Node, outer: Node): boolean => outer.startIndex <= inner.startIndex && inner.endIndex <= outer.endIndex;
    for (const v of sym.vars) {
      if (v.kind !== 'local' && v.kind !== 'param') continue;
      if (v.name === '_' || v.name === '') continue;
      for (const w of sym.all(v.name)) {
        if (w === v) continue;
        let reason: string | null = null;
        if ((w.kind === 'local' || w.kind === 'param') && w.nameNode.startIndex < v.nameNode.startIndex && within(v.scope, w.scope) && w.scope.id !== v.scope.id) {
          reason = t('an enclosing scope');
        } else if ((w.kind === 'local' || w.kind === 'param') && w.scope.id === v.scope.id && w.nameNode.startIndex < v.nameNode.startIndex && v.kind === 'local' && w.kind === 'param') {
          reason = t('a parameter');
        } else if (w.kind === 'global' && v.kind === 'local' && !w.isExtern) {
          reason = t('a global variable');
        } else if (w.kind === 'member' && v.kind === 'local') {
          const owner = sym.enclosingClassName(v.nameNode);
          if (owner && sym.classNameOfMember(w) === owner) reason = t('a member');
        }
        if (reason) {
          ctx.report({
            ruleId: 'ES.12',
            node: v.nameNode,
            message: t('Do not reuse names in nested scopes: "{0}" hides {1}.', v.name, reason),
          });
          break;
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.27  Arrays on the stack: no VLAs, no non-local constant bounds
// ---------------------------------------------------------------------------------------------
const stackArrayCheck: Check = {
  name: 'ES.27 stack arrays',
  covers: ['ES.27'],
  run(ctx) {
    for (const d of ctx.nodesOf('array_declarator')) {
      const decl = ancestor(d, 'declaration');
      if (!decl || !ancestor(decl, 'function_definition')) continue;
      const size = field(d, 'size');
      if (!size || size.type === 'number_literal') continue;
      let why: string | null = null;
      if (size.type === 'identifier') {
        const v = ctx.symbols.resolve(size.text, size);
        if (v && !v.isConst && !v.isConstexpr) why = t('a variable bound (a variable-length array)');
        else if (v && (v.kind === 'global' || v.kind === 'member')) why = t('a non-local constant bound');
        else if (!v && /^[A-Z][A-Z0-9_]+$/.test(size.text)) why = t('a non-local constant bound');
      } else if (size.type !== 'qualified_identifier') {
        // an expression such as `n * 2`: variable unless made only of literals
        const ids = size.descendantsOfType('identifier').filter((n): n is Node => n !== null);
        if (ids.some((i) => {
          const v = ctx.symbols.resolve(i.text, i);
          return !v || (!v.isConst && !v.isConstexpr);
        })) why = t('a non-constant bound');
      }
      if (!why) continue;
      ctx.report({
        ruleId: 'ES.27',
        node: d,
        message: t('Use std::array (or std::vector) instead of a C array with {0}.', why),
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.9 / ES.9 / Enum.5  ALL_CAPS is for macros only
// ---------------------------------------------------------------------------------------------
const allCapsCheck: Check = {
  name: 'NL.9 ALL_CAPS names',
  covers: ['NL.9', 'ES.9', 'Enum.5'],
  run(ctx) {
    const macros = new Set<string>();
    for (const def of ctx.nodesOf('preproc_def', 'preproc_function_def')) macros.add(field(def, 'name')?.text ?? '');
    const ALL_CAPS = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
    const isAllCaps = (n: string): boolean => n.length > 2 && ALL_CAPS.test(n) && /[A-Z]{2}/.test(n);
    const flag = (node: Node, ruleId: 'NL.9' | 'Enum.5', what: string): void => {
      if (macros.has(node.text)) return;
      ctx.report({
        ruleId,
        alsoCovers: ruleId === 'NL.9' ? ['ES.9'] : ['NL.9', 'ES.9'],
        node,
        message: t('{0} "{1}" must not be ALL_CAPS (reserved for macros).', what, node.text),
      });
    };
    for (const e of ctx.nodesOf('enumerator')) {
      const name = field(e, 'name');
      if (name && isAllCaps(name.text)) flag(name, 'Enum.5', t('Enumerator'));
    }
    for (const v of ctx.symbols.vars) {
      if (isAllCaps(v.name)) flag(v.nameNode, 'NL.9', t('Name'));
    }
    for (const fn of ctx.nodesOf('function_definition')) {
      const fd = field(fn, 'declarator');
      const shape = shapeOf(fd);
      if (shape.nameNode && shape.nameNode.type === 'identifier' && isAllCaps(shape.nameNode.text)) flag(shape.nameNode, 'NL.9', t('Function name'));
    }
    for (const c of ctx.nodesOf('class_specifier', 'struct_specifier', 'enum_specifier', 'union_specifier')) {
      const name = field(c, 'name');
      if (name && field(c, 'body') && isAllCaps(name.text)) flag(name, 'NL.9', t('Type name'));
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.19 / ES.8  Names that are easily misread
// ---------------------------------------------------------------------------------------------
const misreadCheck: Check = {
  name: 'NL.19 misread names',
  covers: ['NL.19'],
  run(ctx) {
    const confusing = /^[oO01lLI]{3,}$/;
    const seen = new Set<number>();
    const nodes: Node[] = ctx.symbols.vars.map((v) => v.nameNode);
    for (const e of ctx.nodesOf('enumerator')) {
      const n = field(e, 'name');
      if (n) nodes.push(n);
    }
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (confusing.test(n.text)) {
        ctx.report({
          ruleId: 'NL.19',
          alsoCovers: ['ES.8'],
          node: n,
          message: t('"{0}" is made only of easily confused characters (o, O, 0, 1, l, L, I).', n.text),
        });
      }
    }
  },
};

export const es2Checks: Check[] = [
  redundantCompareCheck,
  magicConstantCheck,
  initializeCheck,
  narrowingLiteralCheck,
  precedenceCheck,
  shadowCheck,
  stackArrayCheck,
  allCapsCheck,
  misreadCheck,
];
