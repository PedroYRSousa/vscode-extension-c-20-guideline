import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without declarations
import { computeCoverage } from '../scripts/coverage.mjs';
import { allChecks } from '../src/rules/index';
import { allRuleInfos, isKnownRuleId } from '../src/core/registry';

describe('rule registry and coverage matrix', () => {
  const cov = computeCoverage();

  it('references only rule ids that exist', () => {
    expect(cov.unknown).toEqual([]);
    for (const check of allChecks) for (const id of check.covers) expect(isKnownRuleId(id), `${check.name}: ${id}`).toBe(true);
  });

  it('classifies every rule (implemented, clang-tidy, or a documented reason)', () => {
    for (const r of cov.rows) {
      if (r.kind !== 'rule') continue;
      if (r.state === 'not-implemented') expect(r.reason, r.id).toBeTruthy();
      if (r.state === 'not-implemented') expect(Object.keys(cov.status.reasons), r.id).toContain(r.reason);
    }
  });

  it('keeps data/coverage.json in sync with the sources (run `npm run docs:coverage`)', () => {
    const stored = JSON.parse(readFileSync(resolve(__dirname, '../data/coverage.json'), 'utf8'));
    const real = cov.rows.filter((r: { kind: string }) => r.kind === 'rule');
    expect(stored.summary.implemented).toBe(real.filter((r: { state: string }) => r.state === 'implemented').length);
    expect(stored.summary.notImplemented).toBe(real.filter((r: { state: string }) => r.state === 'not-implemented').length);
  });

  it('has a severity for every extension rule and every guideline rule', () => {
    for (const info of allRuleInfos()) expect(['error', 'warning']).toContain(info.severity);
    expect(allRuleInfos().filter((i) => i.kind === 'extension').every((i) => i.id === 'CPP20.suppress' || i.severity === 'warning')).toBe(true);
  });
});
