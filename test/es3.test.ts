import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('ES.42 simple pointers', () => {
  it('flags pointer arithmetic', async () => {
    expect((await only('void f(int* p) { p++; auto q = p + 1; p += 2; }', 'ES.42')).length).toBe(3);
  });
  it('allows pointer difference and non-pointers', async () => {
    expect(await only('long f(int* p, int* q, int n) { n++; return p - q; }', 'ES.42')).toEqual([]);
  });
  it('flags unchecked array indexing', async () => {
    expect((await only('void f(int i) { int a[4]; a[i] = 1; a[2] = 3; a[9] = 1; }', 'ES.42')).length).toBe(2);
  });
  it('offers at() for std::array', async () => {
    expect(await firstFix('void f(int i) { std::array<int, 4> a; a[i] = 1; }', 'ES.42')).toBe('void f(int i) { std::array<int, 4> a; a.at(i) = 1; }');
  });
});

describe('ES.43 / ES.44 order of evaluation', () => {
  it('flags a variable modified and used in different arguments', async () => {
    expect((await only('void f(int i) { g(i++, i); }', 'ES.44')).length).toBe(1);
    expect(await only('void f(int i, int j) { g(i++, j); }', 'ES.44')).toEqual([]);
  });
  it('flags modified-and-used operands', async () => {
    expect((await only('int f(int i) { return i + i++; }', 'ES.43')).length).toBe(1);
    expect(await only('bool f(int* p, int i) { return p && i++; }', 'ES.43')).toEqual([]);
  });
});

describe('ES.46 lossy conversions', () => {
  it('flags float to int and offers static_cast', async () => {
    const code = 'void f(double d) { int i = d; }';
    expect((await only(code, 'ES.46')).length).toBe(1);
    expect(await firstFix(code, 'ES.46')).toBe('void f(double d) { int i = static_cast<int>(d); }');
  });
  it('allows widening', async () => {
    expect(await only('void f(int i) { double d = i; long l = i; }', 'ES.46')).toEqual([]);
  });
});

describe('ES.100 / ES.102 signed and unsigned', () => {
  it('flags int compared with size() and offers std::ssize', async () => {
    const code = 'void f(std::vector<int>& v) { for (int i = 0; i < v.size(); ++i) {} }';
    expect((await only(code, 'ES.100')).length).toBe(1);
    const fixed = await firstFix(code, 'ES.100');
    expect(fixed).toContain('i < std::ssize(v)');
    expect(fixed).toContain('#include <iterator>');
  });
  it('allows ptrdiff_t against size()', async () => {
    expect(await only('void f(std::vector<int>& v) { for (std::ptrdiff_t i = 0; i < v.size(); ++i) {} }', 'ES.100')).toEqual([]);
  });
  it('flags mixed signed and unsigned variables', async () => {
    expect((await only('bool f(int a, unsigned b) { return a < b; }', 'ES.100')).length).toBe(1);
    expect(await only('bool f(int a, int b) { return a < b; }', 'ES.100')).toEqual([]);
  });
});

describe('ES.71 range-for', () => {
  it('converts an index loop', async () => {
    const code = 'void f(std::vector<int>& v) {\n    for (int i = 0; i < v.size(); ++i) {\n        use(v[i]);\n    }\n}\n';
    const fixed = await firstFix(code, 'ES.71');
    expect(fixed).toBe('void f(std::vector<int>& v) {\n    for (auto& element : v) {\n        use(element);\n    }\n}\n');
  });
  it('uses const when elements are only read', async () => {
    const code = 'bool f(std::vector<int>& v, int x) { for (int i = 0; i < v.size(); ++i) { if (v[i] == x) return true; } return false; }';
    expect(await firstFix(code, 'ES.71')).toContain('for (const auto& element : v) { if (element == x)');
  });
  it('uses a mutable reference when elements are modified', async () => {
    const code = 'void f(std::vector<int>& v) { for (std::size_t i = 0; i < v.size(); i++) { v[i] += 1; } }';
    expect(await firstFix(code, 'ES.71')).toBe('void f(std::vector<int>& v) { for (auto& element : v) { element += 1; } }');
  });
  it('converts an iterator loop', async () => {
    const code = 'void f(std::vector<int>& v) { for (auto it = v.begin(); it != v.end(); ++it) { use(*it); } }';
    expect(await firstFix(code, 'ES.71')).toBe('void f(std::vector<int>& v) { for (auto& element : v) { use(element); } }');
  });
  it('leaves loops that need the index or modify the container', async () => {
    expect(await only('void f(std::vector<int>& v) { for (int i = 0; i < v.size(); ++i) { use(i, v[i]); } }', 'ES.71')).toEqual([]);
    expect(await only('void f(std::vector<int>& v) { for (int i = 0; i < v.size(); ++i) { v.push_back(v[i]); } }', 'ES.71')).toEqual([]);
  });
});

describe('ES.6 loop variable scope', () => {
  it('moves the declaration into the for', async () => {
    const code = 'void f() {\n    int i;\n    for (i = 0; i < 3; ++i) {}\n}\n';
    expect(await firstFix(code, 'ES.6')).toBe('void f() {\n    for (int i = 0; i < 3; ++i) {}\n}\n');
  });
  it('keeps the variable when it is used after the loop', async () => {
    expect(await only('int f() { int i; for (i = 0; i < 3; ++i) {} return i; }', 'ES.6')).toEqual([]);
  });
});

describe('ES.84 / CP.44 unnamed temporaries', () => {
  it('flags unnamed locks', async () => {
    const code = 'void f(std::mutex& m) {\n    std::lock_guard<std::mutex>{m};\n}\n';
    expect((await only(code, 'CP.44')).length).toBe(1);
    expect(await firstFix(code, 'CP.44')).toContain('std::lock_guard<std::mutex> lock{m};');
  });
});
