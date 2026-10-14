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

describe('ES.87 redundant comparisons', () => {
  it('simplifies nullptr comparisons in conditions', async () => {
    expect(await firstFix('void f(int* p) { if (p != nullptr) {} }', 'ES.87')).toBe('void f(int* p) { if (p) {} }');
    expect(await firstFix('void f(int* p) { if (p == nullptr) {} }', 'ES.87')).toBe('void f(int* p) { if (!p) {} }');
    expect(await firstFix('void f(int* p, int* q) { if (p != nullptr && q) {} }', 'ES.87')).toBe('void f(int* p, int* q) { if (p && q) {} }');
  });
  it('does not touch integer comparisons or non-conditions', async () => {
    expect(await only('void f(int n, int* p) { if (n != 0) {} bool b = p != nullptr; }', 'ES.87')).toEqual([]);
  });
  it('simplifies bool comparisons', async () => {
    const f = await only('void f(bool b) { if (b == true) {} }', 'ES.87');
    expect(f.length).toBe(1);
    expect(f[0].fixes[0].safety).toBe('safe');
  });
});

describe('ES.45 magic constants', () => {
  it('flags literals embedded in expressions', async () => {
    expect((await only('int f(int m) { return m <= 12; }', 'ES.45')).length).toBe(1);
  });
  it('allows named constants, allow-listed literals and initializers', async () => {
    expect(await only('constexpr int twelve = 12; int g() { int n = 42; return 0 + 1; }', 'ES.45')).toEqual([]);
  });
});

describe('ES.20 / ES.22 initialization', () => {
  it('flags uninitialized builtins and fixes with {}', async () => {
    expect(await firstFix('void f() { int x; }', 'ES.20')).toBe('void f() { int x{}; }');
    expect(await firstFix('void f() { int* p; }', 'ES.20')).toBe('void f() { int* p{}; }');
  });
  it('does not flag class types, arrays, statics or initialized variables', async () => {
    expect(await only('void f() { std::string s; static int c; int a[4]; int ok = 1; int b{}; }', 'ES.20')).toEqual([]);
  });
  it('merges declaration and assignment (ES.22)', async () => {
    const code = 'int g(); void f() {\n    int x;\n    x = g();\n}\n';
    const f = await only(code, 'ES.22');
    expect(f.length).toBe(1);
    expect(await firstFix(code, 'ES.22')).toBe('int g(); void f() {\n    int x = g();\n}\n');
    expect((await only(code, 'ES.20')).length).toBe(1); // reported once, as ES.22 covering ES.20
  });
});

describe('ES.23 narrowing literals', () => {
  it('flags literals that narrow', async () => {
    expect((await only('void f() { int a = 3.5; char c = 300; unsigned u = -1; short s = 70000; }', 'ES.23')).length).toBe(4);
    expect(await only('void f() { int a = 3; double d = 3; char c = 65; float x = 1.5f; }', 'ES.23')).toEqual([]);
  });
});

describe('ES.41 precedence', () => {
  it('parenthesizes mixed bitwise expressions', async () => {
    expect(await firstFix('bool f(int a, int b) { return a & b == 0; }', 'ES.41')).toBe('bool f(int a, int b) { return a & (b == 0); }');
    expect(await only('int f(int a, int b, int c) { return a & b & c; }', 'ES.41')).toEqual([]);
  });
  it('flags non-leftmost assignments', async () => {
    expect((await only('void f(int a, int b, int c) { a = b = c; }', 'ES.41')).length).toBe(1);
    expect((await only('void f(int c) { int x; while ((x = c) != 0) {} }', 'ES.41')).length).toBe(1);
    expect(await only('void f(int a, int b) { a = b; }', 'ES.41')).toEqual([]);
  });
});

describe('ES.12 shadowing', () => {
  it('flags nested reuse, globals and members', async () => {
    expect((await only('void f(int x) { { int x = 1; } }', 'ES.12')).length).toBe(1);
    expect((await only('int g; void f() { int g = 1; }', 'ES.12')).length).toBe(1);
    expect((await only('struct S { int m; void f() { int m = 1; } };', 'ES.12')).length).toBe(1);
  });
  it('accepts distinct names and sibling scopes', async () => {
    expect(await only('void f() { { int x = 1; } { int x = 2; } }', 'ES.12')).toEqual([]);
  });
});

describe('ES.27 stack arrays', () => {
  it('flags variable bounds', async () => {
    expect((await only('void f(int n) { int a[n]; }', 'ES.27')).length).toBe(1);
    expect(await only('void f() { int a[4]; const int n = 3; int b[n]; }', 'ES.27')).toEqual([]);
  });
});

describe('NL.9 ALL_CAPS names', () => {
  it('flags ALL_CAPS non-macros and enumerators', async () => {
    expect((await only('const int SIZE = 10;', 'NL.9')).length).toBe(1);
    expect((await only('enum bad { BAD, WORSE };', 'Enum.5')).length).toBe(2);
    expect(await only('#define SIZE 10\nint x = SIZE;', 'NL.9')).toEqual([]);
    expect(await only('template <typename T, int N> struct A {};', 'NL.9')).toEqual([]);
  });
});

describe('NL.19 misread names', () => {
  it('flags names made of confusing characters', async () => {
    expect((await only('int oO01lL = 6;', 'NL.19')).length).toBe(1);
  });
});
