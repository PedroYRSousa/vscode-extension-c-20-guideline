import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('NL.4 indentation', () => {
  it('flags mixed tabs and spaces', async () => {
    const code = 'void f()\n{\n\tg();\n\th();\n    k();\n}\n';
    const f = await only(code, 'NL.4');
    expect(f.length).toBe(1);
    expect(await firstFix(code, 'NL.4')).toBe('void f()\n{\n\tg();\n\th();\n\tk();\n}\n');
  });
  it('flags statements that are not at the expected indentation', async () => {
    const code = 'void f()\n{\n    a();\n    b();\n  c();\n    d();\n}\n';
    const f = await only(code, 'NL.4');
    expect(f.length).toBe(1);
    expect(await firstFix(code, 'NL.4')).toBe('void f()\n{\n    a();\n    b();\n    c();\n    d();\n}\n');
  });
  it('flags a misaligned closing brace', async () => {
    expect((await only('void f()\n{\n    a();\n  }\n', 'NL.4')).length).toBe(1);
  });
  it('accepts consistent code', async () => {
    expect(await only('void f(int x)\n{\n    if (x) {\n        a();\n    }\n}\n', 'NL.4')).toEqual([]);
  });
});

describe('NL.15 spaces', () => {
  it('flags the guideline examples', async () => {
    expect(await firstFix('#include < map >\n', 'NL.15')).toBe('#include <map>\n');
    const f = await only('int main(int argc, char * argv [ ]) { return 0; }', 'NL.15');
    expect(f.length).toBeGreaterThan(0);
  });
  it('flags spaces inside parentheses, before separators and between name and (', async () => {
    expect(await firstFix('void f() { g( 1 ); }', 'NL.15')).toBe('void f() { g(1 ); }');
    expect(await firstFix('void f() { g(1) ; }', 'NL.15')).toBe('void f() { g(1); }');
    expect(await firstFix('void f() { g (1); }', 'NL.15')).toBe('void f() { g(1); }');
    expect(await firstFix('int  x;', 'NL.15')).toBe('int x;');
  });
  it('accepts normal spacing', async () => {
    expect(await only('int main(int argc, char* argv[])\n{\n    return foo(argc) + 1; // done\n}\n', 'NL.15')).toEqual([]);
    expect(await only('void f() { auto l = [](int x) { return x; }; if (a) { b(); } }', 'NL.15')).toEqual([]);
  });
});

describe('NL.17 K&R layout', () => {
  it('wants the function brace on its own line', async () => {
    const code = 'int f(int x) {\n    return x;\n}\n';
    expect((await only(code, 'NL.17')).length).toBe(1);
    expect(await firstFix(code, 'NL.17')).toBe('int f(int x)\n{\n    return x;\n}\n');
  });
  it('expands one-line functions', async () => {
    expect(await firstFix('int f() { return 1; }', 'NL.17')).toBe('int f()\n{\n    return 1;\n}');
  });
  it('wants class braces on the same line', async () => {
    const code = 'struct Cable\n{\n    int x;\n};\n';
    const f = await only(code, 'NL.17');
    expect(f.length).toBe(1);
    expect(await firstFix(code, 'NL.17')).toBe('struct Cable {\n    int x;\n};\n');
  });
  it('wants statement braces on the same line and spaces after keywords', async () => {
    const code = 'void f(int x)\n{\n    if (x)\n    {\n        a();\n    }\n}\n';
    expect(await firstFix(code, 'NL.17')).toContain('if (x) {');
    expect(await firstFix('void f(int x)\n{\n    if(x) {\n        a();\n    }\n}\n', 'NL.17')).toContain('if (x) {');
  });
  it('wants branches and loop bodies on separate lines', async () => {
    const code = 'void f(int x)\n{\n    if (x) a();\n}\n';
    expect(await firstFix(code, 'NL.17')).toBe('void f(int x)\n{\n    if (x)\n        a();\n}\n');
    const braced = 'void f(int x)\n{\n    if (x) { a(); }\n}\n';
    expect(await firstFix(braced, 'NL.17')).toBe('void f(int x)\n{\n    if (x) {\n        a();\n    }\n}\n');
  });
  it('wants case labels aligned with the switch', async () => {
    const code = 'void f(int x)\n{\n    switch (x) {\n        case 0:\n            a();\n            break;\n    }\n}\n';
    expect(await firstFix(code, 'NL.17')).toContain('    case 0:');
  });
  it('accepts the guideline example layout', async () => {
    const code = 'double foo(int x)\n{\n    if (0 < x) {\n        a();\n    }\n\n    switch (x) {\n    case 0:\n        b();\n        break;\n    default:\n        break;\n    }\n\n    if (0 < x)\n        ++x;\n\n    if (x < 0)\n        something();\n    else\n        something_else();\n\n    return some_value;\n}\n';
    expect(await only(code, 'NL.17')).toEqual([]);
  });
});

describe('NL.18 declarator layout', () => {
  it('attaches the operator to the type', async () => {
    expect(await firstFix('void f(int *p);', 'NL.18')).toBe('void f(int* p);');
    expect(await firstFix('void f(int * p);', 'NL.18')).toBe('void f(int* p);');
    expect(await firstFix('T &operator[](size_t);', 'NL.18')).toBe('T& operator[](size_t);');
    expect(await firstFix('void f(const T & x);', 'NL.18')).toBe('void f(const T& x);');
  });
  it('accepts the C++ style and function pointers', async () => {
    expect(await only('T& operator[](size_t); int (*fp)(int); char** argv;', 'NL.18')).toEqual([]);
  });
});

describe('NL.20 one statement per line', () => {
  it('flags and splits', async () => {
    expect(await firstFix('void f()\n{\n    int x = 7; char* p = nullptr;\n}\n', 'NL.20')).toBe('void f()\n{\n    int x = 7;\n    char* p = nullptr;\n}\n');
    expect((await only('void f() { a(); b(); ++x; }', 'NL.20')).length).toBe(2);
    expect(await only('void f() { a(); }', 'NL.20')).toEqual([]);
  });
});

describe('NL.25 / NL.26', () => {
  it('NL.25 removes void', async () => {
    expect(await firstFix('void f(void);', 'NL.25')).toBe('void f();');
  });
  it('NL.26 uses west const', async () => {
    expect(await firstFix('int const x = 9;', 'NL.26')).toBe('const int x = 9;');
    expect(await firstFix('void f(int const& r);', 'NL.26')).toBe('void f(const int& r);');
    expect(await only('const int x = 7; const int* const p = nullptr;', 'NL.26')).toEqual([]);
  });
});

describe('NL.11 literals', () => {
  it('adds digit separators', async () => {
    expect(await firstFix('auto c = 299792458;', 'NL.11')).toBe("auto c = 299'792'458;");
    expect(await firstFix('auto q = 0b000011110000;', 'NL.11')).toBe("auto q = 0b0000'1111'0000;");
    expect(await only("auto a = 1000; auto b = 299'792'458; auto d = 123456;", 'NL.11')).toEqual([]);
  });
});

describe('NL.16 member order', () => {
  it('flags data before functions and repeated sections', async () => {
    const code = 'class X {\npublic:\n    int a;\n    void f();\nprivate:\n    int b;\npublic:\n    void g();\n};\n';
    expect((await only(code, 'NL.16')).length).toBe(2);
    expect(await only('class X {\npublic:\n    using T = int;\n    X();\n    void f();\n    int a;\nprivate:\n    int b;\n    void h();\n};\n', 'NL.16')).toEqual([]);
  });
});

describe('naming (NL.8 / NL.10 / NL.17)', () => {
  it('NL.10 prefers underscore_style and offers a rename', async () => {
    const code = 'void f() { int myVar = 1; use(myVar); }';
    expect((await only(code, 'NL.10')).length).toBe(1);
    expect(await firstFix(code, 'NL.10')).toBe('void f() { int my_var = 1; use(my_var); }');
    expect(await only('void f() { int my_var = 1; }', 'NL.10')).toEqual([]);
  });
  it('NL.17 capitalizes types and not functions', async () => {
    expect((await only('struct widget {};', 'NL.17')).length).toBe(1);
    expect((await only('void Foo();', 'NL.17')).length).toBe(1);
    const ok = 'struct My_map {\n};\n\nstruct Widget {\n};\n\nvoid foo();\n\nclass X {\npublic:\n    X();\n    ~X();\n};\n';
    expect(await only(ok, 'NL.17')).toEqual([]);
    expect((await only('struct HttpServer {};', 'NL.10')).length).toBe(1);
  });
  it('NL.8 flags reserved identifiers', async () => {
    expect((await only('int __x; int _Bad;', 'NL.8')).length).toBe(2);
  });
  it('ignores macro-like test definitions and constructors', async () => {
    expect(await only('TEST(Suite, Name) { }', 'NL.17')).toEqual([]);
  });
});
