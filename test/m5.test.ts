import { describe, expect, it } from 'vitest';
import { only } from './helpers';

describe('ES.63 slicing', () => {
  it('flags copying a derived object into a base object', async () => {
    const code = 'struct B { int x; }; struct D : B { int y; }; void f() { D d; B b = d; }';
    expect((await only(code, 'ES.63')).length).toBe(1);
    expect((await only('struct B { int x; }; struct D : B {}; void f(D d, B b) { b = d; }', 'ES.63')).length).toBe(1);
    expect(await only('struct B { int x; }; struct D : B {}; void f() { D d; B& b = d; B* p = &d; }', 'ES.63')).toEqual([]);
    expect(await only('struct B {}; struct D : B { int y; }; void f() { D d; B b = d; }', 'ES.63')).toEqual([]);
  });
});

describe('ES.70 switch instead of if-chains', () => {
  it('flags chains of three comparisons with constants', async () => {
    const chain = 'void f(int c) { if (c == 1) a(); else if (c == 2) b(); else if (c == 3) d(); else e(); }';
    expect((await only(chain, 'ES.70')).length).toBe(1);
    expect(await only('void f(int c) { if (c == 1) a(); else if (c == 2) b(); }', 'ES.70')).toEqual([]);
    expect(await only('void f(int c, int d) { if (c == 1) a(); else if (d == 2) b(); else if (c == 3) e(); }', 'ES.70')).toEqual([]);
  });
});

describe('T.83 virtual member templates', () => {
  it('flags', async () => {
    expect((await only('struct S { template <typename T> virtual void f(T); };', 'T.83')).length).toBe(1);
    expect(await only('struct S { template <typename T> void f(T); virtual void g(); };', 'T.83')).toEqual([]);
  });
});

describe('SF.22 internal linkage', () => {
  it('flags static at namespace scope in source files only', async () => {
    expect((await only('static int helper();\nstatic int counter = 0;\n', 'SF.22', { path: 'a.cpp' })).length).toBe(2);
    expect(await only('struct S { static int f(); };\nvoid g() { static int x = 0; }\n', 'SF.22', { path: 'a.cpp' })).toEqual([]);
    expect(await only('static int helper();\n', 'SF.22', { path: 'a.h' })).toEqual([]);
  });
});

describe('umbrella rules covered by the same diagnostics', () => {
  it('R.11 findings also cover P.8 / F.26', async () => {
    const f = await only('int* make() { return new int(1); }', 'R.11');
    expect(f[0].alsoCovers).toEqual(expect.arrayContaining(['P.8', 'F.26']));
  });
  it('goto exit covers E.19', async () => {
    const f = await only('void f() { goto exit; exit:; }', 'ES.76');
    expect(f[0].alsoCovers).toContain('E.19');
  });
});

describe('GSL integration (answer 4A)', () => {
  const gsl = { config: { gslEnabled: true } };
  it('is silent about not_null when the GSL is disabled', async () => {
    expect(await only('void f(int* p) { if (!p) return; use(*p); }', 'I.12')).toEqual([]);
  });
  it('I.12 suggests gsl::not_null for guarded pointers when enabled', async () => {
    const f = await only('void f(int* p) { if (p == nullptr) return; use(*p); }', 'I.12', gsl);
    expect(f.length).toBe(1);
    expect(f[0].alsoCovers).toContain('F.23');
    expect(f[0].fixes[0].edits[0].text).toBe('gsl::not_null<int*> p');
    expect((await only('void f(int* p) { Expects(p != nullptr); use(*p); }', 'I.12', gsl)).length).toBe(1);
    expect(await only('void f(int* p) { use(p); }', 'I.12', gsl)).toEqual([]);
  });
  it('R.20 accepts gsl::owner and offers it as an alternative', async () => {
    expect(await only('void f() { gsl::owner<int*> p = new int; delete p; }', 'R.20')).toEqual([]);
    const off = await only('void f() { int* p = new int; delete p; }', 'R.20');
    expect(off[0].fixes.map((x) => x.title)).not.toContain('Mark the pointer as gsl::owner');
    const on = await only('void f() { int* p = new int; delete p; }', 'R.20', gsl);
    expect(on[0].fixes.map((x) => x.title)).toContain('Mark the pointer as gsl::owner');
    const applied = on[0].fixes.find((x) => x.title.startsWith('Mark'))!;
    expect(applied.edits[0].text).toBe('gsl::owner<int*> ');
  });
});
