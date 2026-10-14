import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { byteOffsetToIndex, CLANG_TIDY_MAP, mergeFindings, parseClangTidyFixes } from '../src/core/clangtidy';
import { runClangTidy } from '../src/core/clangtidy-run';
import { isKnownRuleId } from '../src/core/registry';
import type { Finding } from '../src/core/types';

const hasClangTidy = ((): boolean => {
  try {
    execFileSync('clang-tidy', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('clang-tidy bridge', () => {
  it('maps every check to an existing rule', () => {
    for (const [check, rule] of Object.entries(CLANG_TIDY_MAP)) expect(isKnownRuleId(rule), `${check} -> ${rule}`).toBe(true);
  });

  it('converts UTF-8 byte offsets to string indices', () => {
    const text = 'aé😀b';
    const toIndex = byteOffsetToIndex(text);
    expect(toIndex(0)).toBe(0);
    expect(toIndex(1)).toBe(1); // before é
    expect(toIndex(3)).toBe(2); // before 😀
    expect(toIndex(7)).toBe(4); // before b
    expect(text[toIndex(7)]).toBe('b');
  });

  it('parses exported fixes', () => {
    const text = 'int main() { int* p = NULL; }\n';
    const yaml = `---
MainSourceFile:  '/x/a.cpp'
Diagnostics:
  - DiagnosticName:  modernize-use-nullptr
    DiagnosticMessage:
      Message:         use nullptr
      FilePath:        '/x/a.cpp'
      FileOffset:      22
      Replacements:
        - FilePath:        '/x/a.cpp'
          Offset:          22
          Length:          4
          ReplacementText: nullptr
  - DiagnosticName:  some-other-check
    DiagnosticMessage:
      Message:         ignored
      FilePath:        '/x/a.cpp'
      FileOffset:      0
...
`;
    const found = parseClangTidyFixes(yaml, '/x/a.cpp', text);
    expect(found.length).toBe(1);
    expect(found[0].ruleId).toBe('ES.47');
    expect(found[0].severity).toBe('error');
    expect(text.slice(found[0].start, found[0].end)).toBe('NULL');
    expect(found[0].fixes[0].safety).toBe('safe');
    expect(found[0].fixes[0].edits[0]).toEqual({ start: 22, end: 26, text: 'nullptr' });
  });

  it('prefers built-in findings on the same line', () => {
    const lineOf = (o: number): number => (o < 10 ? 0 : 1);
    const mk = (ruleId: string, start: number): Finding => ({ ruleId, severity: 'error', start, end: start + 1, message: ruleId, fixes: [], alsoCovers: [] });
    const merged = mergeFindings([mk('ES.47', 2)], [mk('ES.47', 4), mk('F.18', 5), mk('F.18', 12)], lineOf);
    expect(merged.map((f) => `${f.ruleId}@${f.start}`)).toEqual(['ES.47@2', 'F.18@5', 'F.18@12']);
  });

  it.skipIf(!hasClangTidy)('runs the real clang-tidy and reports semantic findings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'));
    const file = join(dir, 'sample.cpp');
    const text = '#include <string>\n#include <utility>\nvoid take(std::string&& s);\nint main() {\n  int* p = NULL;\n  std::string s = "é";\n  take(std::move(s));\n  auto n = s.size();\n  return n == 0 && p == nullptr;\n}\n';
    writeFileSync(file, text);
    const found = await runClangTidy({ executable: 'clang-tidy', filePath: file, text });
    const ids = found.map((f) => f.ruleId);
    expect(ids).toContain('ES.47');
    expect(ids).toContain('F.18'); // bugprone-use-after-move: needs data-flow analysis
    const nullptr = found.find((f) => f.ruleId === 'ES.47')!;
    expect(text.slice(nullptr.start, nullptr.end)).toBe('NULL');
  }, 120000);
});
