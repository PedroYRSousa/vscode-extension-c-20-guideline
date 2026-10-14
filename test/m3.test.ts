import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('T.10 constrained templates', () => {
  it('flags unconstrained type parameters and offers concepts', async () => {
    const code = 'template <typename T> T twice(T x);';
    expect((await only(code, 'T.10')).length).toBe(1);
    const f = (await only(code, 'T.10'))[0];
    expect(f.alsoCovers).toContain('I.9');
    expect(f.fixes.length).toBeGreaterThan(3);
    expect(await firstFix(code, 'T.10')).toContain('template <std::regular T> T twice(T x);');
    expect(await firstFix(code, 'T.10')).toContain('#include <concepts>');
  });
  it('accepts constrained templates, variadics and specializations', async () => {
    expect(await only('template <std::integral T> T f(T);', 'T.10')).toEqual([]);
    expect(await only('template <typename T> requires std::integral<T> T f(T);', 'T.10')).toEqual([]);
    expect(await only('template <typename T> T f(T) requires (sizeof(T) > 1);', 'T.10')).toEqual([]);
    expect(await only('template <typename... Ts> void f(Ts...);', 'T.10')).toEqual([]);
    expect(await only('template <typename T> struct S<T*> {};', 'T.10')).toEqual([]);
    expect(await only('template <typename T> concept C = true;', 'T.10')).toEqual([]);
  });
  it('flags unconstrained auto parameters', async () => {
    expect((await only('void f(auto x);', 'T.10')).length).toBe(1);
    expect((await only('auto l = [](auto x) { return x; };', 'T.10')).length).toBe(1);
    expect(await only('void f(std::integral auto x);', 'T.10')).toEqual([]);
  });
});

describe('T.13 shorthand', () => {
  it('rewrites requires clauses', async () => {
    expect(await firstFix('template <typename T> requires std::integral<T> T f(T);', 'T.13')).toBe('template <std::integral T> T f(T);');
  });
});

describe('T.25 / T.43 / T.61 / T.68 / T.123 / T.143 / T.144', () => {
  it('T.25 flags complementary constraints', async () => {
    const code = 'template <typename T> requires C<T> void f(T); template <typename T> requires (!C<T>) void f(T);';
    expect((await only(code, 'T.25')).length).toBe(1);
    expect(await only('template <typename T> requires C<T> void f(T); template <typename T> requires D<T> void f(T);', 'T.25')).toEqual([]);
  });
  it('T.43 converts typedefs', async () => {
    expect(await firstFix('typedef unsigned long ul;', 'T.43')).toBe('using ul = unsigned long;');
    expect(await firstFix('typedef int* ip;', 'T.43')).toBe('using ip = int*;');
    expect(await firstFix('typedef int (*fp)(int);', 'T.43')).toBe('using fp = int (*)(int);');
  });
  it('T.61 flags member types that ignore a template parameter', async () => {
    expect((await only('template <typename T, typename A> struct S { using V = T; enum E { x }; };', 'T.61')).length).toBe(2);
    expect(await only('template <typename T> struct S { using V = T*; };', 'T.61')).toEqual([]);
  });
  it('T.68 flags T(x) in templates', async () => {
    expect((await only('template <typename T> T f(int x) { return T(x); }', 'T.68')).length).toBe(1);
  });
  it('T.123 flags recursive TMP values', async () => {
    const code = 'template <int N> struct Fact { static const int value = N * Fact<N - 1>::value; };';
    expect((await only(code, 'T.123')).length).toBe(1);
  });
  it('T.143 prefers empty() and !=', async () => {
    expect(await firstFix('bool f(std::vector<int>& v) { return v.size() == 0; }', 'T.143')).toBe('bool f(std::vector<int>& v) { return v.empty(); }');
    expect(await firstFix('bool f(std::vector<int>& v) { return v.size() > 0; }', 'T.143')).toBe('bool f(std::vector<int>& v) { return !v.empty(); }');
    expect(await firstFix('bool f(std::vector<int>* v) { return 0 == v->size(); }', 'T.143')).toBe('bool f(std::vector<int>* v) { return v->empty(); }');
    expect(await firstFix('void f(std::vector<int>& v) { for (auto it = v.begin(); it < v.end(); ++it) {} }', 'T.143')).toContain('it != v.end()');
  });
  it('T.144 flags specializations of function templates', async () => {
    expect((await only('template <> void g<int>(int) {}', 'T.144')).length).toBe(1);
    expect(await only('template <> struct S<int> {};', 'T.144')).toEqual([]);
  });
});
