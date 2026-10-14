import { describe, expect, it } from 'vitest';
import { ids, only } from './helpers';

/**
 * Layouts that clang-format (with the repository's .clang-format) produces must not be reported by the layout rules.
 * Every case here came out of formatting real or fuzzed code; the "still reported" cases keep the checks honest.
 */
const layout = async (code: string): Promise<string[]> => (await ids(code)).filter((id) => ['NL.4', 'NL.11', 'NL.15', 'NL.17', 'NL.18', 'NL.20', 'NL.26'].includes(id));

describe('NL.4 as clang-format lays code out', () => {
  it('accepts a goto label flushed one level left, at any depth', async () => {
    const code = 'void f(int n)\n{\n    int i = 0;\nagain:\n    if (i < n) {\n        ++i;\n    retry:\n        if (i) {\n            goto retry;\n        }\n        goto again;\n    }\n}\n';
    expect(await layout(code)).toEqual([]);
    expect(await layout('int f(int n)\n{\n    if (n)\n        goto fail;\n    return 0;\nfail:\n    return -1;\n}\n')).toEqual([]);
  });

  it('still checks the statement a label labels', async () => {
    const code = 'void f(int n)\n{\n    int i = 0;\nagain:\n        ++i;\n    if (i < n)\n        goto again;\n}\n';
    expect((await only(code, 'NL.4')).length).toBeGreaterThan(0);
  });

  it('accepts the body of a lambda in the head of an if, anchored by its closing brace', async () => {
    const code = '#include <algorithm>\n#include <vector>\nvoid a();\nvoid f(std::vector<int>& v)\n{\n    if (std::any_of(v.begin(), v.end(), [](int x) {\n            a();\n            return x > 0;\n        })) {\n        a();\n    }\n}\n';
    expect(await layout(code)).toEqual([]);
  });

  it('accepts a lambda that starts on a continuation line', async () => {
    const code = 'struct Long_type_name_that_goes_on_and_on_and_on_forever_and_ever_and_ever_and_ever {};\nauto lam =\n    [](const Long_type_name_that_goes_on_and_on_and_on_forever_and_ever_and_ever_and_ever& first,\n       int second) -> int {\n    int x = 1;\n    return x;\n};\n';
    expect((await only(code, 'NL.4')).length).toBe(0);
  });

  it('accepts a lambda inside a constructor initializer list', async () => {
    const code = 'struct W {\n    W(int a)\n        : fn_([a](int x) {\n              int y = x * a;\n              return y;\n          }),\n          n_(0)\n    {\n    }\n    int n_;\n};\n';
    expect((await only(code, 'NL.4')).length).toBe(0);
  });

  it('still reports a lambda body that is not consistent with its closing brace', async () => {
    const code = 'void f()\n{\n    run([] {\n    a();\n    });\n}\n';
    expect((await only(code, 'NL.4')).length).toBeGreaterThan(0);
  });

  it('accepts [[unlikely]] on the continuation line of a wrapped condition', async () => {
    const code =
      'void g();\nbool c1(int);\nbool c2(int);\nvoid f(int a, int b)\n{\n    if (c1(a) && c2(b) && c1(b) && c2(a) && a > b && b > 0 && c1(a + b) && c2(a + b) && c1(a - b))\n        [[unlikely]] {\n        g();\n    }\n}\n';
    expect((await only(code, 'NL.4')).length).toBe(0);
  });

  it('does not count the lines of a raw string as indentation', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `\t${String.fromCharCode(97 + i)}`).join('\n');
    const code = `#include <string>\nstd::string f(int n)\n{\n    if (n) {\n        n++;\n    }\n    return R"(\n${lines}\n)";\n}\n`;
    expect((await only(code, 'NL.4')).length).toBe(0);
  });
});

describe('NL.17 / NL.20 as clang-format lays code out', () => {
  it('accepts "} break;" after a case block', async () => {
    const code = 'void a();\nvoid f(int x)\n{\n    switch (x) {\n    case 1: {\n        a();\n    } break;\n    default:\n        break;\n    }\n}\n';
    expect((await only(code, 'NL.20')).length).toBe(0);
  });

  it('still reports two real statements on a line', async () => {
    expect((await only('void a();\nvoid f(int x)\n{\n    a(); a();\n}\n', 'NL.20')).length).toBe(1);
  });

  it('accepts a comment after the opening brace and an attribute before the body', async () => {
    const code = 'void a();\nvoid f(int x)\n{\n    if (x) { // why\n        a();\n    }\n    if (x) [[likely]] {\n        a();\n    }\n    if (x) [[unlikely]]\n        a();\n}\n';
    expect((await only(code, 'NL.17')).length).toBe(0);
  });

  it('accepts an empty declaration after a function body', async () => {
    expect((await only('namespace n {\nint f()\n{\n    return 1;\n};\n}\n', 'NL.20')).length).toBe(0);
  });
});

describe('NL.18 / NL.26 / NL.11 as clang-format lays code out', () => {
  it('does not read a direct initialiser as a declarator', async () => {
    const code = 'void f(int rows, int cols)\n{\n    std::vector<float> data(rows * cols);\n    int n(rows * cols);\n    T d(a & b);\n    T e(a && b);\n}\n';
    expect((await only(code, 'NL.18')).length).toBe(0);
  });

  it('leaves declarators of a multi-declarator declaration to ES.10', async () => {
    const code = 'void f()\n{\n    int *a, *b;\n}\n';
    expect((await only(code, 'NL.18')).length).toBe(0);
    expect((await only(code, 'ES.10')).length).toBe(1);
    expect((await only('void f(int *p);\n', 'NL.18')).length).toBe(1);
  });

  it('does not report a macro-prefixed west const as east const', async () => {
    expect((await only('#define EXPORT_API\nEXPORT_API const int* f2(const int* p);\n', 'NL.26')).length).toBe(0);
    expect((await only('void g(int const& x);\n', 'NL.26')).length).toBe(1);
  });

  it('does not group octal literals', async () => {
    expect((await only('auto o = 01234567;\n', 'NL.11')).length).toBe(0);
    expect((await only('auto d = 1234567;\n', 'NL.11')).length).toBe(1);
  });
});

describe('NL.15 as clang-format lays code out', () => {
  it('accepts padding that aligns a column with the line above or below', async () => {
    const table = 'int table[] = {broken, broken, broken,    broken, broken, all_true, true_false, true_false,\n               broken, broken, all_false, broken, broken, broken,   true_false, broken};\n';
    expect((await only(table, 'NL.15')).length).toBe(0);
    const chain = 'int f(int m)\n{\n    return m == a             ? b\n           : m == c           ? d\n           : m == long_name_e ? g\n                              : m;\n}\n';
    expect((await only(chain, 'NL.15')).length).toBe(0);
    expect((await only('int  x = 1;\nint y = 2;\n', 'NL.15')).length).toBe(1);
  });
});

describe('suppression comments survive formatting', () => {
  const wrapped = 'void many_params(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j,\n                 int k);';

  it('a trailing comment covers the statement it ends, however many lines the formatter made of it', async () => {
    expect((await only(`${wrapped}\n`, 'F.2')).length).toBe(1);
    expect((await only(`${wrapped} // cpp20-guideline: ignore F.2 -- legacy API\n`, 'F.2')).length).toBe(0);
  });

  it('a comment alone on a line covers the whole head of the declaration below it', async () => {
    const code = `// cpp20-guideline: ignore F.2 -- legacy API\n${wrapped}\n`;
    expect((await only(code, 'F.2')).length).toBe(0);
    const tpl = '// cpp20-guideline: ignore F.2 -- legacy API\ntemplate<typename T>\nvoid many(T a, int b, int c, int d, int e, int f, int g, int h, int i, int j, int k);\n';
    expect((await only(tpl, 'F.2')).length).toBe(0);
  });

  it('does not reach into the body of the function', async () => {
    const code = '// cpp20-guideline: ignore ES.47 -- legacy API\nvoid f()\n{\n    int* p = NULL;\n}\n';
    expect((await only(code, 'ES.47')).length).toBe(1);
  });

  it('the lines between "clang-format off" and "clang-format on" are not checked for layout', async () => {
    const code = '// clang-format off\nint *  table_ptr  =  nullptr ;\n// clang-format on\nint *  other  =  nullptr ;\n';
    const found = (await ids(code)).filter((id) => id.startsWith('NL.'));
    expect(found.length).toBeGreaterThan(0); // the line after "on" is still checked
    const lines = (await only(code, 'NL.15')).map((f) => code.slice(0, f.start).split('\n').length);
    expect(lines.every((l) => l >= 4)).toBe(true);
  });
});

describe('F.49 sees east const', () => {
  it('reports "T const f()" like "const T f()"', async () => {
    expect((await only('int const answer();\n', 'F.49')).length).toBe(1);
    expect((await only('const int answer();\n', 'F.49')).length).toBe(1);
    expect((await only('int answer();\n', 'F.49')).length).toBe(0);
  });
});

describe('C++20 module syntax does not confuse the layout checks', () => {
  it('parses exported declarations as ordinary ones', async () => {
    const code =
      'export module geometry;\nimport std;\nimport <vector>;\nexport namespace geometry {\nexport struct Point {\n    double x;\n    double y;\n};\nexport class Circle {\npublic:\n    double area() const\n    {\n        return 3.14 * r_ * r_;\n    }\n\nprivate:\n    double r_;\n};\n} // namespace geometry\n';
    expect(await layout(code)).toEqual([]);
  });

  it('leaves identifiers called module or import alone', async () => {
    const code = 'void f(Module& module)\n{\n    module.init();\n    int import = 1;\n    import += 2;\n}\n';
    expect(await layout(code)).toEqual([]);
  });
});
