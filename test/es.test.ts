import { describe, expect, it } from 'vitest';
import { firstFix, ids, only, run } from './helpers';

describe('ES.47 nullptr', () => {
  it('flags NULL and fixes it', async () => {
    const code = 'int* f() { int* p = NULL; return p; }';
    expect(await ids(code)).toContain('ES.47');
    expect(await firstFix(code, 'ES.47')).toBe('int* f() { int* p = nullptr; return p; }');
  });
  it('flags 0 used as a pointer', async () => {
    expect((await only('void f(int* p) { p = 0; if (p == 0) {} }', 'ES.47')).length).toBe(2);
    expect((await only('int* f() { return 0; }', 'ES.47')).length).toBe(1);
    expect((await only('int* p = 0; void g(int* q = 0);', 'ES.47')).length).toBe(2);
  });
  it('does not flag integers', async () => {
    expect(await only('int f(int x) { x = 0; return 0; }', 'ES.47')).toEqual([]);
  });
  it('does not flag nullptr', async () => {
    expect(await only('int* p = nullptr;', 'ES.47')).toEqual([]);
  });
});

describe('ES.10 one name per declaration', () => {
  it('splits declarations', async () => {
    const code = 'void f() {\n    int a = 1, *b = nullptr;\n}\n';
    const fixed = await firstFix(code, 'ES.10');
    expect(fixed).toBe('void f() {\n    int a = 1;\n    int* b = nullptr;\n}\n');
  });
  it('splits pointer declarators', async () => {
    expect(await firstFix('void f() { int* p, q; }', 'ES.10')).toBe('void f() { int* p;\n    int q; }'.replace('\n    ', '\n'));
  });
  it('reports NL.21 as covered', async () => {
    const f = await only('int a, b;', 'NL.21');
    expect(f.length).toBe(1);
  });
  it('ignores single declarations and function declarations', async () => {
    expect(await only('int a; void f(), g();', 'ES.10')).toEqual([]);
  });
});

describe('macros', () => {
  it('flags constant and function-like macros but not guards', async () => {
    const code = '#define GUARD_H\n#define N 10\n#define SQ(x) ((x)*(x))\n';
    const f = await run(code);
    const es31 = f.filter((x) => x.ruleId === 'ES.31');
    expect(es31.length).toBe(2);
    expect(es31[0].alsoCovers).toContain('Enum.1');
    expect(es31[1].alsoCovers).not.toContain('Enum.1');
  });
  it('replaces constants by constexpr and renames uses', async () => {
    const code = '#define MAX_SIZE 10\nint a[MAX_SIZE];\n';
    expect(await firstFix(code, 'ES.31')).toBe('inline constexpr auto max_size = 10;\nint a[max_size];\n');
  });
  it('requires ALL_CAPS macro names', async () => {
    const f = await only('#define lower\n', 'NL.9');
    expect(f.length).toBe(1);
    expect(f[0].ruleId).toBe('ES.32');
  });
});

describe('ES.34 / F.55 variadics', () => {
  it('flags C-style variadic definitions only', async () => {
    expect((await only('void f(const char*, ...) {}', 'ES.34')).length).toBe(1);
    expect(await only('void f(const char*, ...);', 'ES.34')).toEqual([]);
    expect(await only('template <typename... Ts> void f(Ts... ts) {}', 'ES.34')).toEqual([]);
  });
  it('flags <cstdarg> and va_*', async () => {
    const f = await run('#include <cstdarg>\nvoid g() { va_list ap; }');
    expect(f.map((x) => x.ruleId)).toContain('F.55');
    expect(f.filter((x) => x.ruleId === 'ES.34').length).toBe(1);
  });
});

describe('casts', () => {
  it('fixes C-style casts', async () => {
    expect(await firstFix('int f(double d) { return (int)d; }', 'ES.49')).toBe('int f(double d) { return static_cast<int>(d); }');
    expect(await firstFix('int f(double d) { return (int)(d * 2); }', 'ES.49')).toBe('int f(double d) { return static_cast<int>(d * 2); }');
  });
  it('flags const_cast and reinterpret_cast', async () => {
    expect((await only('void f(const int& r) { const_cast<int&>(r) = 1; }', 'ES.50')).length).toBe(1);
    expect((await only('void f(long l) { auto p = reinterpret_cast<char*>(l); }', 'ES.48')).length).toBe(1);
  });
  it('flags functional casts of builtin types only', async () => {
    expect((await only('int f(double d) { return int(d); }', 'ES.64')).length).toBe(1);
    expect(await firstFix('int f(double d) { return int(d); }', 'ES.64')).toBe('int f(double d) { return static_cast<int>(d); }');
    expect(await only('int g(); int f() { return g(); }', 'ES.64')).toEqual([]);
  });
});

describe('ES.75 / ES.76', () => {
  it('flags do and goto', async () => {
    const f = await run('void f() { do { } while (0); goto end; end:; }');
    expect(f.map((x) => x.ruleId)).toEqual(expect.arrayContaining(['ES.75', 'ES.76']));
  });
});

describe('ES.78 fallthrough', () => {
  const code = 'void f(int c) {\n    switch (c) {\n    case 1:\n        a();\n    case 2:\n        b();\n        break;\n    }\n}\n';
  it('flags implicit fallthrough and offers [[fallthrough]]', async () => {
    const f = await only(code, 'ES.78');
    expect(f.length).toBe(1);
    expect(await firstFix(code, 'ES.78')).toContain('a();\n        [[fallthrough]];\n    case 2:');
  });
  it('accepts jumps, grouped labels, explicit fallthrough and the last case', async () => {
    expect(await only('void f(int c) { switch (c) { case 1: case 2: a(); return; case 3: { b(); break; } case 4: [[fallthrough]]; default: d(); } }', 'ES.78')).toEqual([]);
  });
});

describe('ES.79 / Enum.2 switch over enumeration', () => {
  it('flags unhandled enumerators and adds them', async () => {
    const code = 'enum class Color { red, green, blue };\nvoid f(Color c) {\n    switch (c) {\n    case Color::red:\n        break;\n    }\n}\n';
    const f = await only(code, 'ES.79');
    expect(f.length).toBe(1);
    const fixed = await firstFix(code, 'ES.79');
    expect(fixed).toContain('case Color::green:');
    expect(fixed).toContain('case Color::blue:');
  });
  it('accepts default and complete switches', async () => {
    expect(await only('enum E { A, B }; void f(E e) { switch (e) { case A: break; default: break; } }', 'ES.79')).toEqual([]);
    expect(await only('enum E { A, B }; void f(E e) { switch (e) { case A: break; case B: break; } }', 'ES.79')).toEqual([]);
  });
});

describe('ES.85 empty statements', () => {
  it('flags and fixes', async () => {
    expect(await firstFix('void f(int x) { while (x--) ; }', 'ES.85')).toBe('void f(int x) { while (x--) {} }');
    expect(await firstFix('void f() { g();; }', 'ES.85')).toBe('void f() { g(); }');
  });
});

describe('ES.105', () => {
  it('flags division by literal zero', async () => {
    expect((await only('int f(int x) { return x / 0; }', 'ES.105')).length).toBe(1);
    expect(await only('double f(double x) { return x / 2.0; }', 'ES.105')).toEqual([]);
  });
});

describe('suppressions', () => {
  it('suppresses with a justification on the same line', async () => {
    const f = await run('int* p = NULL; // cpp20-guideline: ignore ES.47 -- legacy C API requires it\n');
    expect(f.filter((x) => x.ruleId === 'ES.47')).toEqual([]);
  });
  it('suppresses the next line when the comment is alone', async () => {
    const f = await run('// cpp20-guideline: ignore ES.47 -- legacy\nint* p = NULL;\nint* q = NULL;\n');
    expect(f.filter((x) => x.ruleId === 'ES.47').length).toBe(1);
  });
  it('rejects a suppression without justification', async () => {
    const f = await run('int* p = NULL; // cpp20-guideline: ignore ES.47\n');
    expect(f.map((x) => x.ruleId)).toEqual(expect.arrayContaining(['ES.47', 'CPP20.suppress']));
  });
  it('rejects unknown rule ids', async () => {
    const f = await run('int x; // cpp20-guideline: ignore ZZ.99 -- nope\n');
    expect(f.map((x) => x.ruleId)).toContain('CPP20.suppress');
  });
});

describe('severity and options', () => {
  it('drops warnings when optional warnings are disabled', async () => {
    const code = 'void f() { do { } while (0); }'; // ES.75 is a warning
    expect((await only(code, 'ES.75')).length).toBe(1);
    expect(await only(code, 'ES.75', { config: { enableOptionalWarnings: false } })).toEqual([]);
  });
  it('keeps errors when optional warnings are disabled', async () => {
    expect((await only('int* p = NULL;', 'ES.47', { config: { enableOptionalWarnings: false } })).length).toBe(1);
  });
  it('uses UTF-16 offsets', async () => {
    const code = 'const char* s = "é😀"; int* p = NULL;';
    const f = await only(code, 'ES.47');
    expect(code.slice(f[0].start, f[0].end)).toBe('NULL');
  });
});
