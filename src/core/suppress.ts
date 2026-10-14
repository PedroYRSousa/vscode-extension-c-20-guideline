import type { Node } from 'web-tree-sitter';
import type { Context } from './context.js';
import { isKnownRuleId } from './registry.js';
import { t } from './i18n.js';
import type { Finding } from './types.js';

/**
 * Suppression comments (answer 7A):
 *
 *     // cpp20-guideline: ignore F.9, ES.47 -- why this deviation is acceptable
 *
 *  - a trailing comment applies to its own line, and to the statement or declaration it ends: a formatter
 *    wraps long statements and leaves the comment on the last line;
 *  - a comment alone on a line applies to the next line, and to the rest of the head of the declaration that
 *    starts there (everything before its first `{`);
 *  - the lines between `// clang-format off` and `// clang-format on` are not checked for layout rules;
 *  - the justification after `--` is mandatory. Without it nothing is suppressed and the comment
 *    itself is an error (`CPP20.suppress`).
 */
const DIRECTIVE = /^(?:\/\/+|\/\*+)\s*cpp20-guideline:\s*ignore\b(.*?)(?:\*\/)?$/s;

export interface Suppression {
  line: number;
  /** First line covered (up to `line`); absent when only `line` is covered. */
  from?: number;
  ids: string[];
  justification: string;
}

const FLAT_STATEMENTS = ['declaration', 'field_declaration', 'expression_statement', 'return_statement', 'alias_declaration', 'type_definition', 'using_declaration', 'static_assert_declaration', 'friend_declaration', 'co_return_statement', 'throw_statement'];
const HEADS = [...FLAT_STATEMENTS, 'function_definition', 'template_declaration', 'class_specifier', 'struct_specifier', 'union_specifier', 'enum_specifier', 'namespace_definition'];
const BLOCKS = ['compound_statement', 'field_declaration_list', 'enumerator_list', 'declaration_list'];
/** The rules a formatter decides: switched off between `clang-format off` and `clang-format on`. */
const LAYOUT_RULES = ['NL.4', 'NL.11', 'NL.15', 'NL.17', 'NL.18', 'NL.20', 'NL.26'];

/** The outermost brace-free statement or declaration that ends on the line of the trailing `comment`, right before it. */
function flatStatementBefore(ctx: Context, comment: Node): Node | null {
  const line = ctx.lineOf(comment.startIndex);
  let best: Node | null = null;
  for (const n of ctx.nodesOf(...FLAT_STATEMENTS)) {
    if (n.endIndex > comment.startIndex || ctx.lineOf(n.endIndex - 1) !== line) continue;
    if (/\S/.test(ctx.slice(n.endIndex, comment.startIndex))) continue;
    if (n.descendantsOfType(BLOCKS).length > 0) continue;
    if (!best || n.startIndex < best.startIndex) best = n;
  }
  return best;
}

/** Last line of the head (everything before the first `{` of its body) of the outermost declaration that starts on `line`. */
function headEndLine(ctx: Context, line: number): number | null {
  let best: Node | null = null;
  for (const n of ctx.nodesOf(...HEADS)) {
    if (ctx.lineOf(n.startIndex) !== line || !ctx.startsLine(n.startIndex)) continue;
    if (!best || n.endIndex > best.endIndex) best = n;
  }
  if (!best) return null;
  const blocks = best.descendantsOfType(BLOCKS);
  const open = blocks.length > 0 ? Math.min(...blocks.map((b) => b?.startIndex ?? best!.endIndex)) : best.endIndex;
  return ctx.lineOf(Math.max(best.startIndex, open - 1));
}

export function parseSuppressions(ctx: Context): { suppressions: Suppression[]; problems: Finding[] } {
  const suppressions: Suppression[] = [];
  const problems: Finding[] = [];
  const directiveLines = new Set<number>();
  const pending: Array<{ comment: Node; line: number; alone: boolean; ids: string[]; justification: string }> = [];

  for (const comment of ctx.nodesOf('comment')) {
    const m = DIRECTIVE.exec(ctx.src(comment).trim());
    if (!m) continue;
    const body = m[1];
    const sep = body.indexOf('--');
    const idPart = sep >= 0 ? body.slice(0, sep) : body;
    const justification = sep >= 0 ? body.slice(sep + 2).trim() : '';
    const ids = idPart.split(/[\s,]+/).filter(Boolean);
    const problem = (message: string): void => {
      problems.push({
        ruleId: 'CPP20.suppress',
        severity: 'error',
        start: comment.startIndex,
        end: comment.endIndex,
        message,
        fixes: [],
        alsoCovers: [],
      });
    };
    const line = ctx.lineOf(comment.startIndex);
    const alone = ctx.startsLine(comment.startIndex);
    if (alone) directiveLines.add(line);
    if (ids.length === 0) {
      problem(t('Suppression names no rule. Use "// cpp20-guideline: ignore <rule> -- <justification>".'));
      continue;
    }
    const unknown = ids.filter((id) => !isKnownRuleId(id));
    if (unknown.length > 0) {
      problem(t('Suppression names unknown rule(s): {0}.', unknown.join(', ')));
      continue;
    }
    if (justification.length === 0) {
      problem(t('A suppression needs a justification: "// cpp20-guideline: ignore {0} -- <why>".', ids.join(', ')));
      continue;
    }
    pending.push({ comment, line, alone, ids, justification });
  }

  for (const p of pending) {
    let target = p.line;
    if (p.alone) {
      target = p.line + 1;
      while (directiveLines.has(target)) target++; // stacked directives all apply to the same code line
    }
    let line = target;
    let from: number | undefined;
    if (p.alone) {
      const end = headEndLine(ctx, target);
      if (end !== null && end > target) {
        from = target;
        line = end;
      }
    } else {
      const flat = flatStatementBefore(ctx, p.comment);
      if (flat) from = ctx.lineOf(flat.startIndex);
    }
    suppressions.push({ line, ...(from !== undefined && from < line ? { from } : {}), ids: p.ids, justification: p.justification });
  }

  // `// clang-format off` ... `// clang-format on`: the author opted out of the formatter, so the layout rules are off there too
  let offFrom = -1;
  for (const comment of ctx.nodesOf('comment')) {
    const m = /^(?:\/\/+|\/\*+)\s*clang-format\s+(off|on)\b/.exec(ctx.src(comment).trim());
    if (!m) continue;
    const line = ctx.lineOf(comment.startIndex);
    if (m[1] === 'off' && offFrom < 0) offFrom = line + 1;
    else if (m[1] === 'on' && offFrom >= 0) {
      if (line - 1 >= offFrom) suppressions.push({ line: line - 1, from: offFrom, ids: LAYOUT_RULES, justification: 'clang-format off' });
      offFrom = -1;
    }
  }
  if (offFrom >= 0 && ctx.lineCount - 1 >= offFrom) suppressions.push({ line: ctx.lineCount - 1, from: offFrom, ids: LAYOUT_RULES, justification: 'clang-format off' });
  return { suppressions, problems };
}

export function isSuppressed(ctx: Context, finding: Finding, suppressions: Suppression[]): boolean {
  const line = ctx.lineOf(finding.start);
  return suppressions.some(
    (s) => (s.line === line || (s.from !== undefined && line >= s.from && line <= s.line)) && (s.ids.includes(finding.ruleId) || finding.alsoCovers.some((id) => s.ids.includes(id))),
  );
}

export type { Node };
