import { parse as parseYaml } from 'yaml';
import { severityOf } from './registry.js';
import { t } from './i18n.js';
import type { Finding, TextEdit } from './types.js';

/**
 * Optional clang-tidy bridge (answer 2: tree-sitter is the base, clang-tidy is an opt-in complement that
 * brings real semantic analysis). Each clang-tidy check that implements a guideline rule is mapped to
 * that rule, so severity, documentation link and suppression comments work exactly as for built-in checks.
 */
export const CLANG_TIDY_MAP: Readonly<Record<string, string>> = {
  'cppcoreguidelines-avoid-c-arrays': 'SL.con.1',
  'modernize-avoid-c-arrays': 'SL.con.1',
  'cppcoreguidelines-avoid-capturing-lambda-coroutines': 'CP.51',
  'cppcoreguidelines-avoid-const-or-ref-data-members': 'C.12',
  'cppcoreguidelines-avoid-do-while': 'ES.75',
  'cppcoreguidelines-avoid-goto': 'ES.76',
  'cppcoreguidelines-avoid-magic-numbers': 'ES.45',
  'cppcoreguidelines-avoid-non-const-global-variables': 'I.2',
  'cppcoreguidelines-avoid-reference-coroutine-parameters': 'CP.53',
  'cppcoreguidelines-c-copy-assignment-signature': 'F.47',
  'cppcoreguidelines-explicit-virtual-functions': 'C.128',
  'modernize-use-override': 'C.128',
  'cppcoreguidelines-init-variables': 'ES.20',
  'cppcoreguidelines-interfaces-global-init': 'I.22',
  'cppcoreguidelines-macro-to-enum': 'Enum.1',
  'modernize-macro-to-enum': 'Enum.1',
  'cppcoreguidelines-macro-usage': 'ES.31',
  'cppcoreguidelines-misleading-capture-default-by-value': 'F.54',
  'cppcoreguidelines-missing-std-forward': 'F.19',
  'cppcoreguidelines-narrowing-conversions': 'ES.46',
  'cppcoreguidelines-no-malloc': 'R.10',
  'cppcoreguidelines-no-suspend-with-lock': 'CP.52',
  'cppcoreguidelines-noexcept-destructor': 'C.37',
  'cppcoreguidelines-noexcept-move-operations': 'C.66',
  'cppcoreguidelines-noexcept-swap': 'C.85',
  'cppcoreguidelines-non-private-member-variables-in-classes': 'C.133',
  'misc-non-private-member-variables-in-classes': 'C.133',
  'cppcoreguidelines-prefer-member-initializer': 'C.49',
  'cppcoreguidelines-pro-bounds-array-to-pointer-decay': 'I.13',
  'cppcoreguidelines-pro-bounds-constant-array-index': 'ES.42',
  'cppcoreguidelines-pro-bounds-pointer-arithmetic': 'ES.42',
  'cppcoreguidelines-pro-type-const-cast': 'ES.50',
  'cppcoreguidelines-pro-type-cstyle-cast': 'ES.49',
  'cppcoreguidelines-pro-type-member-init': 'C.41',
  'cppcoreguidelines-pro-type-reinterpret-cast': 'ES.48',
  'cppcoreguidelines-pro-type-static-cast-downcast': 'C.146',
  'cppcoreguidelines-pro-type-union-access': 'P.4',
  'cppcoreguidelines-pro-type-vararg': 'F.55',
  'cppcoreguidelines-rvalue-reference-param-not-moved': 'F.18',
  'cppcoreguidelines-slicing': 'ES.63',
  'cppcoreguidelines-special-member-functions': 'C.21',
  'cppcoreguidelines-use-default-member-init': 'C.45',
  'modernize-use-default-member-init': 'C.45',
  'cppcoreguidelines-virtual-class-destructor': 'C.127',
  'hicpp-multiway-paths-covered': 'ES.79',
  'bugprone-use-after-move': 'F.18',
  'bugprone-move-forwarding-reference': 'ES.56',
  'bugprone-virtual-near-miss': 'C.128',
  'bugprone-exception-escape': 'E.16',
  'performance-move-const-arg': 'ES.56',
  'performance-unnecessary-value-param': 'F.16',
  'readability-else-after-return': 'F.56',
  'readability-container-size-empty': 'T.143',
  'readability-simplify-boolean-expr': 'ES.87',
  'misc-const-correctness': 'Con.4',
  'modernize-deprecated-headers': 'CPL.1',
  'modernize-loop-convert': 'ES.71',
  'modernize-make-shared': 'R.22',
  'modernize-make-unique': 'R.23',
  'modernize-redundant-void-arg': 'NL.25',
  'modernize-replace-auto-ptr': 'CPP20.removed',
  'modernize-replace-random-shuffle': 'CPP20.removed',
  'modernize-type-traits': 'CPP20.type_traits',
  'modernize-use-auto': 'ES.11',
  'modernize-use-constraints': 'CPP20.concepts',
  'modernize-use-equals-default': 'C.80',
  'modernize-use-nodiscard': 'CPP20.nodiscard',
  'modernize-use-noexcept': 'E.30',
  'modernize-use-nullptr': 'ES.47',
  'modernize-use-starts-ends-with': 'CPP20.contains',
  'modernize-use-std-numbers': 'CPP20.numbers',
  'modernize-use-uncaught-exceptions': 'CPP20.removed',
  'modernize-use-using': 'T.43',
};

/** clang-tidy fixes that are behaviour preserving; every other fix is offered as "may change behaviour". */
const SAFE_FIXES = new Set([
  'modernize-use-nullptr', 'modernize-use-using', 'modernize-use-override', 'modernize-redundant-void-arg', 'readability-container-size-empty',
  'modernize-use-nodiscard', 'modernize-use-std-numbers', 'modernize-use-starts-ends-with', 'readability-else-after-return', 'readability-simplify-boolean-expr',
  'modernize-use-auto', 'modernize-use-default-member-init', 'modernize-type-traits',
]);

export function clangTidyChecksArgument(): string {
  return `-*,${Object.keys(CLANG_TIDY_MAP).join(',')}`;
}

/** Offsets in clang-tidy's YAML are UTF-8 byte offsets; the analyser works with UTF-16 string indices. */
export function byteOffsetToIndex(text: string): (byteOffset: number) => number {
  const starts: number[] = new Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    starts[i] = bytes;
    const code = text.codePointAt(i)!;
    if (code > 0xffff) {
      // surrogate pair: the second unit lies inside the 4-byte sequence (never a real boundary)
      starts[i + 1] = bytes + 1;
      bytes += 4;
      i++;
    } else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  starts[text.length] = bytes;
  return (byteOffset: number): number => {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < byteOffset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

interface YamlReplacement {
  FilePath?: string;
  Offset?: number;
  Length?: number;
  ReplacementText?: string;
}

interface YamlDiagnostic {
  DiagnosticName?: string;
  DiagnosticMessage?: {
    Message?: string;
    FilePath?: string;
    FileOffset?: number;
    Replacements?: YamlReplacement[];
    Ranges?: Array<{ FilePath?: string; FileOffset?: number; Length?: number }>;
  };
}

const samePath = (a: string | undefined, b: string): boolean => !!a && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** Convert the file written by `clang-tidy --export-fixes` into findings for `filePath`. */
export function parseClangTidyFixes(yamlText: string, filePath: string, text: string): Finding[] {
  const doc = parseYaml(yamlText) as { Diagnostics?: YamlDiagnostic[] } | null;
  const toIndex = byteOffsetToIndex(text);
  const out: Finding[] = [];
  for (const d of doc?.Diagnostics ?? []) {
    const name = d.DiagnosticName ?? '';
    const ruleId = CLANG_TIDY_MAP[name];
    const msg = d.DiagnosticMessage;
    if (!ruleId || !msg || !samePath(msg.FilePath, filePath) || msg.FileOffset === undefined) continue;

    const replacements = (msg.Replacements ?? []).filter((r) => samePath(r.FilePath, filePath) && r.Offset !== undefined);
    const edits: TextEdit[] = replacements.map((r) => ({
      start: toIndex(r.Offset!),
      end: toIndex(r.Offset! + (r.Length ?? 0)),
      text: r.ReplacementText ?? '',
    }));

    let start = toIndex(msg.FileOffset);
    let end = start;
    const range = msg.Ranges?.find((r) => samePath(r.FilePath, filePath) && r.FileOffset !== undefined);
    if (range) {
      start = toIndex(range.FileOffset!);
      end = toIndex(range.FileOffset! + (range.Length ?? 0));
    } else if (edits.length > 0 && edits[0].end > edits[0].start) {
      start = edits[0].start;
      end = edits[0].end;
    }
    if (end <= start) {
      const m = /^[A-Za-z_]\w*/.exec(text.slice(start));
      end = start + (m ? m[0].length : 1);
    }
    out.push({
      ruleId,
      severity: severityOf(ruleId),
      start,
      end: Math.min(end, text.length),
      message: t('clang-tidy ({0}): {1}', name, msg.Message ?? ''),
      fixes: edits.length > 0 ? [{ title: t('Apply the clang-tidy fix'), edits, safety: SAFE_FIXES.has(name) ? 'safe' : 'unsafe' }] : [],
      alsoCovers: [],
    });
  }
  return out;
}

/** Findings from clang-tidy that are not already reported by a built-in check on the same line. */
export function mergeFindings(builtIn: readonly Finding[], external: readonly Finding[], lineOf: (offset: number) => number): Finding[] {
  const seen = new Set(builtIn.flatMap((f) => [f.ruleId, ...f.alsoCovers].map((id) => `${id}@${lineOf(f.start)}`)));
  const extra = external.filter((f) => !seen.has(`${f.ruleId}@${lineOf(f.start)}`));
  return [...builtIn, ...extra].sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId));
}
