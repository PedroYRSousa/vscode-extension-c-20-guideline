import { describe, expect, it } from 'vitest';
import { parse } from '../src/core/parser.js';
import type { Check } from '../src/core/types.js';
import { fixed, only, run, wasm } from './helpers.js';

/** Regression tests for quick fixes that used to damage code found in real headers. */

const errorCount = async (code: string): Promise<number> => {
  const tree = await parse(code, wasm);
  const n = tree.rootNode.descendantsOfType('ERROR').length + tree.rootNode.descendantsOfType('MISSING').length;
  tree.delete();
  return n;
};

describe('NL.17 brace moves', () => {
  it('puts the brace in front of a trailing line comment instead of inside it', async () => {
    const code = 'void f(int x)\n{\n    if (x == 0) // zero\n    {\n        a();\n    }\n}\n';
    const [finding] = await only(code, 'NL.17');
    const out = fixed(code, finding.fixes[0]);
    expect(out).toBe('void f(int x)\n{\n    if (x == 0) { // zero\n        a();\n    }\n}\n');
    expect(await errorCount(out)).toBe(0);
  });

  it('does the same for classes', async () => {
    const code = 'struct A // a type\n{\n    int x;\n};\n';
    const [finding] = await only(code, 'NL.17');
    expect(fixed(code, finding.fixes[0])).toBe('struct A { // a type\n    int x;\n};\n');
  });

  it('keeps a block comment where it is', async () => {
    const code = 'void f(int x)\n{\n    if (x == 0) /* zero */\n    {\n        a();\n    }\n}\n';
    const [finding] = await only(code, 'NL.17');
    expect(fixed(code, finding.fixes[0])).toContain('if (x == 0) /* zero */ {');
  });

  it('offers no brace move when a preprocessor line separates the head from the brace', async () => {
    const code = 'void f(int x)\n{\n    if (x == 0)\n#if DEBUG\n    {\n        a();\n    }\n#endif\n}\n';
    for (const f of await only(code, 'NL.17')) expect(f.fixes.filter((x) => x.title.includes('previous line'))).toEqual([]);
  });
});

describe('SF.8 guard names', () => {
  it('derives a valid macro name when the directory starts with a digit', async () => {
    const [finding] = await only('int f();\n', 'SF.8', { path: '/usr/include/c++/13/stdlib.h' });
    expect(finding.fixes[0].title).toContain('FILE_13_STDLIB_H');
  });

  it('does not start the name with an underscore', async () => {
    const [finding] = await only('int f();\n', 'SF.8', { path: 'src/_detail.h' });
    expect(finding.fixes[0].title).toContain('SRC_DETAIL_H');
  });
});

describe('ES.31 macro replacement', () => {
  it('replaces a plain constant', async () => {
    const [finding] = await only('#define MAX_ITEMS 16\nint a[MAX_ITEMS];\n', 'ES.31');
    expect(fixed('#define MAX_ITEMS 16\nint a[MAX_ITEMS];\n', finding.fixes[0])).toContain('inline constexpr auto max_items = 16;');
  });

  it('offers no fix when the macro is tested by the preprocessor', async () => {
    for (const code of ['#define LEVEL 2\n#if LEVEL > 1\nint a;\n#endif\n', '#define HAS_X 1\n#ifdef HAS_X\nint a;\n#endif\n']) {
      const found = await only(code, 'ES.31');
      expect(found.length).toBe(1);
      expect(found[0].fixes).toEqual([]);
    }
  });

  it('offers no fix for reserved names, which a rename would silently change', async () => {
    const [finding] = await only('#define __cpp_lib_thing 202106L\n', 'ES.31');
    expect(finding.fixes).toEqual([]);
  });
});

describe('T.10 with default arguments', () => {
  it('reports but does not rewrite a parameter that has a default type', async () => {
    const found = await only('template <bool S, typename Tag = void>\nstruct Switch { };\n', 'T.10');
    expect(found.length).toBeGreaterThan(0);
    expect(found.find((f) => f.message.includes('"Tag"'))?.fixes).toEqual([]);
  });
});

describe('fixes never cut through preprocessor lines or unparsable code', () => {
  const rewriteAll: Check = {
    name: 'test',
    covers: ['ES.10'],
    run(ctx) {
      ctx.report({ ruleId: 'ES.10', start: 0, end: 1, message: 'x', fixes: [ctx.fix('rewrite', [ctx.replaceRange(0, ctx.text.length, 'int a;\n')])] });
    },
  };
  const insertAt = (offset: number): Check => ({
    name: 'test',
    covers: ['ES.10'],
    run(ctx) {
      ctx.report({ ruleId: 'ES.10', start: 0, end: 1, message: 'x', fixes: [ctx.fix('insert', [ctx.insertAt(offset, '/*x*/')])] });
    },
  });

  it('withholds a fix whose replaced text contains a directive line', async () => {
    const [f] = await run('int a;\n#if X\nint b;\n#endif\n', { checks: [rewriteAll] });
    expect(f.fixes).toEqual([]);
  });

  it('keeps a fix that replaces a single directive line', async () => {
    const [f] = await run('#define A 1\n', { checks: [rewriteAll] });
    expect(f.fixes.length).toBe(1);
  });

  it('withholds a fix that edits unparsable text', async () => {
    const code = 'int a;\nint x = = 3 ));\nint c;\n';
    const [f] = await run(code, { checks: [insertAt(code.indexOf('));') + 1)] });
    expect(f.fixes).toEqual([]);
  });

  it('still fixes an ordinary multiple declaration', async () => {
    const [finding] = await only('void f()\n{\n    int a, b;\n}\n', 'ES.10');
    expect(fixed('void f()\n{\n    int a, b;\n}\n', finding.fixes[0])).toContain('int a;\n    int b;');
  });
});

describe('NL.4 whole-file fix', () => {
  it('leaves the text of multi-line string literals alone', async () => {
    const code = ['void f()', '{', '\tint a = 1;', '        int b = 2;', '\tconst char* s = R"(', '        keep', ')";', '}', ''].join('\n');
    const found = await run(code);
    const mixed = found.find((f) => f.ruleId === 'NL.4' && f.fixes[0]?.title.includes('whole file'));
    expect(mixed).toBeDefined();
    expect(fixed(code, mixed!.fixes[0])).toContain('\n        keep\n');
  });
});

describe('C.21 on a class defined with a qualified name', () => {
  it('uses the unqualified name and recognises the special members already declared', async () => {
    const code = 'class path::iterator\n{\npublic:\n    iterator(const iterator&) = default;\n    iterator& operator=(const iterator&) = default;\n};\n';
    const [finding] = await only(code, 'C.21');
    expect(finding).toBeDefined();
    const out = fixed(code, finding.fixes[0]);
    expect(out).not.toContain('path::iterator(');
    expect(out).not.toContain('~path::');
    expect(out.match(/iterator\(const iterator&\)/g)?.length).toBe(1);
    expect(out).toContain('~iterator() = default;');
  });
});
