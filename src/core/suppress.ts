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
 *  - a trailing comment applies to its own line;
 *  - a comment alone on a line applies to the next line;
 *  - the justification after `--` is mandatory. Without it nothing is suppressed and the comment
 *    itself is an error (`CPP20.suppress`).
 */
const DIRECTIVE = /^(?:\/\/+|\/\*+)\s*cpp20-guideline:\s*ignore\b(.*?)(?:\*\/)?$/s;

export interface Suppression {
  line: number;
  ids: string[];
  justification: string;
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
    suppressions.push({ line: target, ids: p.ids, justification: p.justification });
  }
  return { suppressions, problems };
}

export function isSuppressed(ctx: Context, finding: Finding, suppressions: Suppression[]): boolean {
  const line = ctx.lineOf(finding.start);
  return suppressions.some(
    (s) => s.line === line && (s.ids.includes(finding.ruleId) || finding.alsoCovers.some((id) => s.ids.includes(id))),
  );
}

export type { Node };
