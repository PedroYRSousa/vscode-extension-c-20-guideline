import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';
import { convertPrintfFormat } from '../src/rules/m2';

const header = { path: 'include/mylib/foo.h' };

describe('NL.27 file suffixes', () => {
  it('flags unconventional suffixes only', async () => {
    expect((await only('int x;', 'NL.27', { path: 'a.cp' })).length).toBe(1);
    expect(await only('int x;', 'NL.27', { path: 'a.cpp' })).toEqual([]);
    expect(await only('int x;', 'NL.27', { path: 'a.hpp' })).toEqual([]);
  });
});

describe('SF.8 include guards', () => {
  it('adds a guard', async () => {
    const fixed = await firstFix('int f();\n', 'SF.8', header);
    expect(fixed).toBe('#ifndef MYLIB_FOO_H\n#define MYLIB_FOO_H\n\nint f();\n\n#endif  // MYLIB_FOO_H\n');
  });
  it('does not accept #pragma once and replaces it', async () => {
    const fixed = await firstFix('#pragma once\nint f();\n', 'SF.8', header);
    expect(fixed.startsWith('#ifndef MYLIB_FOO_H\n#define MYLIB_FOO_H\n')).toBe(true);
    expect(fixed).not.toContain('pragma');
  });
  it('accepts a guarded header and ignores source files', async () => {
    expect(await only('#ifndef G_H\n#define G_H\nint f();\n#endif\n', 'SF.8', header)).toEqual([]);
    expect(await only('int f() { return 1; }\n', 'SF.8', { path: 'a.cpp' })).toEqual([]);
  });
});

describe('SF.2 / SF.7 / SF.21 headers', () => {
  it('flags non-inline definitions and objects', async () => {
    const code = '#ifndef G_H\n#define G_H\nint x = 7;\nint f() { return 1; }\ninline int g() { return 2; }\nconst int c = 1;\nextern int e;\ntemplate <typename T> T h(T t) { return t; }\n#endif\n';
    const f = await only(code, 'SF.2', header);
    expect(f.length).toBe(2);
  });
  it('flags using namespace in a header but not in a source file', async () => {
    expect((await only('#ifndef G_H\n#define G_H\nusing namespace std;\n#endif\n', 'SF.7', header)).length).toBe(1);
    expect(await only('using namespace std;\n', 'SF.7', { path: 'a.cpp' })).toEqual([]);
    expect(await only('#ifndef G_H\n#define G_H\nvoid f() { using namespace std; }\n#endif\n', 'SF.7', header)).toEqual([]);
  });
  it('flags unnamed namespaces in headers', async () => {
    expect((await only('#ifndef G_H\n#define G_H\nnamespace { int a; }\n#endif\n', 'SF.21', header)).length).toBe(1);
  });
});

describe('SF.4 / SF.12 / SF.13 includes', () => {
  it('flags includes after code', async () => {
    expect((await only('#include <a>\nint x;\n#include <b>\n', 'SF.4')).length).toBe(1);
    expect(await only('#define X 1\n#include <a>\n#include <b>\nint x;\n', 'SF.4')).toEqual([]);
  });
  it('fixes quoted std headers and backslashes', async () => {
    expect(await firstFix('#include "vector"\n', 'SF.12')).toBe('#include <vector>\n');
    expect(await firstFix('#include "util\\util.h"\n', 'SF.13')).toBe('#include "util/util.h"\n');
    expect(await firstFix('#include <VECTOR>\n', 'SF.13')).toBe('#include <vector>\n');
  });
});

describe('SL standard library', () => {
  it('SL.3 flags additions to std', async () => {
    expect((await only('namespace std { void helper(); }', 'SL.3')).length).toBe(1);
    expect(await only('namespace std { template <> struct hash<X> { size_t operator()(X) const; }; }', 'SL.3')).toEqual([]);
  });
  it('SL.C.1 flags setjmp/longjmp', async () => {
    expect((await only('void f(jmp_buf b) { if (setjmp(b)) { longjmp(b, 1); } }', 'SL.C.1')).length).toBe(2);
  });
  it('SL.con.1 flags C arrays next to containers', async () => {
    const code = 'void f() {\n    std::vector<int> v;\n    int a[4];\n}\n';
    expect((await only(code, 'SL.con.1')).length).toBe(1);
    expect(await firstFix(code, 'SL.con.1')).toContain('std::array<int, 4> a;');
    expect(await only('void f() { int a[4]; }', 'SL.con.1')).toEqual([]);
  });
  it('SL.con.2 suggests std::array for constant vectors', async () => {
    const code = 'const std::vector<int> v{1, 2, 3};';
    expect((await only(code, 'SL.con.2')).length).toBe(1);
    expect(await firstFix(code, 'SL.con.2')).toContain('const std::array<int, 3> v{1, 2, 3};');
  });
  it('SL.str.3 flags indexing a char*', async () => {
    expect((await only('char f(char* p) { return p[1]; }', 'SL.str.3')).length).toBe(1);
    expect(await only('char f(char (&p)[4]) { return p[1]; }', 'SL.str.3')).toEqual([]);
  });
  it('SL.io.3 converts printf to std::format', async () => {
    const f = await only('void f(int n, const char* s) { printf("%d items of %s\\n", n, s); }', 'SL.io.3');
    expect(f.length).toBe(1);
    expect(await firstFix('void f(int n, const char* s) { printf("%d items of %s\\n", n, s); }', 'SL.io.3')).toContain('std::cout << std::format("{} items of {}\\n", n, s);');
    expect(await firstFix('void f(double d) { fprintf(stderr, "%.2f\\n", d); }', 'SL.io.3')).toContain('std::cerr << std::format("{:.2f}\\n", d);');
  });
  it('SL.io.50 avoids endl', async () => {
    expect(await firstFix('void f() { std::cout << "x" << std::endl; }', 'SL.io.50')).toBe("void f() { std::cout << \"x\" << '\\n'; }");
  });
});

describe('printf format conversion', () => {
  it('converts common conversions', () => {
    expect(convertPrintfFormat('"%d"')).toEqual({ format: '"{}"', count: 1 });
    expect(convertPrintfFormat('"%5d|%-5d|%05d"')?.format).toBe('"{:5}|{:<5}|{:05}"');
    expect(convertPrintfFormat('"%x %X %o"')?.format).toBe('"{:x} {:X} {:o}"');
    expect(convertPrintfFormat('"100%%"')?.format).toBe('"100%"');
    expect(convertPrintfFormat('"{}"')?.format).toBe('"{{}}"');
  });
  it('refuses what it cannot convert', () => {
    expect(convertPrintfFormat('"%p"')).toBeNull();
    expect(convertPrintfFormat('"%*d"')).toBeNull();
  });
});

describe('CP concurrency', () => {
  it('CP.20 flags lock()/unlock()', async () => {
    expect((await only('void f() { std::mutex m; m.lock(); m.unlock(); }', 'CP.20')).length).toBe(2);
    expect(await only('void f(std::weak_ptr<T> w) { auto p = w.lock(); }', 'CP.20')).toEqual([]);
  });
  it('CP.25 / CP.26 threads', async () => {
    expect(await firstFix('void f() { std::thread t([] {}); t.join(); }', 'CP.25')).toBe('void f() { std::jthread t([] {}); t.join(); }');
    const detach = 'void f() { std::thread t([] {}); t.detach(); }';
    expect((await only(detach, 'CP.26')).length).toBe(1);
    expect((await only(detach, 'CP.25'))[0].fixes).toEqual([]);
  });
  it('CP.42 flags wait without a condition', async () => {
    expect((await only('void f(std::condition_variable& cv, std::unique_lock<std::mutex>& l) { cv.wait(l); }', 'CP.42')).length).toBe(1);
    expect(await only('void f(std::condition_variable& cv, std::unique_lock<std::mutex>& l) { cv.wait(l, [] { return true; }); }', 'CP.42')).toEqual([]);
  });
  it('CP.21 merges consecutive lock guards', async () => {
    const code = 'void f() {\n    std::lock_guard<std::mutex> a(m1);\n    std::lock_guard<std::mutex> b(m2);\n}\n';
    expect((await only(code, 'CP.21')).length).toBe(1);
    expect(await firstFix(code, 'CP.21')).toContain('std::scoped_lock a(m1, m2);');
  });
  it('CP.51 / CP.53 coroutines', async () => {
    expect((await only('auto l = [x] { co_await y; };', 'CP.51')).length).toBe(1);
    expect((await only('Task coro(const std::string& s) { co_await x; }', 'CP.53')).length).toBe(1);
  });
  it('CP.200 flags volatile', async () => {
    expect((await only('volatile int flag = 0;', 'CP.200')).length).toBe(1);
    expect(await firstFix('volatile int flag = 0;', 'CP.200')).toContain('std::atomic<int> flag{0};');
  });
});
