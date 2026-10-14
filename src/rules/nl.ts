import type { Node } from 'web-tree-sitter';
import { field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { classesOf } from './classes.js';
import { functionsOf } from './funcs.js';

// ---------------------------------------------------------------------------------------------
// shared layout helpers
// ---------------------------------------------------------------------------------------------
const widthOf = (ws: string): number => ws.replace(/\t/g, '    ').length;

function leadingWhitespace(ctx: Context, line: number): string {
  return /^[ \t]*/.exec(ctx.lineText(line))![0];
}

/** Replace the leading whitespace of `line` with `indent`. */
function reindent(ctx: Context, line: number, indent: string): TextEdit {
  const start = ctx.lineStart(line);
  return ctx.replaceRange(start, start + leadingWhitespace(ctx, line).length, indent);
}

// ---------------------------------------------------------------------------------------------
// NL.4  Maintain a consistent indentation style
// ---------------------------------------------------------------------------------------------
const indentationCheck: Check = {
  name: 'NL.4 indentation',
  covers: ['NL.4'],
  run(ctx) {
    // (1) tabs and spaces must not be mixed as indentation
    let tabLines = 0;
    let spaceLines = 0;
    for (let l = 0; l < ctx.lineCount; l++) {
      const text = ctx.lineText(l);
      if (/^\t/.test(text)) tabLines++;
      else if (/^ {2,}\S/.test(text)) spaceLines++;
    }
    const mixed = tabLines > 0 && spaceLines > 0;
    if (mixed) {
      const useTabs = tabLines >= spaceLines;
      const unit = ctx.indentUnit === '\t' ? 4 : ctx.indentUnit.length;
      const edits: TextEdit[] = [];
      let first = -1;
      for (let l = 0; l < ctx.lineCount; l++) {
        const text = ctx.lineText(l);
        const ws = /^[ \t]*/.exec(text)![0];
        if (ws.length === text.length) continue;
        const bad = useTabs ? /^ {2,}/.test(ws) && !ws.includes('\t') : ws.includes('\t');
        if (!bad) continue;
        if (first < 0) first = l;
        const columns = widthOf(ws);
        const fixed = useTabs ? '\t'.repeat(Math.floor(columns / unit)) + ' '.repeat(columns % unit) : ' '.repeat(columns);
        edits.push(reindent(ctx, l, fixed));
      }
      if (first >= 0) {
        ctx.report({
          ruleId: 'NL.4',
          start: ctx.lineStart(first),
          end: ctx.lineStart(first) + Math.max(1, leadingWhitespace(ctx, first).length),
          message: useTabs
            ? t('Mixed indentation: this file indents with tabs, but {0} line(s) use spaces (first one here).', edits.length)
            : t('Mixed indentation: this file indents with spaces, but {0} line(s) use tabs (first one here).', edits.length),
          fixes: [ctx.fix(t('Fix the indentation characters of the whole file'), edits)],
        });
      }
      return; // indentation widths are unreliable until the characters are consistent
    }

    // (2) block contents are indented consistently
    const blocks = ctx.nodesOf('compound_statement');
    const deltas = new Map<number, number>();
    const measured: Array<{ block: Node; ownerIndent: number }> = [];
    for (const b of blocks) {
      const open = b.startIndex;
      const ownerIndent = widthOf(leadingWhitespace(ctx, ctx.lineOf(open)));
      const children = namedKids(b).filter((c) => c.type !== 'comment');
      const own = children.filter((c) => ctx.startsLine(c.startIndex) && ctx.lineOf(c.startIndex) > ctx.lineOf(open));
      if (own.length === 0) continue;
      const delta = widthOf(ctx.indentAt(own[0].startIndex)) - ownerIndent;
      measured.push({ block: b, ownerIndent });
      if (delta > 0) deltas.set(delta, (deltas.get(delta) ?? 0) + 1);
    }
    if (deltas.size === 0) return;
    const unitWidth = [...deltas.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const fill = (width: number): string => (tabLines > spaceLines ? '\t'.repeat(Math.floor(width / 4)) + ' '.repeat(width % 4) : ' '.repeat(width));

    for (const { block, ownerIndent } of measured) {
      const open = block.startIndex;
      const expected = ownerIndent + unitWidth;
      for (const c of namedKids(block)) {
        if (c.type === 'comment' || c.type === 'case_statement' || !ctx.startsLine(c.startIndex) || ctx.lineOf(c.startIndex) <= ctx.lineOf(open)) continue;
        const actual = widthOf(ctx.indentAt(c.startIndex));
        if (actual === expected) continue;
        const line = ctx.lineOf(c.startIndex);
        const shift = expected - actual;
        const edits: TextEdit[] = [];
        for (let l = line; l <= ctx.lineOf(c.endIndex - 1); l++) {
          const text = ctx.lineText(l);
          if (/^\s*$/.test(text) || (l > line && /^\s*#/.test(text))) continue;
          edits.push(reindent(ctx, l, fill(Math.max(0, widthOf(leadingWhitespace(ctx, l)) + shift))));
        }
        ctx.report({
          ruleId: 'NL.4',
          start: ctx.lineStart(line),
          end: ctx.lineStart(line) + Math.max(1, leadingWhitespace(ctx, line).length),
          message: t('Inconsistent indentation: expected {0} columns, found {1}.', expected, actual),
          fixes: [ctx.fix(t('Fix the indentation'), edits)],
        });
      }
      // closing brace aligned with the line that opens the block
      const close = block.endIndex - 1;
      if (ctx.startsLine(close) && ctx.lineOf(close) > ctx.lineOf(open) && widthOf(ctx.indentAt(close)) !== ownerIndent) {
        const line = ctx.lineOf(close);
        ctx.report({
          ruleId: 'NL.4',
          start: close,
          end: close + 1,
          message: t('The closing brace is not aligned with the line that opens the block.'),
          fixes: [ctx.fix(t('Fix the indentation'), [reindent(ctx, line, fill(ownerIndent))])],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.15  Use spaces sparingly
// ---------------------------------------------------------------------------------------------
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'alignof', 'alignas', 'decltype', 'noexcept', 'co_await', 'co_return', 'co_yield', 'throw', 'requires', 'static_assert', 'new', 'delete', 'typeid', 'operator', 'else', 'do', 'case', 'and', 'or', 'not', 'using', 'typename', 'template', 'explicit', 'consteval', 'constexpr', 'constinit', 'defined']);

const spacesCheck: Check = {
  name: 'NL.15 spaces',
  covers: ['NL.15'],
  run(ctx) {
    const tokens = ctx.tokens;
    const report = (start: number, end: number, replacement: string, message: string): void => {
      ctx.report({
        ruleId: 'NL.15',
        start,
        end: Math.max(end, start + 1),
        message,
        fixes: [ctx.fix(t('Remove the extra space'), [ctx.replaceRange(start, end, replacement)])],
      });
    };

    // #include < map >
    for (const n of ctx.nodesOf('system_lib_string')) {
      const inner = n.text.slice(1, -1);
      if (inner !== inner.trim()) report(n.startIndex, n.endIndex, `<${inner.trim()}>`, t('Use spaces sparingly: no spaces inside <> of an #include.'));
    }

    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1];
      const next = tokens[i];
      if (prev.endIndex > next.startIndex) continue;
      const gap = ctx.slice(prev.endIndex, next.startIndex);
      if (gap === '' || !/^[ \t]+$/.test(gap)) continue; // adjacent, or the tokens are on different lines
      const line = ctx.lineText(ctx.lineOf(prev.startIndex));
      if (/^\s*#/.test(line)) continue;
      if (next.type === 'comment' || prev.type === 'comment') continue;
      const nt = next.type === 'string_literal' ? 'string' : next.text;
      const pt = prev.text;
      const start = prev.endIndex;
      const end = next.startIndex;

      if (nt === ';' || nt === ',') {
        report(start, end, '', t('Use spaces sparingly: no space before "{0}".', nt));
      } else if (pt === '(' || pt === '[') {
        if (!(pt === '[' && prev.parent?.type === 'lambda_capture_specifier')) report(start, end, '', t('Use spaces sparingly: no space after "{0}".', pt));
      } else if (nt === ')' || nt === ']') {
        report(start, end, '', t('Use spaces sparingly: no space before "{0}".', nt));
      } else if (nt === '[' && ['identifier', 'field_identifier', ']', ')'].includes(prev.type) && next.parent?.type !== 'lambda_capture_specifier' && next.parent?.type !== 'attribute_declaration') {
        report(start, end, '', t('Use spaces sparingly: no space before "[".'));
      } else if (nt === '(' && ['identifier', 'field_identifier', 'type_identifier'].includes(prev.type) && !CONTROL_KEYWORDS.has(pt) && next.parent && ['argument_list', 'parameter_list'].includes(next.parent.type)) {
        report(start, end, '', t('Use spaces sparingly: no space between a function name and "(".'));
      } else if (gap.length >= 2 || gap.includes('\t')) {
        // alignment spaces before a trailing comment are tolerated (handled above); everything else is "too much space"
        report(start, end, ' ', t('Use spaces sparingly: use a single space.'));
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.17  K&R-derived layout
// ---------------------------------------------------------------------------------------------
function blockExpansion(ctx: Context, block: Node, indent: string): string | null {
  const items = namedKids(block);
  if (items.some((c) => c.type === 'comment')) return null;
  if (ctx.slice(block.startIndex, block.endIndex).includes('\n')) return null;
  const unit = ctx.indentUnit;
  const eol = ctx.eol;
  const body = items.map((c) => `${eol}${indent}${unit}${ctx.src(c)}`).join('');
  return `{${body}${eol}${indent}}`;
}

const knrCheck: Check = {
  name: 'NL.17 K&R layout',
  covers: ['NL.17'],
  run(ctx) {
    const report = (node: Node | { start: number; end: number }, message: string, fixes: Fix[] = []): void => {
      const range = 'start' in node ? node : { start: node.startIndex, end: node.endIndex };
      ctx.report({ ruleId: 'NL.17', start: range.start, end: range.end, message, fixes });
    };
    const lineIndent = (offset: number): string => ctx.indentAt(offset);
    // text between the previous significant token and `open`
    const gapBefore = (open: Node): { start: number; end: number } => {
      let s = open.startIndex;
      while (s > 0 && /\s/.test(ctx.text[s - 1])) s--;
      return { start: s, end: open.startIndex };
    };

    // functions: the opening brace is on a line of its own
    for (const f of functionsOf(ctx)) {
      if (f.node.type !== 'function_definition' || !f.body) continue;
      if (!f.returnType && !f.isConstructor && !f.isDestructor && !f.isOperator) continue; // macro invocation such as TEST(a, b) { ... }
      const open = f.body;
      if (ctx.startsLine(open.startIndex)) {
        // brace already on its own line: single-line content after it?
        continue;
      }
      const indent = lineIndent(f.node.startIndex);
      const gap = gapBefore(open);
      const expansion = blockExpansion(ctx, open, indent);
      const multiLine = ctx.slice(open.startIndex, open.endIndex).includes('\n');
      let edits: TextEdit[] | null = null;
      if (multiLine) edits = [ctx.replaceRange(gap.start, gap.end, `${ctx.eol}${indent}`)];
      else if (expansion !== null) edits = [ctx.replaceRange(gap.start, open.endIndex, `${ctx.eol}${indent}${expansion}`)];
      report({ start: open.startIndex, end: open.startIndex + 1 }, t("The function's opening brace goes on a line of its own (K&R/Stroustrup layout)."), edits ? [ctx.fix(t('Move the brace to its own line'), edits)] : []);
    }

    // class/struct/union/enum? (class and struct only): brace on the same line as the head
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const open = c.body;
      if (ctx.startsLine(open.startIndex)) {
        const gap = gapBefore(open);
        report({ start: open.startIndex, end: open.startIndex + 1 }, t("The opening brace of a class or struct is not on a line of its own."), [
          ctx.fix(t('Move the brace to the previous line'), [ctx.replaceRange(gap.start, gap.end, ' ')]),
        ]);
      } else if (namedKids(open).length > 0 && ctx.lineOf(open.startIndex) === ctx.lineOf(namedKids(open)[0].startIndex)) {
        const expansion = blockExpansion(ctx, open, lineIndent(c.node.startIndex));
        report({ start: open.startIndex, end: open.startIndex + 1 }, t('Use separate lines for each member.'), expansion !== null ? [ctx.fix(t('Put the members on separate lines'), [ctx.replace(open, expansion)])] : []);
      }
    }

    // statements: `if (` spacing, brace placement, branches on their own lines
    const KEYWORD_PARENS = ['if_statement', 'for_statement', 'while_statement', 'switch_statement', 'for_range_loop', 'catch_clause'];
    for (const s of ctx.nodesOf(...KEYWORD_PARENS)) {
      const keyword = kids(s)[0];
      const parens = kids(s).find((k) => k.type === 'condition_clause' || k.type === 'parameter_list' || k.type === '(');
      if (keyword && parens && parens.startIndex === keyword.endIndex) {
        report({ start: keyword.startIndex, end: parens.startIndex + 1 }, t('Put a space between "{0}" and "(".', keyword.text), [ctx.fix(t('Add a space'), [ctx.insertAt(keyword.endIndex, ' ')])]);
      }
    }

    const bodies: Array<{ owner: Node; body: Node; headEnd: number }> = [];
    for (const s of ctx.nodesOf('if_statement', 'for_statement', 'while_statement', 'for_range_loop', 'switch_statement')) {
      const body = field(s, 'body') ?? field(s, 'consequence');
      if (body) bodies.push({ owner: s, body, headEnd: (field(s, 'condition') ?? kids(s).find((k) => k.type === ')') ?? s).endIndex });
      const alt = field(s, 'alternative');
      const altBody = alt ? namedKids(alt).find((n) => n.type !== 'comment') : undefined;
      if (altBody) bodies.push({ owner: alt!, body: altBody, headEnd: kids(alt!)[0].endIndex });
    }
    for (const kind of ['do_statement', 'try_statement', 'catch_clause']) {
      for (const s of ctx.nodesOf(kind)) {
        const body = field(s, 'body');
        if (body) bodies.push({ owner: s, body, headEnd: kids(s)[0].endIndex });
      }
    }
    for (const { owner, body, headEnd } of bodies) {
      if (body.type === 'compound_statement') {
        if (ctx.startsLine(body.startIndex) && ctx.lineOf(body.startIndex) > ctx.lineOf(headEnd)) {
          const gap = gapBefore(body);
          report({ start: body.startIndex, end: body.startIndex + 1 }, t('The opening brace goes on the same line as the statement it belongs to (K&R layout).'), [
            ctx.fix(t('Move the brace to the previous line'), [ctx.replaceRange(gap.start, gap.end, ' ')]),
          ]);
        } else {
          const first = namedKids(body)[0];
          if (first && ctx.lineOf(first.startIndex) === ctx.lineOf(body.startIndex) && ctx.lineOf(body.startIndex) === ctx.lineOf(headEnd)) {
            const expansion = blockExpansion(ctx, body, lineIndent(owner.startIndex));
            report({ start: body.startIndex, end: body.startIndex + 1 }, t('Use separate lines for the branches of an if and the body of a loop.'), expansion !== null ? [ctx.fix(t('Put the body on separate lines'), [ctx.replace(body, expansion)])] : []);
          }
        }
      } else if (body.type !== 'if_statement' || owner.type !== 'else_clause') {
        if (ctx.lineOf(body.startIndex) === ctx.lineOf(headEnd)) {
          const indent = lineIndent(owner.startIndex) + ctx.indentUnit;
          const gap = gapBefore(body);
          report(body, t('Use separate lines for the branches of an if and the body of a loop.'), [
            ctx.fix(t('Put the body on its own line'), [ctx.replaceRange(gap.start, gap.end, `${ctx.eol}${indent}`)]),
          ]);
        }
      }
    }

    // case labels aligned with their switch
    for (const sw of ctx.nodesOf('switch_statement')) {
      const body = field(sw, 'body');
      if (!body) continue;
      const swCol = ctx.column(sw.startIndex);
      const swIndent = ctx.indentAt(sw.startIndex);
      if (!ctx.startsLine(sw.startIndex)) continue;
      for (const c of namedKids(body)) {
        if (c.type !== 'case_statement' || !ctx.startsLine(c.startIndex)) continue;
        if (ctx.column(c.startIndex) !== swCol) {
          report({ start: c.startIndex, end: c.startIndex + 4 }, t('Align the case labels with the switch (K&R layout).'), [
            ctx.fix(t('Align the label'), [reindent(ctx, ctx.lineOf(c.startIndex), swIndent)]),
          ]);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.18  C++-style declarator layout
// ---------------------------------------------------------------------------------------------
const declaratorCheck: Check = {
  name: 'NL.18 declarator layout',
  covers: ['NL.18'],
  run(ctx) {
    const TYPES = ['pointer_declarator', 'reference_declarator', 'abstract_pointer_declarator', 'abstract_reference_declarator'];
    for (const d of ctx.nodesOf(...TYPES)) {
      if (d.parent && TYPES.includes(d.parent.type)) continue; // only the outermost of a `**` run
      let s = d.startIndex;
      let before = s;
      while (before > 0 && /[ \t]/.test(ctx.text[before - 1])) before--;
      if (before === s) continue; // already attached to the type
      const prevChar = ctx.text[before - 1];
      if (!prevChar || /[\n(,<]/.test(prevChar)) continue; // start of a line, `(*fp)`, or a list
      // the run of sigils
      let e = s;
      while (e < ctx.text.length && /[*&]/.test(ctx.text[e])) e++;
      const sigils = ctx.text.slice(s, e);
      const afterWs = /^[ \t]*/.exec(ctx.text.slice(e))![0];
      const followedByName = /^[A-Za-z_]/.test(ctx.text.slice(e + afterWs.length));
      const replacement = followedByName ? `${sigils} ` : sigils;
      ctx.report({
        ruleId: 'NL.18',
        start: before,
        end: e + afterWs.length,
        message: t('Attach the declarator operator to the type: "T{0} name" rather than "T {0}name".', sigils),
        fixes: [ctx.fix(t('Attach to the type'), [ctx.replaceRange(before, e + afterWs.length, replacement)])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.20  Don't place two statements on the same line
// ---------------------------------------------------------------------------------------------
const oneStatementCheck: Check = {
  name: 'NL.20 one statement per line',
  covers: ['NL.20'],
  run(ctx) {
    const containers = ['compound_statement', 'field_declaration_list', 'declaration_list', 'translation_unit', 'case_statement'];
    for (const c of ctx.nodesOf(...containers)) {
      const items = namedKids(c).filter((n) => !['comment', 'access_specifier', 'case_statement'].includes(n.type) && !n.type.startsWith('preproc_') && n.id !== (c.type === 'case_statement' ? field(c, 'value')?.id : -1));
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1];
        const cur = items[i];
        if (ctx.lineOf(prev.endIndex - 1) !== ctx.lineOf(cur.startIndex)) continue;
        const indent = ctx.indentAt(prev.startIndex);
        ctx.report({
          ruleId: 'NL.20',
          node: cur,
          message: t("Don't place two statements on the same line."),
          fixes: [ctx.fix(t('Move it to its own line'), [ctx.replaceRange(prev.endIndex, cur.startIndex, `${ctx.eol}${indent}`)])],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.25  void as an argument type  /  NL.26  const notation
// ---------------------------------------------------------------------------------------------
const voidParamCheck: Check = {
  name: 'NL.25 void parameter',
  covers: ['NL.25'],
  run(ctx) {
    for (const list of ctx.nodesOf('parameter_list')) {
      const params = namedKids(list);
      if (params.length !== 1 || params[0].type !== 'parameter_declaration') continue;
      const p = params[0];
      if (field(p, 'type')?.text !== 'void' || field(p, 'declarator')) continue;
      if (kids(p).some((k) => k.type === 'type_qualifier')) continue;
      ctx.report({
        ruleId: 'NL.25',
        node: p,
        message: t("Don't use void as an argument type."),
        fixes: [ctx.fix(t('Remove void'), [ctx.replaceRange(list.startIndex + 1, list.endIndex - 1, '')])],
      });
    }
  },
};

const eastConstCheck: Check = {
  name: 'NL.26 const notation',
  covers: ['NL.26'],
  run(ctx) {
    for (const d of ctx.nodesOf('declaration', 'parameter_declaration', 'optional_parameter_declaration', 'field_declaration')) {
      const type = field(d, 'type');
      if (!type) continue;
      const east = kids(d).filter((k) => k.type === 'type_qualifier' && k.text === 'const' && k.startIndex >= type.endIndex);
      for (const q of east) {
        let start = q.startIndex;
        while (start > type.endIndex && /[ \t]/.test(ctx.text[start - 1])) start--;
        ctx.report({
          ruleId: 'NL.26',
          node: q,
          message: t('Use conventional const notation: "const T", not "T const".'),
          fixes: [ctx.fix(t('Write const first'), [ctx.replaceRange(start, q.endIndex, ''), ctx.insertAt(type.startIndex, 'const ')])],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.11  Make literals readable
// ---------------------------------------------------------------------------------------------
function separate(digits: string, group: number): string {
  const out: string[] = [];
  for (let i = digits.length; i > 0; i -= group) out.unshift(digits.slice(Math.max(0, i - group), i));
  return out.join("'");
}

const literalCheck: Check = {
  name: 'NL.11 readable literals',
  covers: ['NL.11'],
  run(ctx) {
    const min = ctx.config.thresholds.digitSeparatorMinDigits;
    for (const lit of ctx.nodesOf('number_literal')) {
      const text = lit.text;
      const m = /^([-+]?)(0[xX]|0[bB])?([0-9a-fA-F]+)((?:[uUlLzZ]|[fF](?![0-9a-fA-F]))*)$/.exec(text);
      if (!m || /[.eEpP]/.test(text.replace(/^0[xX]/, '')) && !m[2]) continue;
      const [, sign, prefix, digits, suffix] = m;
      if (text.includes("'")) continue;
      const decimal = !prefix;
      if (decimal && !/^\d+$/.test(digits)) continue;
      if (digits.length < min) continue;
      const group = decimal ? 3 : prefix!.toLowerCase() === '0b' ? 4 : 4;
      ctx.report({
        ruleId: 'NL.11',
        node: lit,
        message: t('Make literals readable: use digit separators in "{0}".', text),
        fixes: [ctx.fix(t("Insert digit separators"), [ctx.replace(lit, `${sign}${prefix ?? ''}${separate(digits, group)}${suffix}`)])],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// NL.16  Conventional class member declaration order
// ---------------------------------------------------------------------------------------------
const memberOrderCheck: Check = {
  name: 'NL.16 member order',
  covers: ['NL.16'],
  run(ctx) {
    type Access = 'public' | 'protected' | 'private';
    const rank: Record<Access, number> = { public: 0, protected: 1, private: 2 };
    for (const c of classesOf(ctx)) {
      // access sections: public before protected before private, each at most once
      const seen = new Set<Access>();
      let last = -1;
      for (const l of c.accessLabels) {
        if (!l.node) continue;
        const r = rank[l.access];
        if (seen.has(l.access) || r < last) {
          ctx.report({ ruleId: 'NL.16', node: l.node, message: seen.has(l.access) ? t('Avoid multiple {0} sections; group all {0} members together.', l.access) : t('Declare public members before protected before private members.') });
        }
        seen.add(l.access);
        last = Math.max(last, r);
      }

      // within the public and protected sections: types, constructors/assignment/destructor, functions, data
      const kindOf = (n: Node): number => {
        const target = n.type === 'template_declaration' ? namedKids(n).find((k) => !['template_parameter_list', 'requires_clause'].includes(k.type)) ?? n : n;
        if (['alias_declaration', 'type_definition', 'class_specifier', 'struct_specifier', 'enum_specifier', 'union_specifier'].includes(target.type)) return 0;
        if (target.type === 'field_declaration' && ['class_specifier', 'struct_specifier', 'enum_specifier', 'union_specifier'].includes(field(target, 'type')?.type ?? '')) return 0;
        const fn = c.functions.find((m) => m.info.node.id === target.id);
        if (fn) return fn.info.isConstructor || fn.info.isDestructor || fn.info.name === 'operator=' ? 1 : 2;
        if (target.type === 'field_declaration' && !shapeOf(field(target, 'declarator')).isFunction) return 3;
        return -1;
      };
      let access: Access = c.keyword === 'class' ? 'private' : 'public';
      let maxKind = -1;
      for (const child of kids(c.body)) {
        if (child.type === 'access_specifier') {
          access = child.text as Access;
          maxKind = -1;
          continue;
        }
        if (access === 'private') continue; // private details may be grouped freely
        const k = kindOf(child);
        if (k < 0) continue;
        if (k < maxKind) {
          ctx.report({ ruleId: 'NL.16', node: child, message: t('Use a conventional member order: types, constructors/assignment/destructor, functions, then data.') });
        }
        maxKind = Math.max(maxKind, k);
      }
    }
  },
};

export const nlLayoutChecks: Check[] = [
  indentationCheck,
  spacesCheck,
  knrCheck,
  declaratorCheck,
  oneStatementCheck,
  voidParamCheck,
  eastConstCheck,
  literalCheck,
  memberOrderCheck,
];
