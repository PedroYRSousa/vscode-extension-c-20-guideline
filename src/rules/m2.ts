import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { functionsOf } from './funcs.js';
import { calleeName, callArgs, isCallTo, normalizeType } from './util.js';

export const STD_HEADERS = new Set(
  ('algorithm any array atomic barrier bit bitset charconv chrono codecvt compare complex concepts condition_variable coroutine deque exception execution expected filesystem format ' +
    'forward_list fstream functional future generator initializer_list iomanip ios iosfwd iostream istream iterator latch limits list locale map mdspan memory memory_resource mutex new ' +
    'numbers numeric optional ostream print queue random ranges ratio regex scoped_allocator semaphore set shared_mutex source_location span spanstream sstream stack stacktrace stdexcept ' +
    'stdfloat stop_token streambuf string string_view syncstream system_error text_encoding thread tuple type_traits typeindex typeinfo unordered_map unordered_set utility valarray variant ' +
    'vector version cassert cctype cerrno cfenv cfloat cinttypes climits clocale cmath csetjmp csignal cstdarg cstddef cstdint cstdio cstdlib cstring ctime cuchar cwchar cwctype').split(' '),
);

/** Top-level items with `#ifndef`/`#if` blocks flattened (their bodies are part of the file). */
function* topLevel(node: Node): Generator<Node> {
  for (const c of namedKids(node)) {
    if (c.type === 'preproc_ifdef' || c.type === 'preproc_if' || c.type === 'preproc_else' || c.type === 'preproc_elif' || c.type === 'preproc_elifdef') {
      yield* topLevel(c);
    } else yield c;
  }
}

const isDirective = (n: Node): boolean => n.type.startsWith('preproc_') || n.type === 'comment';

// ---------------------------------------------------------------------------------------------
// SF.1 / NL.27  File suffixes
// ---------------------------------------------------------------------------------------------
const suffixCheck: Check = {
  name: 'NL.27 file suffixes',
  covers: ['NL.27'],
  run(ctx) {
    const { sources, headers } = ctx.config.fileSuffixes;
    const ext = ctx.file.ext;
    if (!ext || ctx.file.path.startsWith('untitled:')) return;
    const known = [...sources, ...headers];
    if (known.includes(ext)) return;
    ctx.report({
      ruleId: 'NL.27',
      alsoCovers: ['SF.1'],
      start: 0,
      end: Math.min(1, ctx.text.length),
      message: t('Use a conventional file suffix ({0}); "{1}" is not one of them.', known.join(' '), ext),
    });
  },
};

// ---------------------------------------------------------------------------------------------
// SF.2 / SF.4 / SF.7 / SF.8 / SF.12 / SF.13 / SF.21  Source files
// ---------------------------------------------------------------------------------------------
function hasSpecifier(ctx: Context, decl: Node, ...names: string[]): boolean {
  return kids(decl).some((k) => (k.type === 'storage_class_specifier' || k.type === 'type_qualifier') && names.includes(k.text));
}

function isRealTemplate(tpl: Node): boolean {
  const params = field(tpl, 'parameters');
  return !!params && namedKids(params).length > 0;
}

function guardName(ctx: Context): string {
  const parts = ctx.file.path.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2);
  const joined = parts.join('_').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return `${joined || 'HEADER'}_H`;
}

function hasIncludeGuard(ctx: Context): boolean {
  const items = namedKids(ctx.root).filter((n) => n.type !== 'comment' && !(n.type === 'preproc_call' && /^#\s*pragma/.test(ctx.src(n))));
  if (items.length === 0) return true; // empty header
  const first = items[0];
  if (first.type !== 'preproc_ifdef') return false;
  if (!/^#\s*ifndef\b/.test(ctx.src(first))) return false;
  const name = field(first, 'name')?.text;
  const define = namedKids(first).find((n) => n.type === 'preproc_def');
  return !!name && field(define ?? first, 'name')?.text === name && items.length === 1;
}

const sourceFileCheck: Check = {
  name: 'SF source files',
  covers: ['SF.2', 'SF.4', 'SF.7', 'SF.8', 'SF.12', 'SF.13', 'SF.21'],
  run(ctx) {
    const header = ctx.file.isHeader || ctx.config.fileSuffixes.headers.includes(ctx.file.ext);

    // SF.4: includes first
    let firstCode: Node | null = null;
    for (const item of topLevel(ctx.root)) {
      if (!isDirective(item) && item.type !== 'comment') {
        firstCode = item;
        break;
      }
    }
    if (firstCode) {
      for (const inc of ctx.nodesOf('preproc_include')) {
        if (inc.startIndex < firstCode.startIndex) continue;
        if (ancestor(inc, 'namespace_definition', 'class_specifier', 'struct_specifier', 'function_definition', 'linkage_specification', 'declaration_list', 'field_declaration_list')) continue;
        ctx.report({ ruleId: 'SF.4', node: inc, message: t('Include header files before other declarations in a file.') });
      }
    }

    // SF.12 / SF.13: spelling of the include identifier
    for (const inc of ctx.nodesOf('preproc_include')) {
      const path = field(inc, 'path');
      if (!path) continue;
      const text = path.text;
      const quoted = text.startsWith('"');
      const inner = text.slice(1, -1);
      if (inner.includes('\\')) {
        ctx.report({
          ruleId: 'SF.13',
          node: path,
          message: t('Use / as the path delimiter in #include.'),
          fixes: [ctx.fix(t('Use forward slashes'), [ctx.replace(path, text.replace(/\\/g, '/'))])],
        });
      }
      const lower = inner.toLowerCase();
      if (STD_HEADERS.has(lower) && inner !== lower) {
        ctx.report({
          ruleId: 'SF.13',
          node: path,
          message: t('The standard library header is <{0}>, not <{1}>.', lower, inner),
          fixes: [ctx.fix(t('Fix the header name'), [ctx.replace(path, `<${lower}>`)])],
        });
      } else if (quoted && STD_HEADERS.has(inner)) {
        ctx.report({
          ruleId: 'SF.12',
          node: path,
          message: t('Include the standard header <{0}> with angle brackets.', inner),
          fixes: [ctx.fix(t('Use <{0}>', inner), [ctx.replace(path, `<${inner}>`)])],
        });
      }
    }

    if (!header) return;

    // SF.8: include guards (and `#pragma once` is not one)
    if (!hasIncludeGuard(ctx)) {
      const name = guardName(ctx);
      const eol = ctx.eol;
      const edits: TextEdit[] = [];
      const pragma = namedKids(ctx.root).find((n) => n.type === 'preproc_call' && /^#\s*pragma\s+once/.test(ctx.src(n)));
      const guardOpen = `#ifndef ${name}${eol}#define ${name}${eol}`;
      if (pragma) edits.push(ctx.replaceRange(pragma.startIndex, pragma.endIndex, guardOpen));
      else edits.push(ctx.insertAt(ctx.preambleEnd(), `${guardOpen}${eol}`));
      const tail = ctx.text.endsWith('\n') ? '' : eol;
      edits.push(ctx.insertAt(ctx.text.length, `${tail}${eol}#endif  // ${name}${eol}`));
      ctx.report({
        ruleId: 'SF.8',
        start: 0,
        end: Math.min(1, ctx.text.length),
        message: pragma
          ? t('Use #include guards for all header files; #pragma once is not standard.')
          : t('Use #include guards for all header files.'),
        fixes: [ctx.fix(t('Add an #include guard ({0})', name), edits)],
      });
    }

    // SF.7: using namespace at global scope in a header
    for (const u of ctx.nodesOf('using_declaration')) {
      if (!/^using\s+namespace\b/.test(ctx.src(u))) continue;
      const p = u.parent;
      const global = p?.type === 'translation_unit' || (p && p.type.startsWith('preproc_') && !ancestor(u, 'namespace_definition', 'function_definition', 'class_specifier', 'struct_specifier', 'linkage_specification'));
      if (global) ctx.report({ ruleId: 'SF.7', node: u, message: t("Don't write using namespace at global scope in a header file.") });
    }

    // SF.21: unnamed namespace in a header
    for (const ns of ctx.nodesOf('namespace_definition')) {
      if (!field(ns, 'name') && !kids(ns).some((k) => k.type === 'nested_namespace_specifier')) {
        ctx.report({ ruleId: 'SF.21', node: ns, start: ns.startIndex, end: ns.startIndex + 9, message: t("Don't use an unnamed (anonymous) namespace in a header.") });
      }
    }

    // SF.2: only declarations and inline definitions in headers
    const check = (scope: Node): void => {
      for (const item of topLevel(scope)) {
        if (item.type === 'namespace_definition') {
          const body = field(item, 'body');
          if (body) check(body);
          continue;
        }
        if (item.type === 'linkage_specification') {
          const body = field(item, 'body');
          if (body) check(body);
          continue;
        }
        let target = item;
        let templated = false;
        if (item.type === 'template_declaration') {
          templated = isRealTemplate(item);
          target = namedKids(item).find((k) => k.type !== 'template_parameter_list' && k.type !== 'requires_clause' && k.type !== 'comment') ?? item;
        }
        if (templated) continue;
        if (target.type === 'function_definition') {
          if (hasSpecifier(ctx, target, 'inline', 'constexpr', 'consteval')) continue;
          const nameNode = shapeOf(field(target, 'declarator')).nameNode;
          ctx.report({
            ruleId: 'SF.2',
            node: nameNode ?? target,
            message: t('A header file must not contain non-inline function definitions.'),
            fixes: [ctx.fix(t('Declare it inline'), [ctx.insertAt(target.startIndex, 'inline ')])],
          });
        } else if (target.type === 'declaration') {
          const declarators = target.childrenForFieldName('declarator').filter((n): n is Node => n !== null);
          if (declarators.length === 0 || kids(target).some((k) => k.type === 'storage_class_specifier' && k.text === 'typedef')) continue;
          if (declarators.some((d) => shapeOf(d).isFunction)) continue;
          if (hasSpecifier(ctx, target, 'inline', 'constexpr', 'consteval')) continue;
          const isExternDecl = hasSpecifier(ctx, target, 'extern') && declarators.every((d) => d.type !== 'init_declarator');
          if (isExternDecl) continue;
          const shape = shapeOf(declarators[0]);
          const constObject = hasSpecifier(ctx, target, 'const') && !shape.pointer ? true : shape.topConst;
          if (constObject && shape.nameNode) continue;
          ctx.report({
            ruleId: 'SF.2',
            node: shape.nameNode ?? target,
            message: t('A header file must not contain object definitions.'),
            fixes: [ctx.fix(t('Declare it inline (C++17)'), [ctx.insertAt(target.startIndex, 'inline ')], 'unsafe')],
          });
        }
      }
    };
    check(ctx.root);
  },
};

// ---------------------------------------------------------------------------------------------
// SL.3 / SL.C.1 / SL.con.1 / SL.con.2 / SL.str.3 / SL.str.4 / SL.io.3 / SL.io.50
// ---------------------------------------------------------------------------------------------
const STL_CONTAINER = /^(?:const\s+)?std::(?:vector|array|deque|list|forward_list|map|multimap|set|multiset|unordered_map|unordered_set|unordered_multimap|unordered_multiset|string|span)\b/;

/** printf format → std::format string; null when a conversion is unsupported. */
export function convertPrintfFormat(literal: string): { format: string; count: number } | null {
  const prefix = literal.match(/^(?:u8|u|U|L)?"/)?.[0];
  if (!prefix || prefix.length > 1) return null;
  const body = literal.slice(1, -1);
  let out = '';
  let count = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      out += ch + (body[++i] ?? '');
      continue;
    }
    if (ch === '{' || ch === '}') {
      out += ch + ch;
      continue;
    }
    if (ch !== '%') {
      out += ch;
      continue;
    }
    const m = /^%([-+ 0#]*)(\d+)?(?:\.(\d+))?(hh|h|ll|l|z|j|t|L)?([diuoxXfFeEgGcsp%])/.exec(body.slice(i));
    if (!m) return null;
    const [whole, flags, width, precision, , conv] = m;
    i += whole.length - 1;
    if (conv === '%') {
      out += '%';
      continue;
    }
    if (conv === 'p') return null;
    if (flags.includes('#') || flags.includes(' ') || flags.includes('+') && !'diufFeEgG'.includes(conv)) return null;
    let spec = '';
    if (flags.includes('-')) spec += '<';
    if (flags.includes('+')) spec += '+';
    if (flags.includes('0') && !flags.includes('-')) spec += '0';
    if (width) spec += width;
    if (precision !== undefined) spec += `.${precision}`;
    const typeChar = 'dioufFeEgGxX'.includes(conv) ? ({ i: 'd', u: 'd', d: 'd', o: 'o', x: 'x', X: 'X', f: 'f', F: 'F', e: 'e', E: 'E', g: 'g', G: 'G' } as Record<string, string>)[conv] : '';
    if (conv === 'd' || conv === 'i' || conv === 'u') spec += ''; // default integer formatting
    else if (typeChar) spec += typeChar;
    out += spec ? `{:${spec}}` : '{}';
    count++;
  }
  return { format: `"${out}"`, count };
}

const PRINTF_FAMILY = new Set(['printf', 'fprintf', 'sprintf', 'snprintf', 'puts', 'fputs', 'putchar', 'scanf', 'fscanf', 'sscanf', 'vprintf', 'vfprintf', 'gets']);

const stdlibCheck: Check = {
  name: 'SL standard library',
  covers: ['SL.3', 'SL.C.1', 'SL.con.1', 'SL.con.2', 'SL.str.3', 'SL.io.3', 'SL.io.50'],
  run(ctx) {
    // SL.3
    for (const ns of ctx.nodesOf('namespace_definition')) {
      if (field(ns, 'name')?.text !== 'std') continue;
      const body = field(ns, 'body');
      if (!body) continue;
      const additions = namedKids(body).filter((c) => c.type !== 'comment' && !(c.type === 'template_declaration' && !isRealTemplate(c)) && !(c.type === 'template_declaration' && /^template\s*<[^>]*>\s*(?:struct|class)\s+\w+\s*<[^>]*>/.test(ctx.src(c))));
      if (additions.length > 0) {
        ctx.report({ ruleId: 'SL.3', node: ns, start: ns.startIndex, end: ns.startIndex + 'namespace std'.length, message: t('Do not add non-standard entities to namespace std.') });
      }
    }

    // SL.C.1
    for (const id of ctx.nodesOf('identifier')) {
      if ((id.text === 'setjmp' || id.text === 'longjmp') && id.parent?.type === 'call_expression') {
        ctx.report({ ruleId: 'SL.C.1', node: id, message: t("Don't use setjmp/longjmp; use exceptions or RAII.") });
      }
    }

    // SL.con.1: C arrays next to STL containers
    const hasContainer = (scope: Node): boolean => ctx.symbols.vars.some((v) => STL_CONTAINER.test(v.typeText) && v.scope.startIndex >= scope.startIndex && v.scope.endIndex <= scope.endIndex) || scope.descendantsOfType('field_declaration').some((f) => f && STL_CONTAINER.test(field(f, 'type') ? ctx.src(field(f, 'type')!) : ''));
    for (const v of ctx.symbols.vars) {
      if (!v.array || v.reference || v.kind === 'param') continue;
      const scope = ancestor(v.declNode, 'function_definition', 'class_specifier', 'struct_specifier');
      if (!scope || !hasContainer(scope)) continue;
      const arrays = v.declarator.type === 'array_declarator' ? [v.declarator] : v.declarator.descendantsOfType('array_declarator').filter((n): n is Node => n !== null);
      const size = arrays.length === 1 ? field(arrays[0], 'size') : null;
      const fixes: Fix[] = [];
      if (size && v.typeNode && !v.pointer && v.declNode.childrenForFieldName('declarator').length === 1) {
        const quals = kids(v.declNode).filter((k) => k.type === 'type_qualifier' || k.type === 'storage_class_specifier').map((k) => k.text).join(' ');
        const init = v.initializer ? ` = ${ctx.src(v.initializer)}` : '';
        fixes.push(
          ctx.fix(t('Use std::array'), [
            ctx.replace(v.declNode, `${quals ? quals + ' ' : ''}std::array<${ctx.src(v.typeNode)}, ${ctx.src(size)}> ${v.name}${init};`),
            ...ctx.includeEdits('array'),
          ], 'unsafe'),
        );
      }
      ctx.report({
        ruleId: 'SL.con.1',
        alsoCovers: ['ES.27'],
        node: v.nameNode,
        message: t('Prefer std::array or std::vector to the C array "{0}".', v.name),
        fixes,
      });
    }

    // SL.con.2: vector whose size never changes
    for (const v of ctx.symbols.vars) {
      if (v.pointer || v.reference || !/^(?:const\s+)?std::vector\s*</.test(v.typeText) || !v.isConst) continue;
      const init = v.initializer;
      if (!init || init.type !== 'initializer_list') continue;
      const count = namedKids(init).filter((n) => n.type !== 'comment').length;
      if (count === 0) continue;
      const typeArg = /std::vector\s*<(.*)>\s*$/s.exec(v.typeText)?.[1]?.trim();
      const fixes: Fix[] = [];
      if (v.typeNode && typeArg && !typeArg.includes(',') && v.declNode.childrenForFieldName('declarator').length === 1) {
        fixes.push(ctx.fix(t('Use std::array'), [ctx.replace(v.typeNode, `std::array<${typeArg}, ${count}>`), ...ctx.includeEdits('array')], 'unsafe'));
      }
      ctx.report({
        ruleId: 'SL.con.2',
        node: v.nameNode,
        message: t('"{0}" never changes size: use std::array instead of std::vector.', v.name),
        fixes,
      });
    }

    // SL.str.3 / SL.str.4: char* misuse
    for (const e of ctx.nodesOf('subscript_expression')) {
      const base = field(e, 'argument');
      if (base?.type !== 'identifier') continue;
      const v = ctx.symbols.resolve(base.text, base);
      if (v && v.pointer && !v.array && normalizeType(v.typeText) === 'char') {
        ctx.report({ ruleId: 'SL.str.3', alsoCovers: ['SL.str.4'], node: e, message: t('Do not index a char*; use std::string, std::string_view or std::span.') });
      }
    }
    for (const d of ctx.nodesOf('delete_expression')) {
      const arg = namedKids(d).find((n) => n.type !== 'comment');
      const v = arg?.type === 'identifier' ? ctx.symbols.resolve(arg.text, arg) : undefined;
      if (v && v.pointer && /^(?:const\s+)?char$/.test(normalizeType(v.typeText))) {
        ctx.report({ ruleId: 'SL.str.3', node: d, message: t('Do not delete a char*; own character data with std::string.') });
      }
    }

    // SL.io.3: C stdio
    for (const inc of ctx.nodesOf('preproc_include')) {
      const p = field(inc, 'path')?.text ?? '';
      if (/^[<"](?:cstdio|stdio\.h)[>"]$/.test(p)) {
        ctx.report({ ruleId: 'SL.io.3', node: inc, message: t('Prefer iostreams (and std::format) for I/O to <cstdio>.') });
      }
    }
    for (const call of ctx.nodesOf('call_expression')) {
      if (!isCallTo(call, ...PRINTF_FAMILY)) continue;
      const fn = field(call, 'function')!;
      const name = calleeName(fn);
      if (fn.type === 'qualified_identifier' && field(fn, 'scope')?.text !== 'std') continue;
      const args = callArgs(call);
      const fixes: Fix[] = [];
      const stmt = call.parent;
      if ((name === 'printf' || name === 'fprintf') && stmt?.type === 'expression_statement') {
        const streamArg = name === 'fprintf' ? args[0] : null;
        const fmtIndex = name === 'fprintf' ? 1 : 0;
        const fmt = args[fmtIndex];
        const stream = name === 'printf' ? 'std::cout' : streamArg?.text === 'stderr' ? 'std::cerr' : streamArg?.text === 'stdout' ? 'std::cout' : null;
        if (stream && fmt?.type === 'string_literal') {
          const conv = convertPrintfFormat(fmt.text);
          const rest = args.slice(fmtIndex + 1);
          if (conv && conv.count === rest.length) {
            const text = `${stream} << std::format(${[conv.format, ...rest.map((a) => ctx.src(a))].join(', ')})`;
            fixes.push(ctx.fix(t('Use std::format with iostreams'), [ctx.replace(call, text), ...ctx.includeEdits('format'), ...ctx.includeEdits('iostream')], 'unsafe'));
          }
        }
      } else if (name === 'puts' && stmt?.type === 'expression_statement' && args.length === 1 && args[0].type === 'string_literal' && /^"/.test(args[0].text)) {
        fixes.push(ctx.fix(t('Use std::cout'), [ctx.replace(call, `std::cout << ${args[0].text.slice(0, -1)}\\n"`), ...ctx.includeEdits('iostream')], 'unsafe'));
      }
      ctx.report({
        ruleId: 'SL.io.3',
        node: fn,
        message: t('Prefer iostreams and std::format to {0}().', name),
        fixes,
      });
    }

    // SL.io.50: avoid endl
    for (const id of ctx.nodesOf('identifier')) {
      if (id.text !== 'endl') continue;
      const q = id.parent?.type === 'qualified_identifier' ? id.parent : null;
      if (q && field(q, 'scope')?.text !== 'std') continue;
      const node = q ?? id;
      const op = node.parent;
      const fixes: Fix[] = [];
      if (op?.type === 'binary_expression' && field(op, 'right')?.id === node.id && field(op, 'operator')?.text === '<<') {
        fixes.push(ctx.fix(t("Use '\\n' (does not flush)"), [ctx.replace(node, "'\\n'")], 'unsafe'));
      }
      ctx.report({ ruleId: 'SL.io.50', node, message: t('Avoid endl: it flushes the stream; use \'\\n\'.'), fixes });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// CP.20 / CP.21 / CP.25 / CP.26 / CP.42 / CP.51 / CP.52 / CP.53 / CP.200
// ---------------------------------------------------------------------------------------------
const MUTEX_TYPE = /(?:^|::)(?:recursive_|timed_|recursive_timed_|shared_|shared_timed_)?mutex\b/;
const LOCK_GUARD_TYPE = /(?:^|::)(?:lock_guard|unique_lock)\b/;

/** True when `body` itself (not a nested lambda) contains co_await / co_yield / co_return. */
function isCoroutine(body: Node | null): boolean {
  if (!body) return false;
  return body.descendantsOfType(['co_await_expression', 'co_yield_expression', 'co_return_statement']).some((n) => {
    if (!n) return false;
    const owner = ancestor(n, 'lambda_expression', 'function_definition');
    return owner !== null && owner.id === body.parent?.id;
  });
}

const concurrencyCheck: Check = {
  name: 'CP concurrency',
  covers: ['CP.20', 'CP.21', 'CP.25', 'CP.26', 'CP.42', 'CP.51', 'CP.52', 'CP.53', 'CP.200'],
  run(ctx) {
    // CP.20 / CP.26 / CP.42: member calls
    for (const call of ctx.nodesOf('call_expression')) {
      const fn = field(call, 'function');
      if (fn?.type !== 'field_expression') continue;
      const method = field(fn, 'field')?.text;
      const recv = field(fn, 'argument');
      const args = callArgs(call);
      const resolved = recv?.type === 'identifier' ? ctx.symbols.resolve(recv.text, recv) : undefined;
      const typeText = resolved?.typeText ?? '';
      if ((method === 'lock' || method === 'unlock') && args.length === 0 && !/weak_ptr/.test(typeText)) {
        ctx.report({ ruleId: 'CP.20', node: call, message: t('Use RAII (lock_guard / scoped_lock), never plain lock()/unlock().') });
      }
      if (method === 'detach' && args.length === 0 && !/weak_ptr/.test(typeText)) {
        ctx.report({ ruleId: 'CP.26', node: call, message: t("Don't detach() a thread; join it (std::jthread does so automatically).") });
      }
      if (method === 'wait' && args.length === 1 && /condition_variable/.test(typeText)) {
        ctx.report({ ruleId: 'CP.42', node: call, message: t("Don't wait without a condition: pass a predicate to wait().") });
      }
    }

    // CP.25: std::thread -> std::jthread
    for (const q of ctx.nodesOf('qualified_identifier')) {
      if (q.text !== 'std::thread' || q.parent?.type === 'qualified_identifier') continue;
      const fn = ancestor(q, 'function_definition');
      const detaches = !!fn && fn.descendantsOfType('call_expression').some((c) => c && field(c, 'function')?.type === 'field_expression' && field(field(c, 'function')!, 'field')?.text === 'detach');
      const nameNode = field(q, 'name')!;
      ctx.report({
        ruleId: 'CP.25',
        node: q,
        message: t('Prefer std::jthread over std::thread: it joins automatically.'),
        fixes: detaches ? [] : [ctx.fix(t('Use std::jthread'), [ctx.replace(nameNode, 'jthread')])],
      });
    }

    // CP.21: several lock guards in a row
    for (const block of ctx.nodesOf('compound_statement')) {
      const locks = namedKids(block).filter((s) => {
        if (s.type !== 'declaration') return false;
        const type = field(s, 'type');
        return !!type && LOCK_GUARD_TYPE.test(ctx.src(type));
      });
      for (let i = 0; i + 1 < locks.length; i++) {
        const a = locks[i];
        const b = locks[i + 1];
        if (a.nextNamedSibling?.id !== b.id) continue;
        const argOf = (d: Node): string | null => {
          const decl = d.childrenForFieldName('declarator')[0];
          if (!decl) return null;
          const v = decl.type === 'init_declarator' ? field(decl, 'value') : null;
          const fd = decl.type === 'function_declarator' ? field(decl, 'parameters') : null;
          const inner = v ? ctx.src(v) : fd ? ctx.src(fd) : '';
          const m = /^[({]\s*(.*?)\s*[)}]$/s.exec(inner);
          return m ? m[1] : null;
        };
        const ma = argOf(a);
        const mb = argOf(b);
        const nameA = shapeOf(a.childrenForFieldName('declarator')[0] ?? null).nameNode?.text;
        if (ma && mb && ma !== mb && nameA) {
          ctx.report({
            ruleId: 'CP.21',
            node: b,
            message: t('Use std::scoped_lock to acquire multiple mutexes.'),
            fixes: [ctx.fix(t('Use std::scoped_lock'), [ctx.replaceRange(a.startIndex, b.endIndex, `std::scoped_lock ${nameA}(${ma}, ${mb});`), ...ctx.includeEdits('mutex')], 'unsafe')],
          });
        }
      }
    }

    // CP.51 / CP.52 / CP.53: coroutines
    for (const l of ctx.nodesOf('lambda_expression')) {
      const caps = field(l, 'captures');
      if (caps && namedKids(caps).length > 0 && isCoroutine(field(l, 'body'))) {
        ctx.report({ ruleId: 'CP.51', node: caps, message: t('Do not use capturing lambdas that are coroutines.') });
      }
    }
    for (const f of functionsOf(ctx)) {
      if (!f.body || !isCoroutine(f.body)) continue;
      for (const p of f.params) {
        const shape = shapeOf(field(p, 'declarator'));
        if (shape.reference || shape.rvalueReference) {
          ctx.report({ ruleId: 'CP.53', node: p, message: t('Parameters of coroutines should not be passed by reference.') });
        }
      }
      for (const d of f.body.descendantsOfType('declaration')) {
        if (!d) continue;
        const type = field(d, 'type');
        if (!type || !/(?:^|::)(?:lock_guard|unique_lock|scoped_lock|shared_lock)\b/.test(ctx.src(type))) continue;
        const scope = d.parent;
        if (!scope) continue;
        const awaitAfter = scope.descendantsOfType('co_await_expression').some((a) => a && a.startIndex > d.endIndex);
        if (awaitAfter) ctx.report({ ruleId: 'CP.52', node: d, message: t('Do not hold locks across suspension points (co_await).') });
      }
    }

    // CP.200 / CP.8: volatile
    for (const v of ctx.symbols.vars) {
      if (v.kind === 'param') continue;
      if (!kids(v.declNode).some((k) => k.type === 'type_qualifier' && k.text === 'volatile')) continue;
      const fixes: Fix[] = [];
      const volatileNode = kids(v.declNode).find((k) => k.type === 'type_qualifier' && k.text === 'volatile')!;
      if (v.typeNode && !v.pointer && !v.array && !v.reference && v.declNode.childrenForFieldName('declarator').length === 1 && ['primitive_type', 'sized_type_specifier'].includes(v.typeNode.type)) {
        const storage = kids(v.declNode).filter((k) => k.type === 'storage_class_specifier').map((k) => k.text).join(' ');
        const init = v.initializer ? `{${ctx.src(v.initializer)}}` : '';
        fixes.push(
          ctx.fix(t('Use std::atomic'), [
            ctx.replace(v.declNode, `${storage ? storage + ' ' : ''}std::atomic<${ctx.src(v.typeNode)}> ${v.name}${init};`),
            ...ctx.includeEdits('atomic'),
          ], 'unsafe'),
        );
      }
      ctx.report({
        ruleId: 'CP.200',
        alsoCovers: ['CP.8'],
        node: volatileNode,
        message: t('Use volatile only to talk to non-C++ memory; for shared data use std::atomic.'),
        fixes,
      });
    }
  },
};

export const m2Checks: Check[] = [suffixCheck, sourceFileCheck, stdlibCheck, concurrencyCheck];
