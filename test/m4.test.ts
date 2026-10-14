import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('F.24 / P.6 (pointer, count)', () => {
  it('suggests std::span and rewrites the count', async () => {
    const code = 'int sum(const int* p, int n)\n{\n    int s{};\n    for (int i = 0; i < n; ++i) {\n        s += p[i];\n    }\n    return s;\n}\n';
    const f = await only(code, 'F.24');
    expect(f.length).toBe(1);
    expect(f[0].alsoCovers).toContain('P.6');
    const fixed = await firstFix(code, 'F.24');
    expect(fixed).toContain('int sum(std::span<const int> p)');
    expect(fixed).toContain('i < p.size()');
    expect(fixed).toContain('#include <span>');
  });
  it('ignores unrelated pointer/int pairs', async () => {
    expect(await only('void f(Widget* w, int flags);', 'F.24')).toEqual([]);
    expect((await only('void f(char* buf, std::size_t len);', 'F.24')).length).toBe(1);
  });
});

describe('ES.73 / ES.86 for-loops', () => {
  it('prefers while when there is no loop variable', async () => {
    expect(await firstFix('void f(bool done) { for (; done;) { g(); } }', 'ES.73')).toBe('void f(bool done) { while (done) { g(); } }');
    expect((await only('void f(Node* n) { for (int i = 0; n; n = n->next) { ++i; } }', 'ES.73')).length).toBeGreaterThanOrEqual(0);
    expect(await only('void f() { for (int i = 0; i < 3; ++i) { g(); } }', 'ES.73')).toEqual([]);
  });
  it('flags modification of the loop variable in the body', async () => {
    expect((await only('void f() { for (int i = 0; i < 9; ++i) { if (g()) { i += 2; } } }', 'ES.86')).length).toBe(1);
    expect(await only('void f() { for (int i = 0; i < 9; ++i) { g(i); } }', 'ES.86')).toEqual([]);
  });
});

describe('ES.11 auto', () => {
  it('replaces repeated type names', async () => {
    expect(await firstFix('void f() { Widget w = Widget(1); }', 'ES.11')).toBe('void f() { auto w = Widget(1); }');
    expect(await firstFix('void f() { Widget* p = new Widget; }', 'ES.11')).toBe('void f() { auto p = new Widget; }');
    expect(await firstFix('void f() { std::unique_ptr<Widget> p = std::make_unique<Widget>(); }', 'ES.11')).toBe('void f() { auto p = std::make_unique<Widget>(); }');
    expect(await only('void f() { Base* p = new Derived; auto q = Widget(); }', 'ES.11')).toEqual([]);
  });
});

describe('C.41 fully initialized objects', () => {
  it('flags constructors that leave members uninitialized', async () => {
    const code = 'struct S {\n    S() {}\n    int a;\n    double b;\n};\n';
    expect((await only(code, 'C.41')).length).toBe(1);
    expect(await firstFix(code, 'C.41')).toContain('int a{};');
    expect(await only('struct S { S() : a(0) { b = 1.0; } int a; double b; };', 'C.41')).toEqual([]);
    expect(await only('struct S { S() : S(0) {} S(int x) : a(x), b(0) {} int a; double b; };', 'C.41')).toEqual([]);
    expect(await only('struct S { S() {} int a{}; };', 'C.41')).toEqual([]);
  });
});
