import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check } from '../core/types.js';
import { classByName, classesOf, type ClassInfo } from './classes.js';
import { functionsOf } from './funcs.js';
import { normalizeType } from './util.js';

// ---------------------------------------------------------------------------------------------
// ES.63  Don't slice
// ---------------------------------------------------------------------------------------------
function derivesFrom(ctx: Parameters<Check['run']>[0], cls: ClassInfo, baseName: string, seen = new Set<string>()): boolean {
  if (seen.has(cls.name)) return false;
  seen.add(cls.name);
  return cls.bases.some((b) => b.name === baseName || (classByName(ctx, b.name) ? derivesFrom(ctx, classByName(ctx, b.name)!, baseName, seen) : false));
}

const slicingCheck: Check = {
  name: 'ES.63 slicing',
  covers: ['ES.63'],
  run(ctx) {
    const classes = classesOf(ctx);
    const slicedBases = classes.filter((b) => b.fields.some((f) => !f.isStatic) && classes.some((d) => d !== b && derivesFrom(ctx, d, b.name)));
    if (slicedBases.length === 0) return;
    const classOfVar = (id: Node | null): ClassInfo | undefined => {
      if (id?.type !== 'identifier') return undefined;
      const v = ctx.symbols.resolve(id.text, id);
      if (!v || v.pointer || v.reference || v.rvalueReference || v.array) return undefined;
      return classByName(ctx, normalizeType(v.typeText));
    };
    const report = (node: Node, base: string, derived: string): void =>
      ctx.report({
        ruleId: 'ES.63',
        node,
        message: t('Slicing: copying a "{0}" into a "{1}" object discards the derived part.', derived, base),
      });

    for (const d of ctx.nodesOf('init_declarator')) {
      const decl = d.parent;
      const type = decl ? field(decl, 'type') : null;
      const shape = shapeOf(d);
      if (!type || shape.pointer || shape.reference || shape.rvalueReference) continue;
      const base = slicedBases.find((b) => b.name === normalizeType(ctx.src(type)));
      if (!base) continue;
      let value = field(d, 'value');
      if (value?.type === 'argument_list' || value?.type === 'initializer_list') value = namedKids(value)[0] ?? null;
      const derived = classOfVar(value);
      if (value && derived && derived.name !== base.name && derivesFrom(ctx, derived, base.name)) report(value, base.name, derived.name);
    }
    for (const a of ctx.nodesOf('assignment_expression')) {
      if (a.child(1)?.text !== '=') continue;
      const left = classOfVar(field(a, 'left'));
      const right = classOfVar(field(a, 'right'));
      if (left && right && slicedBases.includes(left) && right.name !== left.name && derivesFrom(ctx, right, left.name)) report(field(a, 'right')!, left.name, right.name);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ES.70  Prefer a switch-statement to an if-chain on constants
// ---------------------------------------------------------------------------------------------
const switchChainCheck: Check = {
  name: 'ES.70 if chains',
  covers: ['ES.70'],
  run(ctx) {
    for (const head of ctx.nodesOf('if_statement')) {
      if (head.parent?.type === 'else_clause') continue;
      let subject: string | null = null;
      let length = 0;
      let cur: Node | null = head;
      while (cur?.type === 'if_statement') {
        const condClause = field(cur, 'condition');
        const cond = condClause ? field(condClause, 'value') : null;
        if (cond?.type !== 'binary_expression' || field(cond, 'operator')?.text !== '==') break;
        const l = field(cond, 'left');
        const r = field(cond, 'right');
        const isConst = (n: Node | null): boolean => !!n && ['number_literal', 'char_literal'].includes(n.type);
        const id = l?.type === 'identifier' && isConst(r) ? l.text : r?.type === 'identifier' && isConst(l) ? r.text : null;
        if (!id || (subject && subject !== id)) break;
        subject = id;
        length++;
        const alt = field(cur, 'alternative');
        cur = alt ? namedKids(alt).find((n) => n.type !== 'comment') ?? null : null;
      }
      if (length >= 3) {
        ctx.report({
          ruleId: 'ES.70',
          start: head.startIndex,
          end: head.startIndex + 2,
          message: t('Prefer a switch-statement to this if-chain that compares "{0}" with constants.', subject ?? ''),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// T.83  Do not declare a member function template virtual
// ---------------------------------------------------------------------------------------------
const virtualTemplateCheck: Check = {
  name: 'T.83 virtual member templates',
  covers: ['T.83'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      if (!f.isVirtualSpecified) continue;
      const tpl = ancestor(f.node, 'template_declaration');
      const params = tpl ? field(tpl, 'parameters') : null;
      if (tpl && params && namedKids(params).length > 0 && tpl.parent?.type === 'field_declaration_list') {
        ctx.report({ ruleId: 'T.83', node: f.nameNode, message: t('A member function template cannot be virtual.') });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// SF.22  Unnamed namespace instead of static for internal entities
// ---------------------------------------------------------------------------------------------
const unnamedNamespaceCheck: Check = {
  name: 'SF.22 internal linkage',
  covers: ['SF.22'],
  run(ctx) {
    if (ctx.file.isHeader) return;
    for (const spec of ctx.nodesOf('storage_class_specifier')) {
      if (spec.text !== 'static') continue;
      const decl = spec.parent;
      if (!decl || !['function_definition', 'declaration'].includes(decl.type)) continue;
      const scope = decl.parent;
      const atNamespaceScope = scope?.type === 'translation_unit' || (scope?.type === 'declaration_list' && scope.parent?.type === 'namespace_definition' && !!field(scope.parent, 'name'));
      if (!atNamespaceScope) continue;
      if (kids(decl).some((k) => k.type === 'storage_class_specifier' && k.text === 'typedef')) continue;
      ctx.report({
        ruleId: 'SF.22',
        node: spec,
        message: t('Use an unnamed namespace instead of static for internal entities.'),
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// I.12 / F.23  gsl::not_null (only when the GSL is enabled: it has no standard equivalent)
// ---------------------------------------------------------------------------------------------
const notNullCheck: Check = {
  name: 'I.12 not_null',
  covers: ['I.12'],
  run(ctx) {
    if (!ctx.config.gslEnabled) return;
    for (const f of functionsOf(ctx)) {
      if (f.node.type !== 'function_definition' || !f.body) continue;
      const leading = namedKids(f.body).filter((n) => n.type !== 'comment').slice(0, 3);
      for (const p of f.params) {
        const shape = shapeOf(field(p, 'declarator'));
        const type = field(p, 'type');
        const name = shape.nameNode?.text;
        if (!name || !type || !shape.pointer || shape.array || normalizeType(ctx.src(type)) === 'void') continue;
        const guard = leading.find((st) => {
          if (st.type === 'if_statement') {
            const cond = field(st, 'condition');
            const text = (cond ? ctx.src(cond) : '').replace(/\s+/g, '');
            const nullTest = text === `(!${name})` || text === `(${name}==nullptr)` || text === `(nullptr==${name})` || text === `(${name}==0)`;
            const cons = field(st, 'consequence');
            return nullTest && !!cons && /^(?:\{\s*)?(?:return|throw)\b/.test(ctx.src(cons).trim());
          }
          const text = ctx.src(st).replace(/\s+/g, '');
          return new RegExp(`^(?:assert|Expects)\\(\\(?${name}(?:!=nullptr|!=0)?\\)?\\);?$`).test(text);
        });
        if (!guard) continue;
        ctx.report({
          ruleId: 'I.12',
          alsoCovers: ['F.23'],
          node: p,
          message: t('"{0}" must not be null (it is checked on entry): declare it gsl::not_null.', name),
          fixes: [ctx.fix(t('Use gsl::not_null'), [ctx.replace(p, `gsl::not_null<${ctx.src(type)}${shape.pointer ? '*' : ''}> ${name}`)], 'unsafe')],
        });
      }
    }
  },
};

export const m5Checks: Check[] = [slicingCheck, switchChainCheck, virtualTemplateCheck, unnamedNamespaceCheck, notNullCheck];
