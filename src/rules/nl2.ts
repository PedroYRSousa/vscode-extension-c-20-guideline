import type { Node } from 'web-tree-sitter';
import { field } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import type { Check, TextEdit } from '../core/types.js';
import { classesOf } from './classes.js';
import { functionsOf } from './funcs.js';

// ---------------------------------------------------------------------------------------------
// Naming (NL.8 / NL.10 / NL.17).  Convention: the Core Guidelines / Stroustrup style (answer 6b):
//   variables, functions, members, namespaces, enumerators:  lower_case_with_underscores
//   user-defined types and concepts:                           Capitalized_with_underscores
//   macros:                                                    ALL_CAPS (ES.32)
// ---------------------------------------------------------------------------------------------
export function toUnderscore(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .toLowerCase();
}

export function toTypeName(name: string): string {
  const snake = toUnderscore(name.replace(/^_+/, ''));
  return snake.charAt(0).toUpperCase() + snake.slice(1);
}

const hasHump = (name: string): boolean => /[a-z0-9][A-Z]/.test(name) || /[A-Z]{2,}[a-z]/.test(name);
const SNAKE = /^(?:m_)?[a-z][a-z0-9]*(?:_[a-z0-9]+)*_?$/;
const TYPE_NAME = /^[A-Z][a-z0-9]*(?:_[A-Za-z0-9]+)*$/;

function renameEverywhere(ctx: Context, from: string, to: string): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const n of ctx.nodesOf('identifier', 'type_identifier', 'field_identifier', 'namespace_identifier', 'statement_identifier')) {
    if (n.text === from) edits.push(ctx.replace(n, to));
  }
  return edits;
}

const namingCheck: Check = {
  name: 'NL.10 naming',
  covers: ['NL.8', 'NL.10', 'NL.17'],
  run(ctx) {
    const macros = new Set<string>();
    for (const def of ctx.nodesOf('preproc_def', 'preproc_function_def')) macros.add(field(def, 'name')?.text ?? '');
    const reported = new Set<number>();

    const reserved = (n: Node): boolean => {
      if (reported.has(n.id) || macros.has(n.text)) return false;
      if (/__/.test(n.text) || /^_[A-Z]/.test(n.text)) {
        reported.add(n.id);
        ctx.report({ ruleId: 'NL.8', node: n, message: t('"{0}" is a reserved identifier (double underscore, or underscore followed by a capital).', n.text) });
        return true;
      }
      return false;
    };

    const checkValue = (n: Node, what: string): void => {
      if (reserved(n) || reported.has(n.id) || macros.has(n.text)) return;
      const name = n.text;
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) return; // ALL_CAPS is reported by NL.9
      if (SNAKE.test(name)) return;
      reported.add(n.id);
      if (hasHump(name)) {
        const suggestion = toUnderscore(name);
        ctx.report({
          ruleId: 'NL.10',
          alsoCovers: ['NL.8'],
          node: n,
          message: t('Prefer underscore_style names: rename {0} "{1}" to "{2}".', what, name, suggestion),
          fixes: [ctx.fix(t('Rename to {0} (in this file)', suggestion), renameEverywhere(ctx, name, suggestion), 'unsafe')],
        });
      } else if (/^[A-Z]/.test(name)) {
        const suggestion = name.toLowerCase();
        ctx.report({
          ruleId: 'NL.17',
          alsoCovers: ['NL.8'],
          node: n,
          message: t('Do not capitalize the names of {0}s ("{1}").', what, name),
          fixes: [ctx.fix(t('Rename to {0} (in this file)', suggestion), renameEverywhere(ctx, name, suggestion), 'unsafe')],
        });
      }
    };

    const checkType = (n: Node | null, what: string): void => {
      if (!n) return;
      if (reserved(n) || reported.has(n.id) || macros.has(n.text)) return;
      const name = n.text.replace(/<.*$/, '');
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) return;
      if (TYPE_NAME.test(name)) return;
      reported.add(n.id);
      const suggestion = toTypeName(name);
      if (/^[a-z_]/.test(name)) {
        ctx.report({
          ruleId: 'NL.17',
          node: n,
          message: t('Capitalize the names of user-defined types: {0} "{1}".', what, name),
          fixes: [ctx.fix(t('Rename to {0} (in this file)', suggestion), renameEverywhere(ctx, name, suggestion), 'unsafe')],
        });
      } else {
        ctx.report({
          ruleId: 'NL.10',
          node: n,
          message: t('Prefer underscore_style names: rename {0} "{1}" to "{2}".', what, name, suggestion),
          fixes: [ctx.fix(t('Rename to {0} (in this file)', suggestion), renameEverywhere(ctx, name, suggestion), 'unsafe')],
        });
      }
    };

    for (const v of ctx.symbols.vars) {
      if (v.declNode.parent?.type === 'template_parameter_list') continue; // non-type template parameters (N, Size, ...)
      if (ancestor_in_extern_c(v.declNode)) continue;
      checkValue(v.nameNode, v.kind === 'member' ? t('member') : v.kind === 'param' ? t('parameter') : t('variable'));
    }
    for (const f of functionsOf(ctx)) {
      if (f.isConstructor || f.isDestructor || f.isOperator || f.name === 'main' || f.nameNode.type === 'operator_name' || f.nameNode.type === 'operator_cast') continue;
      if (f.node.type === 'function_definition' && !f.returnType && !f.isConstructor) continue; // macro-like invocation
      if (ancestor_in_extern_c(f.node)) continue;
      const nameNode = f.nameNode.type === 'qualified_identifier' ? field(f.nameNode, 'name') ?? f.nameNode : f.nameNode;
      if (nameNode.type === 'template_function') continue;
      checkValue(nameNode, t('function'));
    }
    for (const c of classesOf(ctx)) {
      if (c.nameNode && !ancestor_in_extern_c(c.node)) checkType(c.nameNode, t('type'));
    }
    for (const e of ctx.nodesOf('enum_specifier')) {
      const name = field(e, 'name');
      if (name && field(e, 'body')) checkType(name, t('enumeration'));
      const body = field(e, 'body');
      if (body) for (const en of body.descendantsOfType('enumerator')) {
        const nm = en ? field(en, 'name') : null;
        if (nm) checkValue(nm, t('enumerator'));
      }
    }
    for (const c of ctx.nodesOf('concept_definition')) checkType(field(c, 'name'), t('concept'));
    for (const ns of ctx.nodesOf('namespace_definition')) {
      const name = field(ns, 'name');
      if (name && name.type === 'namespace_identifier') checkValue(name, t('namespace'));
    }
  },
};

function ancestor_in_extern_c(node: Node): boolean {
  for (let p: Node | null = node.parent; p; p = p.parent) if (p.type === 'linkage_specification') return true;
  return false;
}

export const nlNamingChecks: Check[] = [namingCheck];
