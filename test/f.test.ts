import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('F.3 function size', () => {
  it('flags long, wide and complex functions', async () => {
    const long = 'void f() {\n' + '    g();\n'.repeat(70) + '}\n';
    expect((await only(long, 'F.3')).length).toBe(1);
    const complex = 'int f(int a) {\n' + '    if (a == 1) return 1;\n'.repeat(11) + '    return 0;\n}\n';
    expect((await only(complex, 'F.3')).length).toBe(1);
    expect(await only('int f(int a) { if (a) return 1; return 0; }', 'F.3')).toEqual([]);
  });
  it('honours the configured thresholds', async () => {
    const code = 'void f() {\n    a();\n    b();\n    c();\n}\n';
    expect((await only(code, 'F.3', { config: { thresholds: { maxFunctionLines: 3, maxFunctionColumns: 140, maxCyclomaticComplexity: 10, digitSeparatorMinDigits: 7, maxParameters: 6 } } })).length).toBe(1);
  });
});

describe('F.2 parameters', () => {
  it('flags functions with too many parameters', async () => {
    expect((await only('void f(int a, int b, int c, int d, int e, int f, int g);', 'F.2')).length).toBe(1);
    expect(await only('void f(int a, int b);', 'F.2')).toEqual([]);
  });
});

describe('noexcept rules', () => {
  it('adds noexcept to swap', async () => {
    expect(await firstFix('struct X { void swap(X& o); };', 'C.85')).toBe('struct X { void swap(X& o) noexcept; };');
    expect(await only('struct X { void swap(X& o) noexcept; };', 'C.85')).toEqual([]);
  });
  it('adds noexcept to move operations', async () => {
    const code = 'struct X { X(X&& o); X& operator=(X&& o); X(const X&); };';
    expect((await only(code, 'C.66')).length).toBe(2);
    expect(await firstFix('struct X { X(X&& o) : a(o.a) {} int a; };', 'C.66')).toBe('struct X { X(X&& o) noexcept : a(o.a) {} int a; };');
    expect(await only('struct X { X(X&& o) = default; };', 'C.66')).toEqual([]);
  });
  it('flags a throwing destructor', async () => {
    expect((await only('struct X { ~X() { throw 1; } };', 'C.37')).length).toBe(1);
    expect(await only('struct X { ~X() { try { throw 1; } catch (...) {} } };', 'C.37')).toEqual([]);
  });
  it('flags a throwing default constructor (C.44)', async () => {
    expect((await only('struct X { X() { throw 1; } };', 'C.44')).length).toBe(1);
  });
  it('handles out-of-line move constructors', async () => {
    expect((await only('X::X(X&& o) {}', 'C.66')).length).toBe(1);
  });
});

describe('F.9 unused parameters', () => {
  it('comments out unused names', async () => {
    expect(await firstFix('int f(int a, int b) { return a; }', 'F.9')).toBe('int f(int a, int /*b*/) { return a; }');
    expect(await only('int f(int a, int b) { return a + b; }', 'F.9')).toEqual([]);
    expect(await only('int f([[maybe_unused]] int a) { return 0; }', 'F.9')).toEqual([]);
    expect(await only('int f(int);', 'F.9')).toEqual([]);
  });
  it('checks lambdas', async () => {
    expect((await only('auto l = [](int x) { return 1; };', 'F.9')).length).toBe(1);
  });
});

describe('F.16 / F.17 in parameters', () => {
  it('passes cheap types by value', async () => {
    expect(await firstFix('void f(const int& x);', 'F.16')).toBe('void f(int x);');
    expect(await firstFix('void f(const double& x = 1.5);', 'F.16')).toBe('void f(double x = 1.5);');
    expect(await only('void f(const std::string& s);', 'F.16')).toEqual([]);
  });
  it('flags moved const references and in-out references', async () => {
    expect((await only('void f(const std::string& s) { g(std::move(s)); }', 'F.16')).length).toBe(1);
    expect((await only('void f(std::string& s) { g(std::move(s)); }', 'F.17')).length).toBe(1);
  });
  it('flags big arrays by value', async () => {
    expect((await only('void f(std::array<int, 100> a);', 'F.16')).length).toBe(1);
  });
});

describe('F.18 / F.19 / ES.56', () => {
  it('requires std::move on X&& parameters', async () => {
    expect((await only('void f(std::string&& s) { g(s); }', 'F.18')).length).toBe(1);
    expect(await only('void f(std::string&& s) { g(std::move(s)); }', 'F.18')).toEqual([]);
  });
  it('requires std::forward on forwarding references', async () => {
    expect(await only('template <typename T> void f(T&& t) { g(std::forward<T>(t)); }', 'F.19')).toEqual([]);
    expect((await only('template <typename T> void f(T&& t) { g(t); }', 'F.19')).length).toBe(1);
    expect((await only('template <typename T> void f(T&& t) { g(std::forward<T>(t)); h(std::forward<T>(t)); }', 'F.19')).length).toBe(1);
    expect(await only('template <typename T> void f(T&& t, bool b) { if (b) g(std::forward<T>(t)); else h(std::forward<T>(t)); }', 'F.19')).toEqual([]);
  });
  it('flags std::move of a forwarding reference', async () => {
    expect((await only('template <typename T> void f(T&& t) { g(std::move(t)); }', 'ES.56')).length).toBe(1);
  });
});

describe('return types', () => {
  it('F.21 flags pair and tuple', async () => {
    expect((await only('std::pair<int, int> f();', 'F.21')).length).toBe(1);
  });
  it('F.45 flags T&& returns', async () => {
    expect((await only('int&& f();', 'F.45')).length).toBe(1);
    expect(await only('T&& move(T& t);', 'F.45')).toEqual([]);
  });
  it('F.46 fixes main', async () => {
    expect(await firstFix('void main() { return; }', 'F.46')).toBe('int main() { return 0; }');
  });
  it('F.49 removes const from value returns', async () => {
    expect(await firstFix('const int f();', 'F.49')).toBe('int f();');
    expect(await only('const int* f(); const std::string& g();', 'F.49')).toEqual([]);
  });
  it('F.47 fixes assignment operators', async () => {
    const code = 'struct X {\n    void operator=(const X& o) {\n        a = o.a;\n    }\n    int a;\n};\n';
    const fixed = await firstFix(code, 'F.47');
    expect(fixed).toContain('X& operator=(const X& o) {');
    expect(fixed).toContain('return *this;');
    expect(await only('struct X { X& operator=(const X&); };', 'F.47')).toEqual([]);
    expect(await firstFix('struct X { const X& operator=(const X&); };', 'F.47')).toBe('struct X { X& operator=(const X&); };');
  });
});

describe('F.51 default arguments', () => {
  it('flags prefix overloads', async () => {
    expect((await only('void f(int); void f(int, const std::string&);', 'F.51')).length).toBe(1);
    expect(await only('void f(int); void f(double);', 'F.51')).toEqual([]);
  });
});

describe('F.48 / F.43 locals', () => {
  it('removes std::move on returned locals', async () => {
    expect(await firstFix('std::string f() { std::string s; return std::move(s); }', 'F.48')).toBe('std::string f() { std::string s; return s; }');
    expect(await only('std::string f(std::string&& s) { return std::move(s); }', 'F.48')).toEqual([]);
  });
  it('flags pointers and references to locals', async () => {
    expect((await only('int* f() { int x = 1; return &x; }', 'F.43')).length).toBe(1);
    expect((await only('int& f() { int x = 1; return x; }', 'F.43')).length).toBe(1);
    expect((await only('int* f() { int a[3]; return a; }', 'F.43')).length).toBe(1);
    expect(await only('int& f(int& p) { return p; }', 'F.43')).toEqual([]);
    expect(await only('int& f() { static int x = 1; return x; }', 'F.43')).toEqual([]);
  });
});

describe('lambdas', () => {
  it('F.54 flags [=] with this', async () => {
    const code = 'struct S { int m_; void f() { auto l = [=] { return m_; }; } };';
    expect((await only(code, 'F.54')).length).toBe(1);
    expect(await firstFix(code, 'F.54')).toContain('[this]');
    expect(await only('struct S { int m_; void f() { auto l = [this] { return m_; }; } };', 'F.54')).toEqual([]);
  });
  it('F.53 flags by-reference captures that escape', async () => {
    expect((await only('auto f() { int x = 1; return [&] { return x; }; }', 'F.53')).length).toBe(1);
    expect((await only('void f() { int x = 1; std::thread t([&x] { g(x); }); }', 'F.53')).length).toBe(1);
    expect(await only('void f(std::vector<int>& v) { int x = 1; std::for_each(v.begin(), v.end(), [&](int i) { x += i; }); }', 'F.53')).toEqual([]);
  });
  it('F.50 converts capture-less named lambdas at namespace scope', async () => {
    const code = 'auto square = [](int i) { return i * i; };';
    expect((await only(code, 'F.50')).length).toBe(1);
    expect(await firstFix(code, 'F.50')).toBe('auto square(int i) { return i * i; }');
    expect(await only('void f() { auto g = [](int i) { return i; }; }', 'F.50')).toEqual([]);
  });
});

describe('F.56 nesting', () => {
  it('removes a redundant else', async () => {
    const code = 'int f(int a) {\n    if (a) {\n        return 1;\n    } else {\n        g();\n        return 2;\n    }\n}\n';
    const fixed = await firstFix(code, 'F.56');
    expect(fixed).toBe('int f(int a) {\n    if (a) {\n        return 1;\n    }\n    g();\n    return 2;\n}\n');
  });
  it('flags a function that is one big if', async () => {
    expect((await only('void f(int a) { if (a) { g(); } }', 'F.56')).length).toBe(1);
  });
  it('keeps meaningful else', async () => {
    expect(await only('int f(int a) { if (a) { g(); } else { h(); } return 0; }', 'F.56')).toEqual([]);
  });
});
