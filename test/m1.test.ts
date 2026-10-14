import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('I.2 non-const globals', () => {
  it('flags mutable globals', async () => {
    expect((await only('int counter = 0;', 'I.2')).length).toBe(1);
    expect((await only('namespace n { std::string name; }', 'I.2')).length).toBe(1);
    expect((await only('char* const p = buffer;', 'I.2')).length).toBe(1);
  });
  it('accepts constants, functions and locals', async () => {
    expect(await only('const int a = 1; constexpr int b = 2; const char* const s = "x"; int f(); void g() { static int n = 0; }', 'I.2')).toEqual([]);
  });
  it('offers const as an unsafe fix', async () => {
    const f = (await only('int counter = 0;', 'I.2'))[0];
    expect(f.fixes[0].safety).toBe('unsafe');
  });
});

describe('I.3 singletons', () => {
  it('flags singleton classes and instance accessors', async () => {
    expect((await only('class Config_singleton {};', 'I.3')).length).toBe(1);
    expect((await only('class A { public: static A& instance() { static A a; return a; } };', 'I.3')).length).toBe(1);
  });
});

describe('I.4 typed interfaces', () => {
  it('flags void* and several bool parameters', async () => {
    expect((await only('void f(void* p); void* g();', 'I.4')).length).toBe(2);
    expect((await only('void f(bool a, bool b);', 'I.4')).length).toBe(1);
    expect(await only('void f(bool a, int b); void* operator new(size_t);', 'I.4')).toEqual([]);
  });
});

describe('error handling', () => {
  it('E.14 flags throwing built-in types', async () => {
    expect((await only('void f() { throw 1; throw "x"; throw std::exception(); }', 'E.14')).length).toBe(3);
    expect(await only('void f() { throw std::runtime_error("x"); throw my_error{}; }', 'E.14')).toEqual([]);
  });
  it('E.15 catches by reference', async () => {
    expect(await firstFix('void f() { try { g(); } catch (std::exception e) {} }', 'E.15')).toBe('void f() { try { g(); } catch (const std::exception& e) {} }');
    expect(await only('void f() { try { g(); } catch (const std::exception& e) {} catch (int) {} }', 'E.15')).toEqual([]);
    expect((await only('void f() { throw new std::runtime_error("x"); }', 'E.15')).length).toBe(1);
  });
  it('E.31 orders handlers', async () => {
    expect((await only('void f() { try { g(); } catch (...) {} catch (std::exception&) {} }', 'E.31')).length).toBe(1);
    expect((await only('void f() { try { g(); } catch (std::exception&) {} catch (std::runtime_error&) {} }', 'E.31')).length).toBe(1);
    expect(await only('void f() { try { g(); } catch (std::runtime_error&) {} catch (std::exception&) {} catch (...) {} }', 'E.31')).toEqual([]);
  });
  it('E.17 flags nested try blocks', async () => {
    expect((await only('void f() { try { try { g(); } catch (...) {} } catch (...) {} }', 'E.17')).length).toBe(1);
  });
  it('E.28 flags errno', async () => {
    expect((await only('void f() { if (errno != 0) {} }', 'E.28')).length).toBe(1);
  });
  it('E.30 replaces exception specifications', async () => {
    expect(await firstFix('void f() throw();', 'E.30')).toBe('void f() noexcept;');
    expect(await firstFix('void f() throw(std::bad_alloc);', 'E.30')).toBe('void f();');
  });
});

describe('const and constexpr', () => {
  it('Con.4 flags unmodified locals', async () => {
    expect(await firstFix('int f(int a) { int x = a + 1; return x * 2; }', 'Con.4')).toBe('int f(int a) { const int x = a + 1; return x * 2; }');
    expect(await only('int f(int a) { int x = a; x++; return x; }', 'Con.4')).toEqual([]);
    expect(await only('void g(int&); int f(int a) { int x = a; g(x); return x; }', 'Con.4')).toEqual([]);
  });
  it('Con.5 prefers constexpr', async () => {
    expect(await firstFix('const int size = 10;', 'Con.5')).toBe('constexpr int size = 10;');
    expect(await only('const int n = f();', 'Con.5')).toEqual([]);
  });
  it('Con.3 flags read-only references', async () => {
    expect((await only('int f(int& x) { return x + 1; }', 'Con.3')).length).toBe(1);
    expect(await only('void f(int& x) { x = 1; }', 'Con.3')).toEqual([]);
  });
  it('Con.2 flags member functions that only read', async () => {
    expect((await only('class A { int x_; public: int twice() { return x_ * 2; } };', 'Con.2')).length).toBe(1);
    expect(await only('class A { int x_; public: void set(int v) { x_ = v; } };', 'Con.2')).toEqual([]);
  });
});

describe('CPL.1 / P.2 / P.9 / Per.11', () => {
  it('CPL.1 prefers <cstdio>', async () => {
    expect(await firstFix('#include <stdio.h>\n', 'CPL.1')).toBe('#include <cstdio>\n');
  });
  it('P.2 flags compiler extensions', async () => {
    expect((await only('int __attribute__((noreturn)) f();', 'P.2')).length).toBeGreaterThan(0);
    expect((await only('void f() { __builtin_trap(); }', 'P.2')).length).toBe(1);
  });
  it('P.9 prefers prefix increment of iterators', async () => {
    const code = 'void f(std::vector<int>& v) { for (auto it = v.begin(); it != v.end(); it++) {} }';
    expect(await firstFix(code, 'P.9')).toBe('void f(std::vector<int>& v) { for (auto it = v.begin(); it != v.end(); ++it) {} }');
    expect(await only('void f() { for (int i = 0; i < 3; i++) {} }', 'P.9')).toEqual([]);
  });
  it('Per.11 suggests constexpr', async () => {
    expect(await firstFix('int square(int x) { return x * x; }', 'Per.11')).toBe('constexpr int square(int x) { return x * x; }');
    expect(await only('int f(int x) { return g(x); }', 'Per.11')).toEqual([]);
  });
});
