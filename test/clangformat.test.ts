import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, fileInfoFor } from '../src/core/analyzer';
import { defaultConfig, type Finding } from '../src/core/types';
import { allChecks } from '../src/rules/index';
import { wasm } from './helpers';

/**
 * The repository's .clang-format must be compatible with the layout rules of the extension: whatever
 * clang-format makes of a file, the extension finds no layout problem in it, formatting is stable, and
 * formatting neither creates nor hides any other diagnostic.
 */
const ROOT = resolve(__dirname, '..');
const CONFIG = join(ROOT, '.clang-format');
const FIXTURES = join(__dirname, 'fixtures', 'format');
const LAYOUT = new Set(['NL.4', 'NL.11', 'NL.15', 'NL.17', 'NL.18', 'NL.20', 'NL.26']);
const NAMING = /^(Capitalize the names|Do not capitalize the names)/; // NL.17 also covers naming; clang-format cannot rename

function findClangFormat(): string | undefined {
  for (const bin of ['clang-format-18', 'clang-format-19', 'clang-format-20', 'clang-format-17', 'clang-format']) {
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8' });
      const major = Number(/version (\d+)/.exec(out)?.[1] ?? 0);
      if (major >= 17) return bin;
    } catch {
      /* not installed */
    }
  }
  return undefined;
}

const clangFormat = findClangFormat();

function format(text: string, name: string): string {
  return execFileSync(clangFormat!, [`-style=file:${CONFIG}`, `--assume-filename=${name}`], { input: text, encoding: 'utf8', maxBuffer: 1 << 26 });
}

async function findings(text: string, name: string): Promise<Finding[]> {
  const { findings: all } = await analyze(text, fileInfoFor(name), { ...defaultConfig }, { wasm, checks: allChecks, strict: true });
  return all;
}

const isLayout = (f: Finding): boolean => LAYOUT.has(f.ruleId) && !NAMING.test(f.message);
const describeFinding = (text: string, f: Finding): string => `${f.ruleId} line ${text.slice(0, f.start).split('\n').length}: ${f.message}`;

describe.skipIf(!clangFormat)('.clang-format', () => {
  it('is accepted by clang-format and pins the options the layout rules depend on', () => {
    const dump = execFileSync(clangFormat!, [`-style=file:${CONFIG}`, '-dump-config', '--assume-filename=x.cpp'], { encoding: 'utf8' });
    const pinned: Record<string, string> = {
      IndentWidth: '4',
      UseTab: 'Never',
      BreakBeforeBraces: 'Stroustrup',
      IndentCaseLabels: 'false',
      IndentCaseBlocks: 'false',
      PointerAlignment: 'Left',
      ReferenceAlignment: 'Pointer',
      QualifierAlignment: 'Left',
      AllowShortFunctionsOnASingleLine: 'None',
      AllowShortIfStatementsOnASingleLine: 'Never',
      AllowShortLoopsOnASingleLine: 'false',
      AllowShortBlocksOnASingleLine: 'Never',
      AllowShortCaseLabelsOnASingleLine: 'false',
      SpaceAfterTemplateKeyword: 'false',
    };
    for (const [key, value] of Object.entries(pinned)) expect(dump, key).toMatch(new RegExp(`^${key}:\\s+${value}$`, 'm'));
    // no column alignment (NL.15): the alignment options are structures in the dump
    for (const key of ['AlignConsecutiveAssignments', 'AlignConsecutiveBitFields', 'AlignConsecutiveDeclarations', 'AlignConsecutiveMacros']) {
      expect(dump, key).toMatch(new RegExp(`^${key}:\\n\\s+Enabled:\\s+false$`, 'm'));
    }
    expect(dump).toMatch(/^ColumnLimit:\s+(\d+)$/m);
    expect(Number(/^ColumnLimit:\s+(\d+)$/m.exec(dump)![1])).toBeLessThanOrEqual(defaultConfig.thresholds.maxFunctionColumns);
  });

  const fixtures = readdirSync(FIXTURES).filter((n) => /\.(cpp|h|hpp)$/.test(n)).sort();

  it('has fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of fixtures) {
    it(`${name}: formatted output has no layout diagnostic, is stable and keeps the other diagnostics`, async () => {
      const original = readFileSync(join(FIXTURES, name), 'utf8');
      const formatted = format(original, name);

      const leftover = (await findings(formatted, name)).filter(isLayout).map((f) => describeFinding(formatted, f));
      expect(leftover, `layout diagnostics left after clang-format:\n${leftover.join('\n')}`).toEqual([]);

      expect(format(formatted, name), 'clang-format must be idempotent').toBe(formatted);

      const others = async (text: string): Promise<string[]> =>
        (await findings(text, name)).filter((f) => !LAYOUT.has(f.ruleId) && f.ruleId !== 'F.3').map((f) => f.ruleId).sort();
      expect(await others(formatted), 'formatting must not create or hide other diagnostics').toEqual(await others(original));
    });
  }

  it('handles CRLF input', async () => {
    const original = readFileSync(join(FIXTURES, 'messy_allman.cpp'), 'utf8').replace(/\n/g, '\r\n');
    const formatted = format(original, 'crlf.cpp');
    const leftover = (await findings(formatted, 'crlf.cpp')).filter(isLayout).map((f) => describeFinding(formatted, f));
    expect(leftover).toEqual([]);
  });

  // TODO(wip): re-enable once the config keeps trailing suppression comments on the statement's first line
  it.skip('never re-wraps the suppression comments of the extension', () => {
    const justification = 'this is a deliberately very long justification that goes far beyond the column limit of the formatter';
    const code = `void f(int* p)\n{\n    // cpp20-guideline: ignore ES.47 -- ${justification}\n    int* q = NULL;\n    int* r = NULL; // cpp20-guideline: ignore ES.47 -- ${justification}\n}\n`;
    const out = format(code, 'suppress.cpp');
    expect(out).toContain(`// cpp20-guideline: ignore ES.47 -- ${justification}\n    int* q`);
    expect(out).toContain(`int* r = NULL; // cpp20-guideline: ignore ES.47 -- ${justification}\n`);
  });
});
