import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { classesOf } from './classes.js';
import { functionsOf, paramName } from './funcs.js';
import { identifierUses, normalizeType, signednessOfType } from './util.js';

// ---------------------------------------------------------------------------------------------
// F.24 / P.6 / I.13  (pointer, count) interfaces -> std::span
// ---------------------------------------------------------------------------------------------
const COUNT_NAME = /^(?:n|sz|len|cnt|num|size|count|length|n_\w+|\w+_(?:n|sz|len|cnt|count|size|length|num|elems|elements|bytes)|(?:num|n)[A-Z_]\w*)$/;

const pointerCountCheck: Check = {
  name: 'F.24 pointer and count',
  covers: ['F.24'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      const params = f.params;
      for (let i = 0; i + 1 < params.length; i++) {
        const p = params[i];
        const c = params[i + 1];
        if (p.type !== 'parameter_declaration' && p.type !== 'optional_parameter_declaration') continue;
        const pshape = shapeOf(field(p, 'declarator'));
        const cshape = shapeOf(field(c, 'declarator'));
        const ptype = field(p, 'type');
        const ctype = field(c, 'type');
        if (!ptype || !ctype || !pshape.pointer || pshape.array || pshape.isFunction || pshape.reference) continue;
        if (cshape.pointer || cshape.reference || cshape.rvalueReference || cshape.array) continue;
        if (signednessOfType(ctx.src(ctype)) === 'unknown') continue;
        const pname = paramName(p);
        const cname = paramName(c);
        const named = !!cname && COUNT_NAME.test(cname);
        let used = false;
        if (pname && cname && f.body) {
          const indexed = identifierUses(f.body, pname).some((u) => u.parent?.type === 'subscript_expression' && field(u.parent, 'argument')?.id === u.id);
          const bounded = identifierUses(f.body, cname).some((u) => u.parent?.type === 'binary_expression' && ['<', '<=', '!=', '>'].includes(field(u.parent, 'operator')?.text ?? ''));
          used = indexed && bounded;
        }
        if (!named && !used) continue;
        const fixes: Fix[] = [];
        const pointerText = pname ? ctx.src(field(p, 'declarator')!) : '';
        const single = /^\*\s*\w+$/.test(pointerText);
        const elemType = ctx.src(ptype);
        const quals = kids(p).filter((k) => k.type === 'type_qualifier').map((k) => k.text);
        if (pname && cname && single && normalizeType(elemType) !== 'void') {
          const edits: TextEdit[] = [
            ctx.replaceRange(p.startIndex, c.endIndex, `std::span<${[...quals, elemType].join(' ')}> ${pname}`),
            ...ctx.includeEdits('span'),
          ];
          if (f.body) for (const u of identifierUses(f.body, cname)) edits.push(ctx.replace(u, `${pname}.size()`));
          fixes.push(ctx.fix(t('Use std::span'), edits, 'unsafe'));
        }
        ctx.report({
          ruleId: 'F.24',
          alsoCovers: ['P.6', 'I.13', 'F.22'],
          start: p.startIndex,
          end: c.endIndex,
          message: t('Use std::span instead of the (pointer, count) pair ("{0}", "{1}").', pname ?? '?', cname ?? '?'),
          fixes,
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.73 / ES.86  for-loops
// ---------------------------------------------------------------------------------------------
function modifiedIn(node: Node, name: string, skipLambdas = true): Node | null {
  let found: Node | null = null;
  const visit = (n: Node): void => {
    if (found) return;
    if (skipLambdas && n.type === 'lambda_expression') return;
    if (n.type === 'update_expression' && field(n, 'argument')?.text === name) found = n;
    else if (n.type === 'assignment_expression' && field(n, 'left')?.text === name) found = n;
    else for (const c of kids(n)) visit(c);
  };
  visit(node);
  return found;
}

const forLoopCheck: Check = {
  name: 'ES.73 for loops',
  covers: ['ES.73', 'ES.86'],
  run(ctx) {
    for (const loop of ctx.nodesOf('for_statement')) {
      const init = field(loop, 'initializer');
      const cond = field(loop, 'condition');
      const update = field(loop, 'update');
      const body = field(loop, 'body');
      if (!body) continue;
      const condIds = new Set(cond ? cond.descendantsOfType('identifier').map((n) => n?.text) : []);

      // ES.73: no obvious loop variable
      if (cond) {
        const related = (n: Node | null): boolean => !n || n.descendantsOfType('identifier').some((i) => !!i && condIds.has(i.text)) || (n.type === 'declaration' && n.descendantsOfType(['identifier']).some((i) => condIds.has(i?.text ?? '')));
        const unrelatedInit = !!init && !related(init);
        const unrelatedUpdate = !!update && !related(update);
        if (!init && !update) {
          const header = ctx.slice(loop.startIndex, body.startIndex);
          const closeParen = header.lastIndexOf(')');
          ctx.report({
            ruleId: 'ES.73',
            start: loop.startIndex,
            end: loop.startIndex + 3,
            message: t('Prefer a while-statement to a for-statement when there is no obvious loop variable.'),
            fixes: closeParen >= 0 ? [ctx.fix(t('Use a while-statement'), [ctx.replaceRange(loop.startIndex, body.startIndex, `while (${ctx.src(cond)}) `)])] : [],
          });
        } else if (unrelatedInit || unrelatedUpdate) {
          ctx.report({
            ruleId: 'ES.73',
            start: loop.startIndex,
            end: loop.startIndex + 3,
            message: t('The for-statement initializer or increment does not relate to its condition; prefer a while-statement.'),
          });
        }
      }

      // ES.86: modifying the loop control variable in the body
      if (update) {
        const names = new Set<string>();
        const collect = (n: Node): void => {
          if (n.type === 'update_expression') {
            const a = field(n, 'argument');
            if (a?.type === 'identifier') names.add(a.text);
          } else if (n.type === 'assignment_expression') {
            const l = field(n, 'left');
            if (l?.type === 'identifier') names.add(l.text);
          }
          for (const c of kids(n)) collect(c);
        };
        collect(update);
        for (const name of names) {
          const inBody = modifiedIn(body, name);
          if (inBody) {
            ctx.report({
              ruleId: 'ES.86',
              node: inBody,
              message: t('Avoid modifying the loop control variable "{0}" inside the body of a raw for-loop.', name),
            });
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.11  Use auto to avoid redundant repetition of type names
// ---------------------------------------------------------------------------------------------
const autoCheck: Check = {
  name: 'ES.11 auto',
  covers: ['ES.11'],
  run(ctx) {
    for (const decl of ctx.nodesOf('declaration')) {
      if (!ancestor(decl, 'function_definition', 'lambda_expression')) continue;
      const declarators = decl.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      if (declarators.length !== 1 || declarators[0].type !== 'init_declarator') continue;
      const d = declarators[0];
      const type = field(decl, 'type');
      const value = field(d, 'value');
      if (!type || !value || type.type === 'placeholder_type_specifier') continue;
      const shape = shapeOf(d);
      if (shape.reference || shape.rvalueReference || shape.array) continue;
      const typeText = normalizeType(ctx.src(type));
      const baseOf = (n: string): string => n.replace(/\s+/g, '');
      let redundant = false;
      let eraseStar = false;

      if (value.type === 'new_expression') {
        const nt = field(value, 'type');
        if (shape.pointer && nt && baseOf(ctx.src(nt)) === baseOf(typeText) && !field(value, 'declarator')) {
          redundant = true;
          eraseStar = true;
        }
      } else if (value.type === 'call_expression' || value.type === 'compound_literal_expression') {
        const fn = field(value, value.type === 'call_expression' ? 'function' : 'type');
        if (fn && !shape.pointer) {
          const fnText = baseOf(ctx.src(fn));
          if (fnText === baseOf(typeText)) redundant = true;
          const mk = /^std::make_(unique|shared)<(.*)>$/s.exec(fnText);
          const ty = /^std::(unique|shared)_ptr<(.*)>$/s.exec(baseOf(typeText));
          if (mk && ty && mk[1] === ty[1] && mk[2] === ty[2]) redundant = true;
          const sc = /^(?:static|dynamic|const|reinterpret)_cast<(.*)>$/s.exec(fnText);
          if (sc && sc[1] === baseOf(typeText)) redundant = true;
        }
      }
      if (!redundant) continue;
      const nameNode = shape.nameNode;
      const edits: TextEdit[] = eraseStar && nameNode
        ? [ctx.replaceRange(type.startIndex, nameNode.startIndex, 'auto ')]
        : [ctx.replace(type, 'auto')];
      ctx.report({
        ruleId: 'ES.11',
        node: type,
        message: t('Use auto to avoid repeating the type name "{0}".', typeText),
        fixes: [ctx.fix(t('Use auto'), edits)],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.41  A constructor should create a fully initialized object
// ---------------------------------------------------------------------------------------------
const BUILTIN = /^(?:bool|char|signed char|unsigned char|wchar_t|short|unsigned short|int|unsigned|unsigned int|long|unsigned long|long long|unsigned long long|float|double|long double|(?:std::)?(?:size_t|ptrdiff_t|u?int(?:8|16|32|64)_t))$/;

const fullInitCheck: Check = {
  name: 'C.41 fully initialized objects',
  covers: ['C.41'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const fields = c.fields.filter((fl) => !fl.isStatic && !fl.isConst && !fl.isReference && !fl.isArray && !fl.hasInitializer && fl.names.length === 1 && (fl.isPointer || BUILTIN.test(normalizeType(fl.typeText))));
      if (fields.length === 0) continue;
      for (const m of c.functions) {
        const f = m.info;
        if (!f.isConstructor || f.node.type !== 'function_definition' || f.isDefaulted || f.isDeleted) continue;
        const list = kids(f.node).find((k) => k.type === 'field_initializer_list');
        const inits = list ? kids(list).filter((k) => k.type === 'field_initializer') : [];
        const initialized = new Set(inits.map((i) => kids(i).find((k) => k.type === 'field_identifier' || k.type === 'identifier' || k.type === 'type_identifier')?.text ?? ''));
        if (initialized.has(c.name)) continue; // delegating constructor
        const assigned = new Set<string>();
        if (f.body) {
          for (const a of f.body.descendantsOfType('assignment_expression')) {
            const left = a ? field(a, 'left') : null;
            if (!left) continue;
            assigned.add(left.type === 'field_expression' && field(left, 'argument')?.type === 'this' ? field(left, 'field')!.text : left.text);
          }
        }
        const missing = fields.filter((fl) => !initialized.has(fl.names[0].text) && !assigned.has(fl.names[0].text));
        if (missing.length === 0) continue;
        ctx.report({
          ruleId: 'C.41',
          node: f.nameNode,
          message: t('This constructor does not initialize: {0}.', missing.map((x) => x.names[0].text).join(', ')),
          fixes: [ctx.fix(t('Add default member initializers'), missing.map((x) => ctx.insertAt(x.names[0].endIndex, '{}')))],
        });
      }
    }
  },
};

export const m4Checks: Check[] = [pointerCountCheck, forLoopCheck, autoCheck, fullInitCheck];
