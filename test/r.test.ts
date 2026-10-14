import { describe, expect, it } from 'vitest';
import { firstFix, only, run } from './helpers';

describe('R.11 / R.20 / R.22 / R.23 explicit allocation', () => {
  it('converts new assigned to a raw pointer', async () => {
    const code = 'void f() {\n    T* p = new T(1, 2);\n    use(p);\n    delete p;\n}\n';
    const f = await only(code, 'R.20');
    expect(f.length).toBe(1);
    expect(f[0].alsoCovers).toEqual(expect.arrayContaining(['R.3', 'R.12', 'ES.24', 'C.149']));
    const fixed = await firstFix(code, 'R.20');
    expect(fixed).toContain('auto p = std::make_unique<T>(1, 2);');
    expect(fixed).not.toContain('delete p');
    expect(fixed).toContain('#include <memory>');
  });
  it('flags unique_ptr and shared_ptr built from new', async () => {
    expect(await firstFix('void f() { auto s = std::shared_ptr<T>(new T(4)); }', 'R.22')).toContain('auto s = std::make_shared<T>(4);');
    expect(await firstFix('void f() { std::unique_ptr<T> u(new T(3)); }', 'R.23')).toContain('std::unique_ptr<T> u(std::make_unique<T>(3));');
    expect(await firstFix('void f() { std::unique_ptr<T> p; p.reset(new T); }', 'R.23')).toContain('p = std::make_unique<T>();');
  });
  it('reports bare new/delete and exempts resource-management functions', async () => {
    expect((await only('T* make() { return new T; }', 'R.11')).length).toBe(1);
    expect((await only('void f(T* p) { delete p; }', 'R.11')).length).toBe(1);
    expect(await only('struct S { S() : p_(new T) {} ~S() { delete p_; } T* p_; };', 'R.11')).toEqual([]);
    expect(await only('void f() { auto d = new (buf) T; }', 'R.11')).toEqual([]);
  });
  it('flags several allocations in one statement (R.13)', async () => {
    expect((await only('void f() { g(std::unique_ptr<A>(new A), std::unique_ptr<B>(new B)); }', 'R.13')).length).toBe(1);
  });
});

describe('ES.61 mismatched new/delete', () => {
  it('flags and fixes', async () => {
    const code = 'void f() { int* p = new int[3]; delete p; }';
    expect((await only(code, 'ES.61')).length).toBe(1);
    expect(await firstFix(code, 'ES.61')).toBe('void f() { int* p = new int[3]; delete[] p; }');
    expect(await only('void f() { int* p = new int; delete p; }', 'ES.61')).toEqual([]);
  });
  it('checks constructor/destructor pairs', async () => {
    expect((await only('struct S { S() : p_(new int[4]) {} ~S() { delete p_; } int* p_; };', 'ES.61')).length).toBe(1);
  });
});

describe('R.10 malloc/free', () => {
  it('flags', async () => {
    expect((await only('void f() { void* m = malloc(10); free(m); }', 'R.10')).length).toBe(2);
  });
});

describe('R.14 array parameters', () => {
  it('suggests span', async () => {
    const code = 'void f(int a[], int n);';
    expect((await only(code, 'R.14')).length).toBe(1);
    expect(await firstFix(code, 'R.14')).toContain('void f(std::span<int> a, int n);');
  });
  it('accepts main', async () => {
    expect(await only('int main(int argc, char* argv[]) { return 0; }', 'R.14')).toEqual([]);
  });
});

describe('R.15 allocation pairs', () => {
  it('flags incomplete pairs', async () => {
    expect((await only('struct S { static void* operator new(size_t); };', 'R.15')).length).toBe(1);
    expect(await only('struct S { static void* operator new(size_t); static void operator delete(void*); };', 'R.15')).toEqual([]);
  });
});

describe('F.7 / R.33 / R.35 smart pointer parameters', () => {
  it('flags shared_ptr that is only dereferenced', async () => {
    expect((await only('void f(std::shared_ptr<T> p) { p->go(); }', 'F.7')).length).toBe(1);
    expect(await only('void f(std::shared_ptr<T> p) { g(p); }', 'F.7')).toEqual([]);
  });
  it('flags unique_ptr& that is never reseated', async () => {
    expect((await only('void f(std::unique_ptr<T>& p) { p->go(); }', 'R.33')).length).toBe(1);
    expect(await only('void f(std::unique_ptr<T>& p) { p.reset(); }', 'R.33')).toEqual([]);
  });
});

describe('no crash on partial code', () => {
  it('survives syntax errors', async () => {
    await run('void f( { int x = ; new ');
  });
});
