import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import { t } from '../core/i18n.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { classByName, classesOf } from './classes.js';
import { paramTypeText } from './funcs.js';

// ---------------------------------------------------------------------------------------------
// C.7  Don't define a class or enum and declare a variable of its type in the same statement
// ---------------------------------------------------------------------------------------------
const classAndVariableCheck: Check = {
  name: 'C.7 definition and variable',
  covers: ['C.7'],
  run(ctx) {
    for (const decl of ctx.nodesOf('declaration')) {
      const type = field(decl, 'type');
      if (!type || !['struct_specifier', 'class_specifier', 'union_specifier', 'enum_specifier'].includes(type.type)) continue;
      if (!field(type, 'body')) continue;
      const declarators = decl.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
      if (declarators.length === 0) continue;
      if (ancestor(decl, 'type_definition')) continue;
      const name = field(type, 'name');
      const fixes: Fix[] = [];
      if (name && !kids(decl).some((k) => k.type === 'storage_class_specifier' && k.text === 'typedef')) {
        const indent = ctx.indentAt(decl.startIndex);
        const quals = kids(decl).filter((k) => k.type === 'type_qualifier' || k.type === 'storage_class_specifier').map((k) => k.text).join(' ');
        const rest = declarators.map((d) => ctx.src(d)).join(', ');
        fixes.push(
          ctx.fix(t('Separate the definition from the variable'), [
            ctx.replaceRange(type.endIndex, decl.endIndex, `;${ctx.eol}${indent}${quals ? quals + ' ' : ''}${name.text} ${rest};`),
          ]),
        );
      }
      ctx.report({
        ruleId: 'C.7',
        node: declarators[0],
        message: t("Don't define a class or enum and declare a variable of its type in the same statement."),
        fixes,
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.121 / C.126 / C.128 / C.131 / C.132 / C.139  Class hierarchies
// ---------------------------------------------------------------------------------------------
const hierarchyCheck: Check = {
  name: 'C.121 class hierarchies',
  covers: ['C.121', 'C.126', 'C.128', 'C.131', 'C.132', 'C.139'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const introduces = c.functions.filter((m) => m.isVirtual && !m.isOverride && !m.isFinal && !m.info.isDestructor);
      const abstract = c.functions.some((m) => m.isPure);
      const hasData = c.fields.some((f) => !f.isStatic);

      // C.121: a base class used as an interface is a pure abstract class
      if (introduces.length > 0 && hasData) {
        ctx.report({
          ruleId: 'C.121',
          node: c.nameNode ?? c.node,
          message: t('A base class used as an interface should be a pure abstract class: it has data members and overridable virtual functions.'),
        });
      }

      // C.126: abstract classes don't need user-written constructors
      if (abstract) {
        const ctor = c.functions.find((m) => m.info.isConstructor && !m.info.isDefaulted && !m.info.isDeleted && !(m.info.params.length === 1 && /&&?\s*\w*$/.test(ctx.src(m.info.params[0]))));
        if (ctor) {
          ctx.report({
            ruleId: 'C.126',
            node: ctor.info.nameNode,
            message: t("An abstract class typically doesn't need a user-written constructor."),
          });
        }
      }

      // C.128: exactly one of virtual / override / final
      for (const m of c.functions) {
        const count = [m.isVirtual, m.isOverride, m.isFinal].filter(Boolean).length;
        if (count > 1) {
          const virtualNode = kids(m.info.node).find((k) => k.type === 'virtual');
          const fixes: Fix[] = [];
          if (virtualNode && (m.isOverride || m.isFinal)) {
            const end = ctx.slice(virtualNode.endIndex, virtualNode.endIndex + 1) === ' ' ? virtualNode.endIndex + 1 : virtualNode.endIndex;
            fixes.push(ctx.fix(t('Remove the redundant virtual'), [ctx.replaceRange(virtualNode.startIndex, end, '')]));
          } else if (m.isOverride && m.isFinal) {
            const ov = kids(m.info.declarator).find((k) => k.type === 'virtual_specifier' && k.text === 'override');
            if (ov) fixes.push(ctx.fix(t('Remove the redundant override'), [ctx.replaceRange(ov.startIndex - (ctx.slice(ov.startIndex - 1, ov.startIndex) === ' ' ? 1 : 0), ov.endIndex, '')]));
          }
          ctx.report({
            ruleId: 'C.128',
            node: m.info.nameNode,
            message: t('Virtual functions should specify exactly one of virtual, override, or final.'),
            fixes,
          });
        }
      }
      // C.128: overrides of base-class virtuals (base in this file) without override / final
      for (const b of c.bases) {
        const base = classByName(ctx, b.name);
        if (!base) continue;
        for (const m of c.functions) {
          if (m.isVirtual || m.isOverride || m.isFinal || m.info.isConstructor || m.info.isDestructor || m.info.isOperator && m.info.name === 'operator=') continue;
          const sig = (x: typeof m): string => `${x.info.name}/${x.info.params.length}/${x.info.isConst}`;
          if (base.functions.some((bm) => (bm.isVirtual || bm.isOverride) && sig(bm) === sig(m))) {
            const decl = m.info.declarator;
            const afterParams = kids(decl).filter((k) => k.type === 'type_qualifier' || k.type === 'ref_qualifier' || k.type === 'noexcept').pop();
            const at = afterParams ? afterParams.endIndex : (field(decl, 'parameters')?.endIndex ?? decl.endIndex);
            ctx.report({
              ruleId: 'C.128',
              node: m.info.nameNode,
              message: t('"{0}" overrides a virtual function of "{1}": mark it override.', m.info.name, base.name),
              fixes: [ctx.fix(t('Add override'), [ctx.insertAt(at, ' override')])],
            });
          }
        }
      }

      // C.131: trivial getters and setters
      const trivial = c.functions.filter((m) => {
        const f = m.info;
        if (!f.body || !/^(?:get|set)_?\w*$/i.test(f.name)) return false;
        const stmts = namedKids(f.body).filter((n) => n.type !== 'comment');
        if (stmts.length !== 1) return false;
        const members = new Set(c.fields.flatMap((x) => x.names.map((n) => n.text)));
        if (/^get/i.test(f.name) && f.params.length === 0 && stmts[0].type === 'return_statement') {
          const v = namedKids(stmts[0])[0];
          return !!v && v.type === 'identifier' && members.has(v.text);
        }
        if (/^set/i.test(f.name) && f.params.length === 1 && stmts[0].type === 'expression_statement') {
          const e = namedKids(stmts[0])[0];
          return e?.type === 'assignment_expression' && e.child(1)?.text === '=' && members.has(field(e, 'left')?.text ?? '');
        }
        return false;
      });
      if (trivial.length >= 2) {
        for (const m of trivial) {
          ctx.report({
            ruleId: 'C.131',
            node: m.info.nameNode,
            message: t('Avoid trivial getters and setters: "{0}" only accesses a member.', m.info.name),
          });
        }
      }

      // C.132: every member function is virtual and has an implementation
      const real = c.functions.filter((m) => !m.info.isConstructor && !m.info.isDestructor);
      if (real.length >= 1 && real.every((m) => m.isVirtual && m.info.body) && c.bases.length === 0) {
        ctx.report({
          ruleId: 'C.132',
          node: c.nameNode ?? c.node,
          message: t("Don't make a function virtual without reason: all member functions of this class are virtual with implementations."),
        });
      }

      // C.139: final on classes
      if (c.isFinal) {
        const fin = kids(c.node).find((k) => k.type === 'virtual_specifier' && k.text === 'final');
        ctx.report({ ruleId: 'C.139', node: fin ?? c.node, message: t('Use final on classes sparingly.') });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.138 / C.140  Overload sets and default arguments across a hierarchy
// ---------------------------------------------------------------------------------------------
const derivedCheck: Check = {
  name: 'C.138 derived classes',
  covers: ['C.138', 'C.140'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      for (const b of c.bases) {
        const base = classByName(ctx, b.name);
        if (!base) continue;
        const usings = kids(c.body).filter((k) => k.type === 'using_declaration').map((k) => ctx.src(k));
        for (const m of c.functions) {
          const f = m.info;
          if (f.isConstructor || f.isDestructor || f.isOperator) continue;
          const sameName = base.functions.filter((bm) => bm.info.name === f.name && !bm.info.isConstructor);
          if (sameName.length === 0) continue;
          const sameSig = (bm: (typeof sameName)[number]): boolean => bm.info.params.length === f.params.length && bm.info.isConst === f.isConst;
          // C.140: different default arguments on a virtual function and its overrider
          for (const bm of sameName.filter(sameSig)) {
            const dflt = (fi: typeof f): string[] => fi.params.map((p) => (p.type === 'optional_parameter_declaration' ? ctx.src(field(p, 'default_value')!) : ''));
            const a = dflt(bm.info);
            const d = dflt(f);
            if ((bm.isVirtual || bm.isOverride) && a.some((x, i) => x !== d[i])) {
              ctx.report({
                ruleId: 'C.140',
                node: f.nameNode,
                message: t('Do not provide different default arguments for a virtual function and its overrider ("{0}").', f.name),
              });
            }
          }
          // C.138: hiding of base overloads
          const hidden = sameName.filter((bm) => !sameSig(bm) || paramTypeText(ctx, bm.info.params[0] ?? bm.info.node) !== paramTypeText(ctx, f.params[0] ?? f.node));
          const covered = usings.some((u) => new RegExp(`\\b${b.name}\\s*::\\s*${f.name}\\b`).test(u));
          if (hidden.length > 0 && sameName.every((bm) => !(bm.info.params.length === f.params.length && bm.info.isConst === f.isConst && ctx.src(bm.info.declarator).replace(/\s+/g, '') === ctx.src(f.declarator).replace(/\s+/g, ''))) && !covered) {
            ctx.report({
              ruleId: 'C.138',
              node: f.nameNode,
              message: t('"{0}" hides the overloads of "{1}::{0}"; add "using {1}::{0};".', f.name, base.name),
            });
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.146  static_cast for downcasts
// ---------------------------------------------------------------------------------------------
const downcastCheck: Check = {
  name: 'C.146 downcasts',
  covers: ['C.146'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'template_function' || field(fn, 'name')?.text !== 'static_cast') continue;
      const targ = field(fn, 'arguments');
      const td = targ ? namedKids(targ)[0] : undefined;
      if (td?.type !== 'type_descriptor') continue;
      const decl = field(td, 'declarator');
      if (!decl || !/^(?:abstract_)?(?:pointer|reference)_declarator$/.test(decl.type)) continue;
      const typeName = field(td, 'type')?.text.replace(/<.*$/, '').split('::').pop() ?? '';
      const cls = classByName(ctx, typeName);
      if (!cls || cls.bases.length === 0) continue;
      const arg = field(call, 'arguments');
      const inner = arg ? namedKids(arg)[0] : undefined;
      if (!inner) continue;
      const castText = ctx.src(fn).replace(/^static_cast/, 'dynamic_cast');
      ctx.report({
        ruleId: 'C.146',
        node: call,
        message: t('Use dynamic_cast, not static_cast, where class hierarchy navigation is unavoidable.'),
        fixes: [ctx.fix(t('Use dynamic_cast'), [ctx.replace(call, `${castText}(${ctx.src(inner)})`)], 'unsafe')],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.164  Conversion operators / C.161 symmetric operators / C.87 virtual comparison
// ---------------------------------------------------------------------------------------------
const operatorCheck: Check = {
  name: 'C.164 operators',
  covers: ['C.164', 'C.161', 'C.87'],
  run(ctx) {
    for (const op of ctx.nodesOf('operator_cast')) {
      const owner = op.parent;
      if (!owner) continue;
      const explicit = kids(owner).some((k) => k.type === 'explicit_function_specifier');
      if (explicit) continue;
      ctx.report({
        ruleId: 'C.164',
        node: op,
        message: t('Avoid implicit conversion operators: declare it explicit.'),
        fixes: [ctx.fix(t('Add explicit'), [ctx.insertAt(owner.startIndex, 'explicit ')], 'unsafe')],
      });
    }
    for (const c of classesOf(ctx)) {
      for (const m of c.functions) {
        const f = m.info;
        // C.161: symmetric operators as non-members
        if (/^operator(?:\+|-|\*|\/|%|&|\||\^)$/.test(f.name) && f.params.length === 1 && !f.isStatic) {
          ctx.report({
            ruleId: 'C.161',
            node: f.nameNode,
            message: t('Use a non-member function for the symmetric operator "{0}".', f.name),
          });
        }
        // C.87: virtual comparison operators
        if (/^operator(?:==|!=|<|<=|>|>=|<=>)$/.test(f.name) && m.isVirtual) {
          ctx.report({ ruleId: 'C.87', node: f.nameNode, message: t('Beware of {0} on base classes: do not make it virtual.', f.name) });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Enum.3 / Enum.6 / Enum.8  and  P.4 / C.181  unions
// ---------------------------------------------------------------------------------------------
const enumCheck: Check = {
  name: 'Enum.3 enumerations',
  covers: ['Enum.3', 'Enum.6', 'Enum.8', 'P.4'],
  run(ctx) {
    for (const e of ctx.nodesOf('enum_specifier')) {
      const body = field(e, 'body');
      if (!body) continue;
      const text = ctx.src(e);
      const scoped = /^enum\s+(?:class|struct)\b/.test(text);
      const name = field(e, 'name');

      if (!scoped) {
        const enumKeyword = kids(e).find((k) => k.type === 'enum');
        ctx.report({
          ruleId: 'Enum.3',
          node: enumKeyword ?? e,
          message: t('Prefer class enums over plain enums.'),
          fixes: enumKeyword && name ? [ctx.fix(t('Make it an enum class'), [ctx.insertAt(enumKeyword.endIndex, ' class')], 'unsafe')] : [],
        });
      }
      if (!name) {
        ctx.report({
          ruleId: 'Enum.6',
          node: kids(e).find((k) => k.type === 'enum') ?? e,
          message: t('Avoid unnamed enumerations; give it a name or use constexpr constants.'),
        });
      }

      // Enum.8: duplicate or fully consecutive explicit values
      const items = namedKids(body).filter((n) => n.type === 'enumerator');
      const explicit = items.filter((i) => field(i, 'value'));
      const literal = (i: Node): number | null => {
        const v = field(i, 'value');
        if (v?.type !== 'number_literal') return null;
        const n = Number(v.text.replace(/'/g, ''));
        return Number.isInteger(n) ? n : null;
      };
      if (explicit.length > 0 && explicit.every((i) => literal(i) !== null)) {
        const values = explicit.map((i) => literal(i)!);
        const seen = new Set<number>();
        const dup = explicit.find((i) => {
          const v = literal(i)!;
          if (seen.has(v)) return true;
          seen.add(v);
          return false;
        });
        if (dup) {
          ctx.report({ ruleId: 'Enum.8', node: dup, message: t('Duplicate enumerator value {0}.', literal(dup)!) });
        } else if (explicit.length === items.length && items.length >= 2 && values.every((v, i) => i === 0 || v === values[i - 1] + 1)) {
          const keepFirst = values[0] !== 0;
          const edits: TextEdit[] = items.slice(keepFirst ? 1 : 0).map((i) => {
            const v = field(i, 'value')!;
            const nameNode = field(i, 'name')!;
            return ctx.replaceRange(nameNode.endIndex, v.endIndex, '');
          });
          ctx.report({
            ruleId: 'Enum.8',
            node: items[0],
            message: t('Specify enumerator values only when necessary: the explicit values are all consecutive.'),
            fixes: [ctx.fix(t('Remove the redundant values'), edits)],
          });
        }
      }
    }

    for (const u of ctx.nodesOf('union_specifier')) {
      if (!field(u, 'body')) continue;
      ctx.report({
        ruleId: 'P.4',
        alsoCovers: ['C.181'],
        node: kids(u).find((k) => k.type === 'union') ?? u,
        message: t('Avoid unions; use std::variant (a type-safe, tagged union).'),
      });
    }
  },
};

export const c2Checks: Check[] = [classAndVariableCheck, hierarchyCheck, derivedCheck, downcastCheck, operatorCheck, enumCheck];
