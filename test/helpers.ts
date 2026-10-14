import { resolve } from 'node:path';
import { analyze, applyEdits, fileInfoFor } from '../src/core/analyzer.js';
import { allChecks } from '../src/rules/index.js';
import { defaultConfig, type AnalyzerConfig, type Check, type Finding, type Fix } from '../src/core/types.js';

const nm = (p: string): string => resolve(__dirname, '..', 'node_modules', p);
export const wasm = { core: nm('web-tree-sitter/tree-sitter.wasm'), cpp: nm('tree-sitter-wasms/out/tree-sitter-cpp.wasm') };

export interface RunOptions {
  path?: string;
  config?: Partial<AnalyzerConfig>;
  checks?: readonly Check[];
}

export async function run(code: string, opts: RunOptions = {}): Promise<Finding[]> {
  const config = { ...defaultConfig, ...opts.config };
  const { findings } = await analyze(code, fileInfoFor(opts.path ?? 'test.cpp'), config, {
    wasm,
    checks: opts.checks ?? allChecks,
    strict: true,
  });
  return findings;
}

export async function ids(code: string, opts: RunOptions = {}): Promise<string[]> {
  return (await run(code, opts)).map((f) => f.ruleId);
}

export async function only(code: string, ruleId: string, opts: RunOptions = {}): Promise<Finding[]> {
  return (await run(code, opts)).filter((f) => f.ruleId === ruleId || f.alsoCovers.includes(ruleId));
}

export function fixed(code: string, fix: Fix): string {
  return applyEdits(code, fix.edits);
}

export async function firstFix(code: string, ruleId: string, opts: RunOptions = {}): Promise<string> {
  const f = (await only(code, ruleId, opts))[0];
  if (!f) throw new Error(`no ${ruleId} finding in:\n${code}`);
  if (f.fixes.length === 0) throw new Error(`${ruleId} has no fix`);
  return fixed(code, f.fixes[0]);
}
