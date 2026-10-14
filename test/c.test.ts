import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('C.8 / C.2 struct vs class', () => {
  it('turns a struct with private members into a class', async () => {
    const code = 'struct S : B {\n    int a;\nprivate:\n    int b;\n};\n';
    const fixed = await firstFix(code, 'C.8');
    expect(fixed).toContain('class S : public B');
    expect(fixed).toContain('public:\n    int a;');
  });
  it('flags a class with only public data', async () => {
    const code = 'class P { public: int x; int y; };';
    expect((await only(code, 'C.2')).length).toBe(1);
    expect(await firstFix(code, 'C.2')).toContain('struct P');
    expect(await only('class Q { int x_; public: int get() const; };', 'C.2')).toEqual([]);
  });
});

describe('C.133 / C.134 data access', () => {
  it('flags protected data and mixed access', async () => {
    expect((await only('class A { protected: int x; };', 'C.133')).length).toBe(1);
    expect((await only('class A { public: int x; private: int y; };', 'C.134')).length).toBe(1);
    expect(await only('class A { private: int x; int y; };', 'C.134')).toEqual([]);
  });
});

describe('C.12 const members', () => {
  it('flags const and reference members in copyable types', async () => {
    expect((await only('struct S { const int a; int& b; int c; };', 'C.12')).length).toBe(2);
    expect(await only('struct S { const int a; S(const S&) = delete; S& operator=(const S&) = delete; };', 'C.12')).toEqual([]);
  });
});

describe('C.21 rule of five', () => {
  it('flags partially declared special members and offers the rest', async () => {
    const code = 'struct S {\n    ~S();\n};\n';
    expect((await only(code, 'C.21')).length).toBe(1);
    const fixed = await firstFix(code, 'C.21');
    expect(fixed).toContain('S(const S&) = default;');
    expect(fixed).toContain('S& operator=(S&&) noexcept = default;');
  });
  it('accepts none or all', async () => {
    expect(await only('struct S { int a; };', 'C.21')).toEqual([]);
    expect(await only('struct S { S(const S&)=default; S& operator=(const S&)=default; S(S&&)=default; S& operator=(S&&)=default; ~S()=default; };', 'C.21')).toEqual([]);
  });
});

describe('C.31 resources', () => {
  it('flags allocation in a constructor without destructor', async () => {
    expect((await only('class S { public: S() : p_(new int(1)) {} private: int* p_; };', 'C.31')).length).toBe(1);
    expect(await only('class S { public: S() : p_(new int(1)) {} ~S() { delete p_; } private: int* p_; };', 'C.31')).toEqual([]);
  });
});

describe('C.127 virtual destructor', () => {
  it('adds a virtual destructor', async () => {
    const code = 'struct B {\n    virtual void f();\n};\n';
    expect((await only(code, 'C.127')).length).toBe(1);
    expect(await firstFix(code, 'C.127')).toContain('virtual ~B() = default;');
  });
  it('fixes a public non-virtual destructor', async () => {
    expect(await firstFix('struct B { virtual void f(); ~B(); };', 'C.127')).toContain('virtual ~B();');
  });
  it('accepts public virtual and protected non-virtual destructors', async () => {
    expect(await only('struct B { virtual void f(); virtual ~B() = default; };', 'C.127')).toEqual([]);
    expect(await only('class B { public: virtual void f(); protected: ~B() = default; };', 'C.127')).toEqual([]);
  });
});

describe('E.5 / C.40 / C.43 constructors', () => {
  it('flags private state without a constructor', async () => {
    expect((await only('class S { int x_; public: int get() const; };', 'E.5')).length).toBe(1);
    expect(await only('class S { int x_; public: S(); };', 'E.5')).toEqual([]);
  });
  it('flags copyable classes without a default constructor', async () => {
    expect((await only('class S { public: explicit S(int); };', 'C.43')).length).toBe(1);
    expect(await only('class S { public: S(); explicit S(int); };', 'C.43')).toEqual([]);
  });
});

describe('C.45 default member initializers', () => {
  it('moves constants out of the default constructor', async () => {
    const code = 'struct S {\n    S() : a(1), b(2) {}\n    int a;\n    int b;\n};\n';
    const fixed = await firstFix(code, 'C.45');
    expect(fixed).toContain('int a{1};');
    expect(fixed).toContain('int b{2};');
    expect(fixed).toContain('S() {}');
  });
});

describe('C.46 explicit constructors', () => {
  it('flags implicit single-argument constructors', async () => {
    expect((await only('struct S { S(int x); };', 'C.46')).length).toBe(1);
    expect(await firstFix('struct S { S(int x); };', 'C.46')).toBe('struct S { explicit S(int x); };');
    expect(await only('struct S { explicit S(int x); S(const S&); S(S&&); S(int a, int b); S(std::initializer_list<int>); };', 'C.46')).toEqual([]);
    expect((await only('struct S { S(int a, int b = 0); };', 'C.46')).length).toBe(1);
  });
});

describe('C.47 / C.13 initialization order', () => {
  it('reorders initializers', async () => {
    const code = 'struct S { S() : b(1), a(2) {} int a; int b; };';
    expect(await firstFix(code, 'C.47')).toBe('struct S { S() : a(2), b(1) {} int a; int b; };');
  });
  it('flags use before construction', async () => {
    expect((await only('struct S { S() : a(b + 1), b(2) {} int a; int b; };', 'C.13')).length).toBe(1);
    expect(await only('struct S { S(int b) : a(b + 1), b(2) {} int a; int b; };', 'C.13')).toEqual([]);
  });
});

describe('C.49 / C.62 / C.67 / C.80 / C.82', () => {
  it('C.49 flags member assignment in constructors', async () => {
    expect((await only('struct S { int a; S(int x) { a = x; } };', 'C.49')).length).toBe(1);
    expect(await only('struct S { int a; S(int x) : a(x) {} };', 'C.49')).toEqual([]);
  });
  it('C.62 flags the self-assignment test', async () => {
    expect((await only('struct S { S& operator=(const S& o) { if (this == &o) return *this; return *this; } };', 'C.62')).length).toBe(1);
  });
  it('C.67 flags polymorphic classes that can be copied', async () => {
    expect((await only('struct B { virtual void f(); virtual ~B() = default; };', 'C.67')).length).toBe(1);
    expect(await only('struct B { virtual void f(); B(const B&) = delete; B& operator=(const B&) = delete; };', 'C.67')).toEqual([]);
  });
  it('C.80 prefers = default', async () => {
    expect(await firstFix('struct S { S() {} int a{}; };', 'C.80')).toBe('struct S { S() = default; int a{}; };');
    expect(await firstFix('struct S { ~S() {} };', 'C.80')).toBe('struct S { ~S() = default; };');
  });
  it('C.82 flags virtual calls in constructors', async () => {
    expect((await only('struct S { S() { f(); } virtual void f(); };', 'C.82')).length).toBe(1);
    expect(await only('struct S { S() { g(); } virtual void f(); void g(); };', 'C.82')).toEqual([]);
  });
});

describe('C.90 / SL.con.4', () => {
  it('flags memset on non-trivial objects', async () => {
    expect((await only('void f() { std::string s; memset(&s, 0, sizeof(s)); }', 'C.90')).length).toBe(1);
    expect(await only('void f() { int a[4]; memset(a, 0, sizeof(a)); }', 'C.90')).toEqual([]);
    expect((await only('struct S { virtual void f(); void g() { memset(this, 0, sizeof(*this)); } };', 'C.90')).length).toBe(1);
  });
});
