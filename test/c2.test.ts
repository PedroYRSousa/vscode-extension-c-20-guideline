import { describe, expect, it } from 'vitest';
import { firstFix, only } from './helpers';

describe('C.7', () => {
  it('separates the definition from the variable', async () => {
    const code = 'struct S { int a; } s;';
    expect((await only(code, 'C.7')).length).toBe(1);
    expect(await firstFix(code, 'C.7')).toBe('struct S { int a; };\nS s;');
  });
});

describe('class hierarchies', () => {
  it('C.121 flags data plus virtual functions', async () => {
    expect((await only('struct B { int x; virtual void f(); };', 'C.121')).length).toBe(1);
    expect(await only('struct B { virtual void f() = 0; virtual ~B() = default; };', 'C.121')).toEqual([]);
  });
  it('C.126 flags constructors in abstract classes', async () => {
    expect((await only('struct B { B() {} virtual void f() = 0; };', 'C.126')).length).toBe(1);
  });
  it('C.128 requires exactly one specifier and override on overrides', async () => {
    expect(await firstFix('struct D : B { virtual void f() override; };', 'C.128')).toBe('struct D : B { void f() override; };');
    const code = 'struct B { virtual void f(); virtual ~B() = default; }; struct D : B { void f(); };';
    expect((await only(code, 'C.128')).length).toBe(1);
    expect(await firstFix(code, 'C.128')).toContain('void f() override;');
  });
  it('C.131 flags trivial accessors', async () => {
    const code = 'class A { int x_; public: int get_x() const { return x_; } void set_x(int v) { x_ = v; } };';
    expect((await only(code, 'C.131')).length).toBe(2);
    expect(await only('class A { int x_; public: int get_x() const { return x_; } void go(); };', 'C.131')).toEqual([]);
  });
  it('C.139 flags final classes', async () => {
    expect((await only('struct A final : B {};', 'C.139')).length).toBe(1);
  });
  it('C.138 / C.140 flag hiding and different default arguments', async () => {
    const hiding = 'struct B { virtual void f(int); }; struct D : B { void f(double); };';
    expect((await only(hiding, 'C.138')).length).toBe(1);
    expect(await only('struct B { void f(int); }; struct D : B { using B::f; void f(double); };', 'C.138')).toEqual([]);
    const dflt = 'struct B { virtual void f(int x = 1); }; struct D : B { void f(int x = 2) override; };';
    expect((await only(dflt, 'C.140')).length).toBe(1);
  });
  it('C.146 suggests dynamic_cast for downcasts', async () => {
    const code = 'struct B {}; struct D : B {}; void f(B* b) { auto p = static_cast<D*>(b); }';
    expect((await only(code, 'C.146')).length).toBe(1);
    expect(await firstFix(code, 'C.146')).toContain('dynamic_cast<D*>(b)');
    expect(await only('struct B {}; void f(B* b) { auto p = static_cast<B*>(b); }', 'C.146')).toEqual([]);
  });
});

describe('operators', () => {
  it('C.164 flags implicit conversion operators', async () => {
    expect((await only('struct S { operator bool() const; };', 'C.164')).length).toBe(1);
    expect(await only('struct S { explicit operator bool() const; };', 'C.164')).toEqual([]);
  });
  it('C.161 flags member symmetric operators', async () => {
    expect((await only('struct S { S operator+(const S&) const; S& operator+=(const S&); };', 'C.161')).length).toBe(1);
  });
  it('C.87 flags virtual comparison operators', async () => {
    expect((await only('struct S { virtual bool operator==(const S&) const; };', 'C.87')).length).toBe(1);
  });
});

describe('enumerations and unions', () => {
  it('Enum.3 suggests enum class', async () => {
    expect(await firstFix('enum E { A, B };', 'Enum.3')).toBe('enum class E { A, B };');
    expect(await only('enum class E { A, B };', 'Enum.3')).toEqual([]);
  });
  it('Enum.6 flags unnamed enumerations', async () => {
    expect((await only('enum { A };', 'Enum.6')).length).toBe(1);
  });
  it('Enum.8 flags duplicate and consecutive explicit values', async () => {
    expect((await only('enum class E { A = 1, B = 1 };', 'Enum.8')).length).toBe(1);
    expect(await firstFix('enum class E { A = 0, B = 1, C = 2 };', 'Enum.8')).toBe('enum class E { A, B, C };');
    expect(await only('enum class E { A = 1, B = 4 };', 'Enum.8')).toEqual([]);
  });
  it('P.4 flags unions', async () => {
    expect((await only('union U { int i; float f; };', 'P.4')).length).toBe(1);
  });
});
