import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { functionsOf, isSingleParamOf, paramName, paramTypeText, type FuncInfo } from './funcs.js';
import { identifierUses, isCallTo, normalizeType } from './util.js';

// ---------------------------------------------------------------------------------------------
// F.3 / F.2  Keep functions short and simple
// ---------------------------------------------------------------------------------------------
function cyclomaticComplexity(body: Node): number {
  let n = 1;
  const visit = (node: Node): void => {
    switch (node.type) {
      case 'if_statement':
      case 'for_statement':
      case 'for_range_loop':
      case 'while_statement':
      case 'do_statement':
      case 'switch_statement':
      case 'catch_clause':
      case 'conditional_expression':
        n++;
        break;
      case 'binary_expression': {
        const op = field(node, 'operator')?.text;
        if (op === '&&' || op === '||') n++;
        break;
      }
      case 'lambda_expression':
        return;
      default:
    }
    for (const c of kids(node)) visit(c);
  };
  visit(body);
  return n;
}

const sizeCheck: Check = {
  name: 'F.3 function size',
  covers: ['F.3', 'F.2'],
  run(ctx) {
    const { maxFunctionLines, maxFunctionColumns, maxCyclomaticComplexity, maxParameters } = ctx.config.thresholds;
    for (const f of functionsOf(ctx)) {
      if (f.node.type !== 'function_definition' || !f.body) continue;
      const first = ctx.lineOf(f.node.startIndex);
      const last = ctx.lineOf(f.node.endIndex - 1);
      const lines = last - first + 1;
      const reasons: string[] = [];
      if (lines > maxFunctionLines) reasons.push(t('{0} lines (max {1})', lines, maxFunctionLines));
      let wide = 0;
      for (let l = first; l <= last; l++) if (ctx.lineText(l).replace(/\t/g, '    ').length > maxFunctionColumns) wide++;
      if (wide > 0) reasons.push(t('{0} line(s) wider than {1} columns', wide, maxFunctionColumns));
      const complexity = cyclomaticComplexity(f.body);
      if (complexity > maxCyclomaticComplexity) reasons.push(t('{0} logical paths (max {1})', complexity, maxCyclomaticComplexity));
      if (reasons.length > 0) {
        ctx.report({
          ruleId: 'F.3',
          node: f.nameNode,
          message: t('Keep functions short and simple: "{0}" has {1}.', f.name, reasons.join(', ')),
        });
      }
    }
    for (const f of functionsOf(ctx)) {
      if (f.params.length > maxParameters) {
        ctx.report({
          ruleId: 'F.2',
          alsoCovers: ['I.23'],
          node: f.nameNode,
          message: t('"{0}" has {1} parameters (max {2}); group related data in a struct.', f.name, f.params.length, maxParameters),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.36 / C.37 / C.66 / C.84 / C.85 / C.89 / E.16 / F.6 / C.44  noexcept
// ---------------------------------------------------------------------------------------------
function throwsDirectly(body: Node | null): boolean {
  if (!body) return false;
  for (const th of body.descendantsOfType(['throw_statement', 'throw_expression'])) {
    if (!th) continue;
    let p = th.parent;
    let guarded = false;
    while (p && p.id !== body.id) {
      if (p.type === 'try_statement' && p.startIndex <= th.startIndex && th.endIndex <= (field(p, 'body')?.endIndex ?? 0)) {
        guarded = true;
        break;
      }
      if (p.type === 'lambda_expression') {
        guarded = true;
        break;
      }
      p = p.parent;
    }
    if (!guarded) return true;
  }
  return false;
}

function addNoexcept(ctx: Context, f: FuncInfo): Fix {
  const fd = f.declarator;
  const params = field(fd, 'parameters');
  const specs = kids(fd).filter((k) => k.type === 'type_qualifier' || k.type === 'ref_qualifier' || k.type === 'virtual_specifier' || k.type === 'trailing_return_type' || k.type === 'requires_clause');
  const afterParams = params ? params.endIndex : fd.endIndex;
  // `noexcept` goes after cv/ref qualifiers (and before override/final and the trailing return type)
  const quals = specs.filter((s) => s.type === 'type_qualifier' || s.type === 'ref_qualifier');
  const at = quals.length > 0 ? quals[quals.length - 1].endIndex : afterParams;
  const edits: TextEdit[] = f.noexceptNode && f.noexcept === 'false' ? [ctx.replace(f.noexceptNode, 'noexcept')] : [ctx.insertAt(at, ' noexcept')];
  return ctx.fix(t('Add noexcept'), edits);
}

const noexceptCheck: Check = {
  name: 'C.37 noexcept',
  covers: ['C.37', 'C.66', 'C.85', 'C.89', 'F.6', 'C.44'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      if (f.isDefaulted || f.isDeleted) continue;
      const hasNoexcept = f.noexcept === 'true' || f.noexcept === 'expr';

      // C.37 / C.36 / E.16: a destructor that could throw
      if (f.isDestructor && f.node.type === 'function_definition' && throwsDirectly(f.body)) {
        ctx.report({
          ruleId: 'C.37',
          alsoCovers: ['C.36', 'E.16', 'F.6'],
          node: f.nameNode,
          message: t('A destructor must not fail: it throws. Declare it noexcept and handle errors inside.'),
          fixes: hasNoexcept ? [] : [addNoexcept(ctx, f)],
        });
      }

      // C.85 / C.84 / E.16: swap must be noexcept
      if (f.name === 'swap' && !hasNoexcept && !f.isOperator) {
        ctx.report({
          ruleId: 'C.85',
          alsoCovers: ['C.84', 'E.16', 'F.6'],
          node: f.nameNode,
          message: t('A swap function must not fail: declare it noexcept.'),
          fixes: [addNoexcept(ctx, f)],
        });
      }

      // C.66: move operations
      const moveCtor = f.isConstructor && isSingleParamOf(ctx, f, 'move');
      const moveAssign = f.name === 'operator=' && isSingleParamOf(ctx, f, 'move');
      if ((moveCtor || moveAssign) && !hasNoexcept) {
        ctx.report({
          ruleId: 'C.66',
          alsoCovers: ['F.6'],
          node: f.nameNode,
          message: t('Make move operations noexcept.'),
          fixes: [addNoexcept(ctx, f)],
        });
      }

      // C.89: std::hash specializations
      if (f.name === 'operator()' && !hasNoexcept && f.className && /^(?:std::)?hash$/.test(f.className)) {
        ctx.report({
          ruleId: 'C.89',
          node: f.nameNode,
          message: t('Make a hash function noexcept.'),
          fixes: [addNoexcept(ctx, f)],
        });
      }

      // C.44 / F.6: throwing default constructor
      if (f.isConstructor && f.node.type === 'function_definition' && f.params.every((p) => p.type === 'optional_parameter_declaration') && throwsDirectly(f.body)) {
        ctx.report({
          ruleId: 'C.44',
          alsoCovers: ['F.6'],
          node: f.nameNode,
          message: t('Prefer default constructors that are simple and non-throwing.'),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.9  Unused parameters should be unnamed
// ---------------------------------------------------------------------------------------------
const unusedParamCheck: Check = {
  name: 'F.9 unused parameters',
  covers: ['F.9'],
  run(ctx) {
    const checkList = (owner: Node, params: Node[]): void => {
      for (const p of params) {
        if (p.type !== 'parameter_declaration' && p.type !== 'optional_parameter_declaration') continue;
        const nameNode = shapeOf(field(p, 'declarator')).nameNode;
        if (!nameNode) continue;
        if (kids(p).some((k) => k.type === 'attribute_declaration')) continue; // [[maybe_unused]]
        const name = nameNode.text;
        if (identifierUses(owner, name).some((u) => u.id !== nameNode.id)) continue;
        ctx.report({
          ruleId: 'F.9',
          node: nameNode,
          message: t('Unused parameter "{0}" should be unnamed.', name),
          fixes: [ctx.fix(t('Comment out the parameter name'), [ctx.replace(nameNode, `/*${name}*/`)])],
        });
      }
    };
    for (const f of functionsOf(ctx)) {
      if (f.node.type === 'function_definition' && f.body) checkList(f.node, f.params);
    }
    for (const l of ctx.nodesOf('lambda_expression')) {
      const decl = field(l, 'declarator');
      const params = decl ? field(decl, 'parameters') : null;
      if (params) checkList(l, namedKids(params));
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.16 / F.17  "in" and "in-out" parameters
// ---------------------------------------------------------------------------------------------
const CHEAP = /^(?:bool|char|signed char|unsigned char|wchar_t|char8_t|char16_t|char32_t|short|unsigned short|int|unsigned|unsigned int|long|unsigned long|long long|unsigned long long|float|double|long double|(?:std::)?(?:size_t|ptrdiff_t|u?int(?:8|16|32|64)_t|u?intptr_t|nullptr_t|byte)|std::string_view|std::u8string_view|std::wstring_view|std::span<.*>|std::chrono::\w+)$/;
const SIZES: Record<string, number> = { bool: 1, char: 1, 'signed char': 1, 'unsigned char': 1, short: 2, 'unsigned short': 2, int: 4, unsigned: 4, 'unsigned int': 4, float: 4, double: 8, 'long long': 8, 'unsigned long long': 8, int8_t: 1, uint8_t: 1, int16_t: 2, uint16_t: 2, int32_t: 4, uint32_t: 4, int64_t: 8, uint64_t: 8, size_t: 8, ptrdiff_t: 8 };

function isMovedIn(body: Node, name: string): boolean {
  return body.descendantsOfType('call_expression').some((c) => {
    if (!c || !isCallTo(c, 'move')) return false;
    const arg = field(c, 'arguments');
    const first = arg ? namedKids(arg)[0] : undefined;
    return first?.type === 'identifier' && first.text === name;
  });
}

const inParamCheck: Check = {
  name: 'F.16 in parameters',
  covers: ['F.16', 'F.17'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      for (const p of f.params) {
        if (p.type === 'variadic_parameter_declaration') continue;
        const type = field(p, 'type');
        const decl = field(p, 'declarator');
        if (!type) continue;
        const shape = shapeOf(decl);
        const isAbstractRef = decl?.type === 'abstract_reference_declarator';
        const isRef = shape.reference || (isAbstractRef && !decl!.text.startsWith('&&'));
        const isConst = kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const');
        const typeText = normalizeType(ctx.src(type));
        const name = paramName(p);

        // cheap type passed by reference to const: pass by value
        if (isRef && isConst && CHEAP.test(typeText) && !shape.pointer && !ancestor(p, 'template_declaration')) {
          const dflt = p.type === 'optional_parameter_declaration' ? field(p, 'default_value') : null;
          const quals = kids(p).filter((k) => k.type === 'type_qualifier' && k.text !== 'const').map((k) => k.text);
          const rebuilt = `${[...quals, ctx.src(type)].join(' ')}${name ? ' ' + name : ''}${dflt ? ' = ' + ctx.src(dflt) : ''}`;
          ctx.report({
            ruleId: 'F.16',
            node: p,
            message: t('Pass cheaply-copied types such as "{0}" by value, not by reference to const.', typeText),
            fixes: [ctx.fix(t('Pass by value'), [ctx.replace(p, rebuilt)])],
          });
          continue;
        }
        // large std::array by value
        const arr = /^std::array<\s*([\w: ]+?)\s*,\s*(\d+)\s*>$/.exec(typeText);
        if (arr && !isRef && !shape.pointer) {
          const elem = SIZES[arr[1].replace(/^std::/, '')];
          if (elem && elem * Number(arr[2]) > 32) {
            const rebuilt = `const ${ctx.src(type)}&${name ? ' ' + name : ''}`;
            ctx.report({
              ruleId: 'F.16',
              node: p,
              message: t('"{0}" is larger than 4 * sizeof(void*); pass it by reference to const.', typeText),
              fixes: [ctx.fix(t('Pass by reference to const'), [ctx.replace(p, rebuilt)], 'unsafe')],
            });
          }
        }
        // moved reference parameters
        if (isRef && name && f.body && isMovedIn(f.body, name)) {
          ctx.report({
            ruleId: isConst ? 'F.16' : 'F.17',
            node: p,
            message: isConst
              ? t('"{0}" is a reference to const but is moved from; take it by X&& (or by value) instead.', name)
              : t('"{0}" is an in-out reference and is moved from; take it by X&& instead.', name),
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.21 / F.45 / F.46 / F.47 / F.49  Return types
// ---------------------------------------------------------------------------------------------
const returnTypeCheck: Check = {
  name: 'F.45 return types',
  covers: ['F.21', 'F.45', 'F.46', 'F.47', 'F.49'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      const rt = f.returnType;
      if (!rt || f.isConstructor || f.isDestructor) continue;
      const rtText = ctx.src(rt);

      // F.21: pair / tuple
      if (/^std::(?:pair|tuple)\b/.test(rtText) && !f.returnsPointer && !f.returnsReference && !f.isOperator) {
        const template = ancestor(f.node, 'template_declaration');
        const variadic = template ? template.text.includes('...') : false;
        if (!variadic) {
          ctx.report({
            ruleId: 'F.21',
            node: rt,
            message: t('Prefer returning a struct with named members instead of {0}.', rtText.replace(/<.*$/s, '')),
          });
        }
      }

      // F.45: don't return T&&
      if (f.returnsRvalueReference && !['move', 'forward', 'forward_like', 'declval'].includes(f.name)) {
        ctx.report({
          ruleId: 'F.45',
          node: rt,
          message: t("Don't return a T&&; return by value (or T& when no copy is wanted)."),
        });
      }

      // F.46: main returns int
      if (f.name === 'main' && !f.className && !ancestor(f.node, 'namespace_definition') && normalizeType(rtText) !== 'int') {
        const edits: TextEdit[] = [ctx.replace(rt, 'int')];
        if (f.body) {
          for (const r of f.body.descendantsOfType('return_statement')) {
            if (r && namedKids(r).filter((n) => n.type !== 'comment').length === 0 && !ancestor(r, 'lambda_expression')) edits.push(ctx.replace(r, 'return 0;'));
          }
        }
        ctx.report({ ruleId: 'F.46', node: rt, message: t('int is the return type for main().'), fixes: [ctx.fix(t('Return int'), edits)] });
      }

      // F.49: don't return const T
      if (!f.returnsPointer && !f.returnsReference && !f.returnsRvalueReference) {
        const outer = field(f.node, 'declarator');
        // `const T f()` and `T const f()`
        const constNode = kids(f.node).find((k) => k.type === 'type_qualifier' && k.text === 'const' && (k.endIndex <= rt.startIndex || (k.startIndex >= rt.endIndex && (!outer || k.endIndex <= outer.startIndex))));
        if (constNode && normalizeType(rtText) !== 'void') {
          let from = constNode.startIndex;
          let to = constNode.endIndex;
          if (constNode.endIndex <= rt.startIndex) to = rt.startIndex;
          else while (from > rt.endIndex && /[ \t]/.test(ctx.text[from - 1])) from--;
          ctx.report({
            ruleId: 'F.49',
            node: constNode,
            message: t("Don't return const T by value; it inhibits moves."),
            fixes: [ctx.fix(t('Remove const'), [ctx.replaceRange(from, to, '')])],
          });
        }
      }

      // F.47 (+ C.60 / C.63): assignment operators return T&
      if (/^operator\s*(?:[-+*/%^&|]|<<|>>)?=$/.test(f.name) && f.className && !f.isDefaulted && !f.isDeleted) {
        const type = normalizeType(rtText);
        const constNode = kids(f.node).find((k) => k.type === 'type_qualifier' && k.text === 'const' && k.endIndex <= rt.startIndex);
        const good = (f.returnsReference && !constNode) || /^decltype\(auto\)$/.test(type);
        if (!good) {
          const fixes: Fix[] = [];
          if (f.returnsReference && constNode) {
            fixes.push(ctx.fix(t('Remove const'), [ctx.replaceRange(constNode.startIndex, rt.startIndex, '')]));
          } else if (type === 'void' && !f.returnsPointer) {
            const edits: TextEdit[] = [ctx.replace(rt, `${f.className}&`)];
            const body = f.body;
            if (!body) fixes.push(ctx.fix(t('Return a reference'), edits));
            else if (body.descendantsOfType('return_statement').every((r) => !r || ancestor(r, 'lambda_expression'))) {
              const close = body.endIndex - 1;
              if (ctx.startsLine(close)) {
                edits.push(ctx.insertAt(ctx.lineStart(ctx.lineOf(close)), `${ctx.indentAt(body.startIndex)}${ctx.indentUnit}return *this;${ctx.eol}`));
              } else {
                edits.push(ctx.insertAt(close, ' return *this; '));
              }
              fixes.push(ctx.fix(t('Return *this'), edits));
            }
          }
          ctx.report({
            ruleId: 'F.47',
            alsoCovers: ['C.60', 'C.63'],
            node: rt,
            message: t('Assignment operators should return T& to enable chaining.'),
            fixes,
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// F.51  Prefer default arguments over overloading
// ---------------------------------------------------------------------------------------------
const overloadCheck: Check = {
  name: 'F.51 overloads',
  covers: ['F.51'],
  run(ctx) {
    const byScope = new Map<number, Map<string, Array<{ f: FuncInfo; types: string[] }>>>();
    for (const f of functionsOf(ctx)) {
      if (f.isOperator || f.isConstructor || f.isDestructor || f.isTemplate || f.params.length === 0) continue;
      const scope = f.node.parent;
      if (!scope) continue;
      const key = `${f.name}|${f.isConst}`;
      const types = f.params.map((p) => paramTypeText(ctx, p).replace(/\s+/g, ''));
      let sm = byScope.get(scope.id);
      if (!sm) byScope.set(scope.id, (sm = new Map()));
      const list = sm.get(key);
      if (list) list.push({ f, types });
      else sm.set(key, [{ f, types }]);
    }
    for (const sm of byScope.values()) {
      for (const list of sm.values()) {
        if (list.length < 2) continue;
        const prefixOf = (a: string[], b: string[]): boolean => a.length < b.length && a.every((x, i) => x === b[i]);
        const hit = list.find((a) => list.some((b) => b !== a && prefixOf(a.types, b.types)));
        if (!hit) continue;
        ctx.report({
          ruleId: 'F.51',
          node: hit.f.nameNode,
          message: t('The overloads of "{0}" share a common prefix of parameters; prefer default arguments.', hit.f.name),
        });
      }
    }
  },
};

export const fChecks: Check[] = [sizeCheck, noexceptCheck, unusedParamCheck, inParamCheck, returnTypeCheck, overloadCheck];
