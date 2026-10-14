import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from './helpers';

const fixture = (name: string): string => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

describe('idiomatic, compliant C++20 produces no diagnostics', () => {
  it('source file', async () => {
    const f = await run(fixture('clean.cpp'), { path: 'src/main.cpp' });
    expect(f.map((x) => `${x.ruleId}: ${x.message}`)).toEqual([]);
  });
  it('header file', async () => {
    const f = await run(fixture('clean.h'), { path: 'include/example/clean.h' });
    expect(f.map((x) => `${x.ruleId}: ${x.message}`)).toEqual([]);
  });
});

describe('legacy C++ is reported', () => {
  it('flags the classic problems in one go', async () => {
    const legacy = `#include <stdio.h>
#include <vector>
#define MAX 10
typedef unsigned long ulong;
class Foo {
public:
  int data;
  Foo(int x) { data = x; }
};
int* make() { int* p = new int[MAX]; return p; }
void use(std::vector<int>& v) {
  for (int i = 0; i < v.size(); i++) printf("%d\\n", v[i]);
}
`;
    const f = await run(legacy, { path: 'legacy.cpp' });
    const ids = new Set(f.map((x) => x.ruleId));
    for (const id of ['CPL.1', 'ES.31', 'T.43', 'C.46', 'R.20', 'ES.100', 'SL.io.3', 'NL.17']) expect(ids.has(id), id).toBe(true);
    expect(f.some((x) => x.severity === 'error')).toBe(true);
    expect(f.some((x) => x.severity === 'warning')).toBe(true);
  });
});
