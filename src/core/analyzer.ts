import { Context } from './context.js';
import { parse, type WasmPaths } from './parser.js';
import { ruleInfo } from './registry.js';
import { isSuppressed, parseSuppressions } from './suppress.js';
import type { AnalyzerConfig, Check, FileInfo, Finding } from './types.js';

export interface AnalyzeOptions {
  wasm: WasmPaths;
  checks: readonly Check[];
  /** Re-throw check crashes instead of collecting them (tests). */
  strict?: boolean;
  /**
   * Findings from an external analyser (clang-tidy) for exactly this text. They go through the same
   * suppression and severity filters; where a built-in check already reported the rule on the same line they are dropped.
   */
  external?: readonly Finding[];
}

export interface AnalyzeResult {
  findings: Finding[];
  crashes: Array<{ check: string; error: unknown }>;
}

export function fileInfoFor(path: string): FileInfo {
  const m = /(\.[^./\\]+)$/.exec(path);
  const ext = m ? m[1] : '';
  return { path, ext, isHeader: /^\.(h|hh|hpp|hxx|h\+\+|hp|inl|ipp|tpp)$/i.test(ext) };
}

export async function analyze(
  text: string,
  file: FileInfo,
  config: AnalyzerConfig,
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const tree = await parse(text, options.wasm);
  const crashes: AnalyzeResult['crashes'] = [];
  try {
    const ctx = new Context(text, tree, file, config);
    for (const check of options.checks) {
      ctx.restrictTo(check.covers);
      try {
        check.run(ctx);
      } catch (error) {
        if (options.strict) throw error;
        crashes.push({ check: check.name, error });
      }
    }
    ctx.restrictTo(undefined);

    const { suppressions, problems } = parseSuppressions(ctx);
    const seen = new Set<string>();
    const findings: Finding[] = [];
    const covered = new Set(ctx.findings.flatMap((f) => [f.ruleId, ...f.alsoCovers].map((id) => `${id}@${ctx.lineOf(f.start)}`)));
    const external = (options.external ?? []).filter((f) => !covered.has(`${f.ruleId}@${ctx.lineOf(f.start)}`));
    for (const f of [...ctx.findings, ...external]) {
      const info = ruleInfo(f.ruleId);
      if (info?.optIn === 'modules' && !config.enforceModules) continue;
      if (f.severity === 'warning' && !config.enableOptionalWarnings) continue;
      if (isSuppressed(ctx, f, suppressions)) continue;
      const key = `${f.ruleId}:${f.start}:${f.end}:${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
    findings.push(...problems);
    findings.sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId));
    return { findings, crashes };
  } finally {
    tree.delete();
  }
}

/** Apply non-overlapping text edits (descending offsets) to `text`. */
export function applyEdits(text: string, edits: ReadonlyArray<{ start: number; end: number; text: string }>): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
