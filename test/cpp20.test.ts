import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('CPP20.ranges', () => {
  it('converts iterator pairs to ranges algorithms', async () => {
    expect(await firstFix('void f(std::vector<int>& v) { std::sort(v.begin(), v.end(), cmp); }', 'CPP20.ranges')).toContain('std::ranges::sort(v, cmp);');
    expect(await firstFix('auto f(std::vector<int>& v) { return std::find(std::begin(v), std::end(v), 3); }', 'CPP20.ranges')).toContain('return std::ranges::find(v, 3);');
    expect(await firstFix('void f(std::vector<int>& v) { std::sort(v.begin(), v.end()); }', 'CPP20.ranges')).toContain('#include <algorithm>');
  });
  it('marks non-trivial result changes as unsafe', async () => {
    const f = await only('auto f(std::vector<int>& v, int* o) { return std::copy(v.begin(), v.end(), o); }', 'CPP20.ranges');
    expect(f[0].fixes[0].safety).toBe('unsafe');
    const g = await only('void f(std::vector<int>& v, int* o) { std::copy(v.begin(), v.end(), o); }', 'CPP20.ranges');
    expect(g[0].fixes[0].safety).toBe('safe');
  });
  it('ignores mismatched containers and execution policies', async () => {
    expect(await only('void f(std::vector<int>& a, std::vector<int>& b) { std::sort(a.begin(), b.end()); }', 'CPP20.ranges')).toEqual([]);
    expect(await only('void f(std::vector<int>& a) { std::sort(std::execution::par, a.begin(), a.end()); }', 'CPP20.ranges')).toEqual([]);
  });
});

describe('CPP20.erase_if', () => {
  it('replaces the erase-remove idiom', async () => {
    expect(await firstFix('void f(std::vector<int>& v) { v.erase(std::remove_if(v.begin(), v.end(), p), v.end()); }', 'CPP20.erase_if')).toBe('void f(std::vector<int>& v) { std::erase_if(v, p); }');
    expect(await firstFix('void f(std::vector<int>& v) { v.erase(std::remove(v.begin(), v.end(), 3), v.end()); }', 'CPP20.erase_if')).toBe('void f(std::vector<int>& v) { std::erase(v, 3); }');
    expect(await only('void f(std::vector<int>& v, std::vector<int>& w) { v.erase(std::remove_if(w.begin(), w.end(), p), v.end()); }', 'CPP20.erase_if')).toEqual([]);
  });
});

describe('CPP20.contains', () => {
  it('uses contains() and starts_with()', async () => {
    const code = 'bool f(std::map<int, int>& m, int k) { return m.find(k) != m.end(); }';
    expect(await firstFix(code, 'CPP20.contains')).toBe('bool f(std::map<int, int>& m, int k) { return m.contains(k); }');
    expect(await firstFix('bool f(std::map<int, int>& m, int k) { return m.find(k) == m.end(); }', 'CPP20.contains')).toContain('!m.contains(k)');
    expect(await firstFix('bool f(std::string s) { return s.find("ab") == 0; }', 'CPP20.contains')).toContain('s.starts_with("ab")');
    expect(await only('bool f(std::vector<int>& v) { return v.find(1) != v.end(); }', 'CPP20.contains')).toEqual([]);
  });
});

describe('CPP20.spaceship', () => {
  it('flags operator!= next to operator==', async () => {
    const code = 'struct A { bool operator==(const A&) const; bool operator!=(const A&) const; };';
    expect((await only(code, 'CPP20.spaceship')).length).toBe(1);
    expect(await only('struct A { bool operator==(const A&) const; };', 'CPP20.spaceship')).toEqual([]);
  });
  it('suggests <=> for the relational operators', async () => {
    const code = 'struct A { bool operator<(const A&) const; bool operator>(const A&) const; };';
    expect((await only(code, 'CPP20.spaceship')).length).toBe(1);
  });
});

describe('CPP20.source_location', () => {
  it('replaces __FILE__ and __LINE__', async () => {
    expect(await firstFix('void f() { log(__FILE__, __LINE__); }', 'CPP20.source_location')).toContain('std::source_location::current().file_name()');
  });
});

describe('CPP20.type_traits', () => {
  it('uses _v and _t', async () => {
    expect(await firstFix('constexpr bool b = std::is_same<A, B>::value;', 'CPP20.type_traits')).toBe('constexpr bool b = std::is_same_v<A, B>;');
    expect(await firstFix('template <typename T> using U = typename std::remove_cv<T>::type;', 'CPP20.type_traits')).toBe('template <typename T> using U = std::remove_cv_t<T>;');
    expect(await only('constexpr bool b = std::is_same_v<A, B>; constexpr int n = my::trait<A>::value;', 'CPP20.type_traits')).toEqual([]);
  });
});

describe('CPP20.concepts', () => {
  it('replaces enable_if default template arguments', async () => {
    const code = 'template <typename T, typename = std::enable_if_t<std::is_integral_v<T>>> void f(T);';
    expect((await only(code, 'CPP20.concepts')).length).toBe(1);
    expect(await firstFix(code, 'CPP20.concepts')).toBe('template <typename T> requires std::is_integral_v<T> void f(T);');
  });
  it('replaces enable_if return types', async () => {
    const code = 'template <typename T> std::enable_if_t<std::is_integral_v<T>, T> h(T);';
    expect(await firstFix(code, 'CPP20.concepts')).toBe('template <typename T> T h(T) requires std::is_integral_v<T>;');
  });
});

describe('CPP20.nodiscard', () => {
  it('marks const accessors', async () => {
    const code = 'class A {\npublic:\n    int size() const;\n    [[nodiscard]] int cap() const;\n    void run() const;\n};\n';
    expect((await only(code, 'CPP20.nodiscard')).length).toBe(1);
    expect(await firstFix(code, 'CPP20.nodiscard')).toContain('[[nodiscard]] int size() const;');
  });
  it('marks pure free functions in headers only', async () => {
    expect((await only('int twice(int x);', 'CPP20.nodiscard', { path: 'a.h' })).length).toBe(1);
    expect(await only('int twice(int x);', 'CPP20.nodiscard', { path: 'a.cpp' })).toEqual([]);
    expect(await only('int twice(int& x);', 'CPP20.nodiscard', { path: 'a.h' })).toEqual([]);
  });
});

describe('CPP20.constinit', () => {
  it('suggests constinit for constant-initialised globals', async () => {
    expect(await firstFix('int counter = 0;', 'CPP20.constinit')).toBe('constinit int counter = 0;');
    expect(await only('const int a = 1; int b = f();', 'CPP20.constinit')).toEqual([]);
  });
});

describe('CPP20.bit_cast', () => {
  it('replaces memcpy punning and reinterpret_cast dereference', async () => {
    expect(await firstFix('void f(float x, unsigned u) { std::memcpy(&u, &x, sizeof(u)); }', 'CPP20.bit_cast')).toContain('u = std::bit_cast<decltype(u)>(x);');
    expect(await firstFix('unsigned f(float x) { return *reinterpret_cast<unsigned*>(&x); }', 'CPP20.bit_cast')).toContain('return std::bit_cast<unsigned>(x);');
  });
});

describe('CPP20.gsl_to_std', () => {
  it('maps GSL names to the standard library', async () => {
    expect(await firstFix('void f(gsl::span<int> s);', 'CPP20.gsl_to_std')).toContain('void f(std::span<int> s);');
    expect(await firstFix('gsl::joining_thread t;', 'CPP20.gsl_to_std')).toContain('std::jthread t;');
    expect(await firstFix('int f(long l) { return gsl::narrow_cast<int>(l); }', 'CPP20.gsl_to_std')).toBe('int f(long l) { return static_cast<int>(l); }');
  });
});

describe('CPP20.string_view', () => {
  it('suggests string_view for read-only string parameters', async () => {
    expect(await firstFix('void f(const std::string& s);', 'CPP20.string_view')).toContain('void f(std::string_view s);');
    expect(await only('void f(std::string& s); void g(const std::string& s) { use(s.c_str()); }', 'CPP20.string_view')).toEqual([]);
  });
});

describe('CPP20.numbers / CPP20.removed / CPP20.modules', () => {
  it('replaces M_PI', async () => {
    expect(await firstFix('double a = M_PI * 2;', 'CPP20.numbers')).toContain('double a = std::numbers::pi * 2;');
  });
  it('flags removed facilities', async () => {
    expect(await firstFix('std::auto_ptr<int> p;', 'CPP20.removed')).toBe('std::unique_ptr<int> p;');
    expect((await only('void f() { std::random_shuffle(a, b); }', 'CPP20.removed')).length).toBe(1);
    expect(await firstFix('void f() { register int x = 1; }', 'CPP20.removed')).toBe('void f() { int x = 1; }');
  });
  it('modules rule is off by default and opt-in', async () => {
    expect(await only('#include <vector>\n', 'CPP20.modules')).toEqual([]);
    const on = await only('#include <vector>\n', 'CPP20.modules', { config: { enforceModules: true } });
    expect(on.length).toBe(1);
    expect(await firstFix('#include <vector>\n', 'CPP20.modules', { config: { enforceModules: true } })).toBe('import <vector>;\n');
  });
});
