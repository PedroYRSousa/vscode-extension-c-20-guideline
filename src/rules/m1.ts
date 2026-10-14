import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf, type VarInfo } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { classesOf } from './classes.js';
import { functionsOf } from './funcs.js';
import { identifierUses, normalizeType } from './util.js';

const TOP_LEVEL = ['translation_unit', 'declaration_list'];

function isNamespaceScope(decl: Node): boolean {
  const p = decl.parent;
  if (!p) return false;
  if (TOP_LEVEL.includes(p.type)) return p.type === 'translation_unit' || p.parent?.type === 'namespace_definition' || p.parent?.type === 'linkage_specification';
  return false;
}

// ---------------------------------------------------------------------------------------------
// I.2 / R.6  Avoid non-const global variables
// ---------------------------------------------------------------------------------------------
const globalsCheck: Check = {
  name: 'I.2 non-const globals',
  covers: ['I.2'],
  run(ctx) {
    for (const v of ctx.symbols.vars) {
      if (v.kind !== 'global' || v.declNode.type !== 'declaration') continue;
      if (!isNamespaceScope(v.declNode)) continue;
      const mutableObject = !v.isConst && !v.isConstexpr;
      const mutablePointee = (v.pointer || v.reference) && !v.pointeeConst && v.isConst === true && !v.isConstexpr;
      if (!mutableObject && !mutablePointee) continue;
      const fixes: Fix[] = [];
      if (!v.isConst && !v.isExtern && v.initializer && !v.reference) {
        fixes.push(ctx.fix(t('Make it const'), [ctx.insertAt(v.declNode.startIndex + ctx.src(v.declNode).search(/\S/), 'const ')], 'unsafe'));
      }
      ctx.report({
        ruleId: 'I.2',
        alsoCovers: ['R.6'],
        node: v.nameNode,
        message: t('Avoid non-const global variables ("{0}").', v.name),
        fixes,
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// I.3  Avoid singletons
// ---------------------------------------------------------------------------------------------
const singletonCheck: Check = {
  name: 'I.3 singletons',
  covers: ['I.3'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (/singleton/i.test(c.name)) {
        ctx.report({ ruleId: 'I.3', node: c.nameNode ?? c.node, message: t('Avoid singletons: "{0}" looks like one.', c.name) });
        continue;
      }
      for (const m of c.functions) {
        const f = m.info;
        if (!f.isStatic || !f.body || !(f.returnsReference || f.returnsPointer)) continue;
        const rt = f.returnType ? ctx.src(f.returnType).replace(/^const\s+/, '').trim() : '';
        if (rt !== c.name) continue;
        const hasLocalStatic = f.body.descendantsOfType('declaration').some((d) => d && kids(d).some((k) => k.type === 'storage_class_specifier' && k.text === 'static') && field(d, 'type')?.text === c.name);
        if (hasLocalStatic) {
          ctx.report({ ruleId: 'I.3', node: f.nameNode, message: t('Avoid singletons: "{0}" returns a function-local static instance of its own class.', f.name) });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// I.4  Precisely and strongly typed interfaces
// ---------------------------------------------------------------------------------------------
const interfaceTypesCheck: Check = {
  name: 'I.4 strongly typed interfaces',
  covers: ['I.4'],
  run(ctx) {
    for (const f of functionsOf(ctx)) {
      if (/^operator\s*(?:new|delete)/.test(f.name)) continue;
      const isVoidPtr = (typeNode: Node | null, pointer: boolean): boolean => !!typeNode && pointer && normalizeType(ctx.src(typeNode)) === 'void';
      if (isVoidPtr(f.returnType, f.returnsPointer)) {
        ctx.report({ ruleId: 'I.4', node: f.returnType!, message: t('Make interfaces precisely and strongly typed: avoid returning void*.') });
      }
      let bools = 0;
      for (const p of f.params) {
        if (p.type === 'variadic_parameter_declaration') continue;
        const type = field(p, 'type');
        const shape = shapeOf(field(p, 'declarator'));
        if (type && shape.pointer && normalizeType(ctx.src(type)) === 'void') {
          ctx.report({ ruleId: 'I.4', node: p, message: t('Make interfaces precisely and strongly typed: avoid void* parameters.') });
        }
        if (type && !shape.pointer && !shape.reference && !shape.rvalueReference && normalizeType(ctx.src(type)) === 'bool') bools++;
      }
      if (bools > 1) {
        ctx.report({ ruleId: 'I.4', node: f.nameNode, message: t('"{0}" has {1} bool parameters; use enumerations or a struct to make calls readable.', f.name, bools) });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// E.14 / E.15 / E.17 / E.28 / E.30 / E.31  Error handling
// ---------------------------------------------------------------------------------------------
const STD_EXCEPTION_BASES: Record<string, string> = {
  runtime_error: 'exception', logic_error: 'exception', bad_alloc: 'exception', bad_cast: 'exception', bad_typeid: 'exception', bad_exception: 'exception',
  bad_function_call: 'exception', bad_weak_ptr: 'exception', bad_optional_access: 'exception', bad_variant_access: 'exception', ios_base_failure: 'exception',
  range_error: 'runtime_error', overflow_error: 'runtime_error', underflow_error: 'runtime_error', system_error: 'runtime_error', regex_error: 'runtime_error',
  invalid_argument: 'logic_error', domain_error: 'logic_error', length_error: 'logic_error', out_of_range: 'logic_error', future_error: 'logic_error',
  bad_array_new_length: 'bad_alloc',
};

function typeNameOf(ctx: Context, n: Node | null): string {
  if (!n) return '';
  return ctx.src(n).replace(/<.*$/s, '').split('::').pop()!.trim();
}

const errorHandlingCheck: Check = {
  name: 'E.15 error handling',
  covers: ['E.14', 'E.15', 'E.17', 'E.28', 'E.30', 'E.31'],
  run(ctx) {
    // E.14 / E.15: what is thrown
    for (const th of ctx.nodesOf('throw_statement', 'throw_expression')) {
      const value = namedKids(th).find((n) => n.type !== 'comment');
      if (!value) continue;
      if (['number_literal', 'string_literal', 'char_literal', 'true', 'false', 'concatenated_string', 'raw_string_literal'].includes(value.type)) {
        ctx.report({ ruleId: 'E.14', node: value, message: t('Throw purpose-designed user-defined types, not built-in types.') });
      } else if (value.type === 'identifier') {
        const v = ctx.symbols.resolve(value.text, value);
        if (v && /^(?:const\s+)?(?:int|long|short|char|bool|float|double|unsigned)\b/.test(v.typeText) && !v.pointer) {
          ctx.report({ ruleId: 'E.14', node: value, message: t('Throw purpose-designed user-defined types, not built-in types.') });
        }
      } else if (value.type === 'call_expression' || value.type === 'compound_literal_expression') {
        const fn = field(value, value.type === 'call_expression' ? 'function' : 'type');
        if (fn && /^(?:std::)?exception$/.test(fn.text)) {
          ctx.report({ ruleId: 'E.14', node: value, message: t('Throw a purpose-designed exception type, not std::exception itself.') });
        }
      }
      if (value.type === 'new_expression' || (value.type === 'pointer_expression' && value.text.startsWith('&'))) {
        ctx.report({ ruleId: 'E.15', node: value, message: t('Throw by value, not by pointer.') });
      }
    }

    // E.15: catch by reference; E.31: ordering of handlers
    for (const tr of ctx.nodesOf('try_statement')) {
      const handlers = kids(tr).filter((k) => k.type === 'catch_clause');
      const catchTypes: Array<{ name: string; node: Node }> = [];
      for (const h of handlers) {
        const params = field(h, 'parameters');
        const p = params ? namedKids(params)[0] : undefined;
        if (!p || p.type !== 'parameter_declaration') {
          catchTypes.push({ name: '...', node: h });
          continue;
        }
        const type = field(p, 'type');
        const decl = field(p, 'declarator');
        const shape = shapeOf(decl);
        const byRef = shape.reference || decl?.type === 'abstract_reference_declarator';
        const pointer = shape.pointer || decl?.type === 'abstract_pointer_declarator';
        const builtin = type && ['primitive_type', 'sized_type_specifier'].includes(type.type);
        if (type && !byRef && !pointer && !builtin) {
          const nameNode = shape.nameNode;
          const text = ctx.src(type);
          const rebuilt = `const ${text}&${nameNode ? ' ' + nameNode.text : ''}`;
          ctx.report({
            ruleId: 'E.15',
            node: p,
            message: t('Catch exceptions from a hierarchy by reference.'),
            fixes: [ctx.fix(t('Catch by reference to const'), [ctx.replace(p, rebuilt)])],
          });
        }
        catchTypes.push({ name: typeNameOf(ctx, type), node: h });
      }
      // E.31
      const derivesFrom = (d: string, b: string): boolean => {
        let cur: string | undefined = d;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          seen.add(cur);
          if (cur === b) return d !== b;
          const cls = classesOf(ctx).find((c) => c.name === cur);
          cur = cls?.bases[0]?.name ?? STD_EXCEPTION_BASES[cur];
        }
        return false;
      };
      catchTypes.forEach((later, j) => {
        for (let i = 0; i < j; i++) {
          const earlier = catchTypes[i];
          if (earlier.name === '...' || earlier.name === later.name || derivesFrom(later.name, earlier.name)) {
            ctx.report({
              ruleId: 'E.31',
              node: later.node,
              start: later.node.startIndex,
              end: later.node.startIndex + 5,
              message: later.name === '...' ? t('Properly order your catch clauses: catch (...) must come last.') : t('This handler is hidden by the earlier handler for "{0}".', earlier.name === '...' ? '...' : earlier.name),
            });
            break;
          }
        }
      });
      // E.17: nested try blocks
      const body = field(tr, 'body');
      if (body && isInTryBody(tr)) {
        ctx.report({ ruleId: 'E.17', node: tr, start: tr.startIndex, end: tr.startIndex + 3, message: t("Don't try to catch every exception in every function: avoid nested try-blocks.") });
      }
    }

    // E.28: errno
    for (const id of ctx.nodesOf('identifier')) {
      if (id.text === 'errno' && id.parent?.type !== 'preproc_def' && id.parent?.type !== 'declaration') {
        ctx.report({ ruleId: 'E.28', alsoCovers: ['I.10'], node: id, message: t('Avoid error handling based on global state such as errno; use exceptions or return values.') });
      }
    }

    // E.30: exception specifications
    for (const spec of ctx.nodesOf('throw_specifier')) {
      const compact = ctx.src(spec).replace(/\s+/g, '');
      const fixes: Fix[] = [];
      if (compact === 'throw()') fixes.push(ctx.fix(t('Replace with noexcept'), [ctx.replace(spec, 'noexcept')]));
      else fixes.push(ctx.fix(t('Remove the exception specification'), [ctx.replaceRange(spec.startIndex - (ctx.slice(spec.startIndex - 1, spec.startIndex) === ' ' ? 1 : 0), spec.endIndex, '')]));
      ctx.report({ ruleId: 'E.30', node: spec, message: t("Don't use exception specifications; use noexcept."), fixes });
    }
  },
};

function isInTryBody(tr: Node): boolean {
  for (let p: Node | null = tr.parent, child: Node = tr; p; child = p, p = p.parent) {
    if (p.type === 'try_statement') return field(p, 'body')?.id === child.id;
    if (p.type === 'function_definition' || p.type === 'lambda_expression') return false;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Con.2 / Con.3 / Con.4 / Con.5  const and constexpr
// ---------------------------------------------------------------------------------------------
const READ_PARENTS = new Set(['binary_expression', 'return_statement', 'condition_clause', 'conditional_expression', 'subscript_argument_list', 'parenthesized_expression']);

/** True when every use of `v` is provably a read (so the variable could be const). */
function onlyRead(ctx: Context, v: VarInfo, scope: Node): boolean {
  const uses = identifierUses(scope, v.name).filter((u) => u.id !== v.nameNode.id);
  if (uses.length === 0) return false;
  return uses.every((u) => {
    let n = u;
    let p = n.parent;
    while (p?.type === 'parenthesized_expression') {
      n = p;
      p = p.parent;
    }
    if (!p) return false;
    if (p.type === 'binary_expression') return true;
    if (p.type === 'assignment_expression') return field(p, 'right')?.id === n.id && p.child(1)?.text === '='; // `y = x` reads x
    if (p.type === 'init_declarator') return field(p, 'value')?.id === n.id && !shapeOf(p).reference && !shapeOf(p).rvalueReference;
    if (p.type === 'unary_expression') return !/^[&]/.test(p.text);
    if (p.type === 'return_statement' || p.type === 'condition_clause' || p.type === 'conditional_expression') return READ_PARENTS.has(p.type);
    if (p.type === 'subscript_argument_list') return true;
    if (p.type === 'for_statement') return field(p, 'condition')?.id === n.id;
    if (p.type === 'subscript_expression') {
      // `p[i]` where the variable is the base: a read when the result is not assigned
      const sub = p;
      const gp = sub.parent;
      if (gp?.type === 'assignment_expression' && field(gp, 'left')?.id === sub.id) return v.pointer && !v.array;
      if (gp?.type === 'update_expression') return v.pointer && !v.array;
      return !!gp && READ_PARENTS.has(gp.type);
    }
    if (p.type === 'pointer_expression' && p.text.startsWith('*')) {
      const gp = p.parent;
      if (gp?.type === 'assignment_expression' && field(gp, 'left')?.id === p.id) return v.pointer;
      if (gp?.type === 'update_expression') return v.pointer;
      return !!gp && READ_PARENTS.has(gp.type);
    }
    return false;
  });
}

const BUILTIN_VALUE = /^(?:bool|char|signed char|unsigned char|short|unsigned short|int|unsigned|unsigned int|long|unsigned long|long long|unsigned long long|float|double|long double|(?:std::)?(?:size_t|ptrdiff_t|u?int(?:8|16|32|64)_t))$/;

function isLiteralExpression(n: Node | null): boolean {
  if (!n) return false;
  switch (n.type) {
    case 'number_literal':
    case 'char_literal':
    case 'string_literal':
    case 'concatenated_string':
    case 'true':
    case 'false':
    case 'null':
      return true;
    case 'parenthesized_expression':
    case 'unary_expression':
    case 'binary_expression':
    case 'conditional_expression':
      return namedKids(n).filter((k) => k.type !== 'comment').every((k) => isLiteralExpression(k) || k.type === 'binary_operator');
    case 'sizeof_expression':
      return true;
    default:
      return false;
  }
}

const constCheck: Check = {
  name: 'Con.4 const objects',
  covers: ['Con.4', 'Con.5', 'Con.3', 'Con.2'],
  run(ctx) {
    // Con.4 / Con.1 / ES.25 / P.10: unmodified locals
    for (const v of ctx.symbols.vars) {
      if (v.kind === 'local' && v.declNode.type === 'declaration' && v.initializer && !v.isConst && !v.isConstexpr && !v.isStatic && !v.reference && !v.rvalueReference && !v.array) {
        const decl = v.declNode;
        if (decl.parent?.type === 'for_statement' || decl.childrenForFieldName('declarator').length !== 1) continue;
        const typeNode = v.typeNode;
        const builtin = typeNode && (['primitive_type', 'sized_type_specifier'].includes(typeNode.type) || BUILTIN_VALUE.test(normalizeType(v.typeText)) || v.isAuto && isLiteralExpression(v.initializer));
        if (!builtin && !v.pointer) continue;
        const fn = ancestor(decl, 'function_definition', 'lambda_expression');
        if (!fn) continue;
        // for scalars the name must not be captured by reference or have its address taken: `onlyRead` covers both
        if (!onlyRead(ctx, v, v.scope)) continue;
        const fixes: Fix[] = [];
        if (!v.pointer) fixes.push(ctx.fix(t('Make it const'), [ctx.insertAt(decl.startIndex, 'const ')]));
        else {
          const star = ctx.src(v.declarator).indexOf(v.name);
          fixes.push(ctx.fix(t('Make the pointer const'), [ctx.insertAt(v.declarator.startIndex + star, 'const ')]));
        }
        ctx.report({
          ruleId: 'Con.4',
          alsoCovers: ['Con.1', 'ES.25', 'P.10'],
          node: v.nameNode,
          message: t('"{0}" is never modified: declare it const.', v.name),
          fixes,
        });
      }
    }

    // Con.5: const with a constant-expression initializer -> constexpr
    for (const v of ctx.symbols.vars) {
      if (v.declNode.type !== 'declaration' || v.isConstexpr || !v.isConst || v.reference || v.array || !v.initializer) continue;
      if (v.kind === 'param') continue;
      const type = v.typeNode;
      if (!type || !(['primitive_type', 'sized_type_specifier'].includes(type.type) || BUILTIN_VALUE.test(normalizeType(v.typeText)))) continue;
      if (v.pointer && !v.pointeeConst) continue;
      if (!isLiteralExpression(v.initializer)) continue;
      const constNode = kids(v.declNode).find((k) => k.type === 'type_qualifier' && k.text === 'const');
      ctx.report({
        ruleId: 'Con.5',
        node: v.nameNode,
        message: t('"{0}" has a constant-expression initializer: declare it constexpr.', v.name),
        fixes: constNode ? [ctx.fix(t('Use constexpr'), [ctx.replace(constNode, 'constexpr')])] : [],
      });
    }

    // Con.3: references / pointers to non-const that are only read
    for (const f of functionsOf(ctx)) {
      if (!f.body || f.node.type !== 'function_definition' || f.isVirtualSpecified) continue;
      for (const p of f.params) {
        if (p.type === 'variadic_parameter_declaration') continue;
        const type = field(p, 'type');
        if (!type || kids(p).some((k) => k.type === 'type_qualifier' && k.text === 'const')) continue;
        if (!(['primitive_type', 'sized_type_specifier'].includes(type.type) || BUILTIN_VALUE.test(normalizeType(ctx.src(type))))) continue;
        const shape = shapeOf(field(p, 'declarator'));
        if (!shape.nameNode || !(shape.reference || shape.pointer) || shape.rvalueReference || shape.array) continue;
        const v = ctx.symbols.all(shape.nameNode.text).find((x) => x.nameNode.id === shape.nameNode!.id);
        if (!v) continue;
        if (!onlyRead(ctx, v, f.body)) continue;
        ctx.report({
          ruleId: 'Con.3',
          node: p,
          message: t('"{0}" is never modified: pass it by pointer/reference to const.', shape.nameNode.text),
          fixes: [ctx.fix(t('Add const'), [ctx.insertAt(p.startIndex, 'const ')], 'unsafe')],
        });
      }
    }

    // Con.2: member functions that only read
    for (const c of classesOf(ctx)) {
      const memberNames = new Set(c.fields.flatMap((f) => f.names.map((n) => n.text)));
      const funcNames = new Set(c.functions.map((m) => m.info.name));
      for (const m of c.functions) {
        const f = m.info;
        if (!f.body || f.node.type !== 'function_definition' || f.isConst || f.isStatic || f.isConstructor || f.isDestructor || f.isOperator || m.isVirtual || m.isOverride) continue;
        if (f.returnsReference || f.returnsPointer) continue;
        if (f.body.descendantsOfType('this').length > 0) continue;
        const usedMembers = [...new Set(f.body.descendantsOfType('identifier').filter((n): n is Node => !!n && memberNames.has(n.text) && ctx.symbols.resolve(n.text, n)?.kind === 'member').map((n) => n.text))];
        const callsOwn = f.body.descendantsOfType('call_expression').some((call) => call && field(call, 'function')?.type === 'identifier' && funcNames.has(field(call, 'function')!.text));
        if (callsOwn || usedMembers.length === 0) continue;
        const reads = usedMembers.every((name) => {
          const mv = ctx.symbols.all(name).find((x) => x.kind === 'member' && ctx.symbols.classNameOfMember(x) === c.name);
          return !!mv && !mv.reference && onlyRead(ctx, mv, f.body!) && (mv.pointer || BUILTIN_VALUE.test(normalizeType(mv.typeText)));
        });
        if (!reads) continue;
        const after = kids(f.declarator).filter((k) => k.type === 'noexcept' || k.type === 'ref_qualifier' || k.type === 'virtual_specifier' || k.type === 'trailing_return_type' || k.type === 'requires_clause')[0];
        const at = after ? after.startIndex : (field(f.declarator, 'parameters')?.endIndex ?? f.declarator.endIndex);
        const edit: TextEdit = ctx.insertAt(at, after ? 'const ' : ' const');
        ctx.report({
          ruleId: 'Con.2',
          node: f.nameNode,
          message: t('"{0}" does not modify the object: make it a const member function.', f.name),
          fixes: [ctx.fix(t('Add const'), [edit], 'unsafe')],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CPL.1  Prefer C++ to C (C library headers)
// ---------------------------------------------------------------------------------------------
const C_HEADERS = ['assert', 'ctype', 'errno', 'fenv', 'float', 'inttypes', 'limits', 'locale', 'math', 'setjmp', 'signal', 'stdarg', 'stddef', 'stdint', 'stdio', 'stdlib', 'string', 'time', 'uchar', 'wchar', 'wctype'];

const cHeaderCheck: Check = {
  name: 'CPL.1 C headers',
  covers: ['CPL.1'],
  run(ctx) {
    for (const inc of ctx.nodesOf('preproc_include')) {
      const path = field(inc, 'path');
      const m = path ? /^[<"]([a-z]+)\.h[>"]$/.exec(path.text) : null;
      if (!m || !C_HEADERS.includes(m[1])) continue;
      ctx.report({
        ruleId: 'CPL.1',
        node: path!,
        message: t('Prefer the C++ header <c{0}> to the C header <{0}.h>.', m[1]),
        fixes: [ctx.fix(t('Use <c{0}>', m[1]), [ctx.replace(path!, `<c${m[1]}>`)], 'unsafe')],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// P.2  Write in ISO Standard C++
// ---------------------------------------------------------------------------------------------
const EXTENSION_IDENT = /^(?:__attribute__|__declspec|__asm__?|__volatile__|__extension__|__typeof__|__typeof|typeof|__int128|__builtin_\w+|__forceinline|__inline__?|__restrict(?:__)?|__cdecl|__stdcall|__fastcall)$/;
const ATTRIBUTE_MAP: Record<string, string> = { noreturn: '[[noreturn]]', deprecated: '[[deprecated]]', unused: '[[maybe_unused]]', fallthrough: '[[fallthrough]]', warn_unused_result: '[[nodiscard]]', always_inline: '', noinline: '' };

const standardCppCheck: Check = {
  name: 'P.2 ISO C++',
  covers: ['P.2'],
  run(ctx) {
    for (const id of ctx.nodesOf('identifier', 'type_identifier', 'primitive_type', 'field_identifier')) {
      if (!EXTENSION_IDENT.test(id.text)) continue;
      if (id.parent?.type === 'preproc_def' || id.parent?.type === 'preproc_function_def') continue;
      const fixes: Fix[] = [];
      if (id.text === '__attribute__') {
        const call = id.parent;
        const args = call?.type === 'call_expression' ? field(call, 'arguments') : null;
        const m = args ? /^\(\(\s*(\w+)\s*\)\)$/.exec(ctx.src(args).replace(/\s+/g, ' ')) : null;
        const mapped = m ? ATTRIBUTE_MAP[m[1].replace(/^__|__$/g, '')] : undefined;
        if (call && mapped !== undefined) fixes.push(ctx.fix(mapped ? t('Use {0}', mapped) : t('Remove the attribute'), [ctx.replace(call, mapped)], 'unsafe'));
      }
      ctx.report({
        ruleId: 'P.2',
        node: id,
        message: t('"{0}" is a compiler extension; write in ISO Standard C++.', id.text),
        fixes,
      });
    }
    for (const attr of ctx.nodesOf('attribute_specifier', 'ms_declspec_modifier', 'gnu_asm_expression')) {
      ctx.report({ ruleId: 'P.2', node: attr, message: t('"{0}" is a compiler extension; write in ISO Standard C++.', ctx.src(attr).split('(')[0].trim()) });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// P.9  Don't waste time: postfix increment of class types
// ---------------------------------------------------------------------------------------------
const postfixCheck: Check = {
  name: 'P.9 postfix increment',
  covers: ['P.9'],
  run(ctx) {
    for (const e of ctx.nodesOf('update_expression')) {
      const arg = field(e, 'argument');
      if (arg?.type !== 'identifier' || !/(?:\+\+|--)$/.test(ctx.src(e))) continue;
      const parent = e.parent;
      const resultUnused = parent?.type === 'expression_statement' || (parent?.type === 'for_statement' && field(parent, 'update')?.id === e.id);
      if (!resultUnused) continue;
      const v = ctx.symbols.resolve(arg.text, arg);
      if (!v || v.pointer || v.array) continue;
      const typeText = normalizeType(v.typeText);
      const builtin = v.typeNode && ['primitive_type', 'sized_type_specifier'].includes(v.typeNode.type);
      if (builtin || BUILTIN_VALUE.test(typeText)) continue;
      let iteratorLike = /iterator|Iterator|_it\b/.test(typeText);
      if (v.isAuto && v.initializer) {
        iteratorLike = /\.(?:c?r?begin|c?r?end)\s*\(|\bstd::c?r?(?:begin|end)\s*\(|\.find\s*\(|std::find/.test(ctx.src(v.initializer));
      }
      if (!iteratorLike) continue;
      const op = ctx.src(e).endsWith('++') ? '++' : '--';
      ctx.report({
        ruleId: 'P.9',
        node: e,
        message: t('The result of the postfix {0} on "{1}" is unused; prefer the prefix form.', op, arg.text),
        fixes: [ctx.fix(t('Use the prefix form'), [ctx.replace(e, `${op}${arg.text}`)])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Per.11  Move computation from run time to compile time
// ---------------------------------------------------------------------------------------------
const constexprCandidateCheck: Check = {
  name: 'Per.11 constexpr candidates',
  covers: ['Per.11'],
  run(ctx) {
    const pure = (n: Node | null, params: Set<string>): boolean => {
      if (!n) return false;
      switch (n.type) {
        case 'identifier':
          return params.has(n.text);
        case 'number_literal':
        case 'char_literal':
        case 'true':
        case 'false':
          return true;
        case 'parenthesized_expression':
        case 'unary_expression':
        case 'binary_expression':
        case 'conditional_expression':
          return namedKids(n).filter((k) => k.type !== 'comment').every((k) => k.type === 'binary_operator' || pure(k, params));
        default:
          return false;
      }
    };
    for (const f of functionsOf(ctx)) {
      if (f.node.type !== 'function_definition' || !f.body || f.isVirtualSpecified || f.isConstructor || f.isDestructor || f.isTemplate) continue;
      if (kids(f.node).some((k) => (k.type === 'type_qualifier' && ['constexpr', 'consteval'].includes(k.text)) || (k.type === 'storage_class_specifier' && k.text === 'constexpr'))) continue;
      if (f.returnsPointer || f.returnsReference || f.name === 'main') continue;
      const rt = f.returnType ? normalizeType(ctx.src(f.returnType)) : '';
      if (!BUILTIN_VALUE.test(rt)) continue;
      const names = new Set<string>();
      let ok = true;
      for (const p of f.params) {
        const type = field(p, 'type');
        const shape = shapeOf(field(p, 'declarator'));
        if (!type || shape.pointer || shape.reference || shape.rvalueReference || !BUILTIN_VALUE.test(normalizeType(ctx.src(type)))) ok = false;
        if (shape.nameNode) names.add(shape.nameNode.text);
      }
      if (!ok) continue;
      const stmts = namedKids(f.body).filter((n) => n.type !== 'comment');
      if (stmts.length !== 1 || stmts[0].type !== 'return_statement') continue;
      const value = namedKids(stmts[0]).find((n) => n.type !== 'comment') ?? null;
      if (!pure(value, names)) continue;
      ctx.report({
        ruleId: 'Per.11',
        node: f.nameNode,
        message: t('"{0}" can be evaluated at compile time: declare it constexpr.', f.name),
        fixes: [ctx.fix(t('Add constexpr'), [ctx.insertAt(f.node.startIndex, 'constexpr ')])],
      });
    }
  },
};

export const m1Checks: Check[] = [
  globalsCheck,
  singletonCheck,
  interfaceTypesCheck,
  errorHandlingCheck,
  constCheck,
  cHeaderCheck,
  standardCppCheck,
  postfixCheck,
  constexprCandidateCheck,
];
