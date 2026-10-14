// Computes which guideline rules the extension implements. Shared by scripts/gen-docs.mjs and the tests.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

export function loadRules() {
  const data = JSON.parse(read('data/rules.json'));
  const status = JSON.parse(read('data/rule-status.json'));
  let titles = {};
  try {
    titles = JSON.parse(read('data/local/titles.json'));
  } catch { /* the local-only titles file is optional */ }
  return { data, status, titles };
}

const ID_RE = /^[A-Z][A-Za-z]*(?:\.[A-Za-z]+)*\.\d+\??$|^CPP20\.[a-z_]+$/;

/** Every quoted rule-id literal in src/rules, split into known and unknown ids. */
export function scanSources(knownIds) {
  const found = new Set();
  const unknown = new Set();
  const dir = join(root, 'src/rules');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const text = read(`src/rules/${f}`);
    for (const m of text.matchAll(/'([^'\n]{2,40})'/g)) {
      if (!ID_RE.test(m[1])) continue;
      if (knownIds.has(m[1])) found.add(m[1]);
      else unknown.add(`${m[1]} (src/rules/${f})`);
    }
  }
  return { found, unknown: [...unknown] };
}

export function clangTidyRules() {
  const text = read('src/core/clangtidy.ts');
  const block = /CLANG_TIDY_MAP[^=]*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1] ?? '';
  const map = {};
  for (const m of block.matchAll(/'([^']+)':\s*'([^']+)'/g)) map[m[1]] = m[2];
  return map;
}

const EXTENSION_IDS = (() => {
  const text = read('src/core/registry.ts');
  const block = /EXTENSION_RULES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1] ?? '';
  return [...block.matchAll(/'(CPP20\.[a-z_]+)'/g)].map((m) => m[1]);
})();

export function computeCoverage() {
  const { data, status, titles } = loadRules();
  const known = new Set([...data.rules.map((r) => r.id), ...EXTENSION_IDS]);
  const { found, unknown } = scanSources(known);
  const clangMap = clangTidyRules();
  const viaClang = new Set(Object.values(clangMap));
  const rows = data.rules.map((r) => {
    let state;
    let reason = null;
    if (r.kind !== 'rule') {
      state = 'non-rule';
      reason = 'non-rule';
    } else if (found.has(r.id)) state = 'implemented';
    else if (viaClang.has(r.id)) state = 'clang-tidy';
    else {
      state = 'not-implemented';
      reason = status.unimplemented[r.id]
        ?? ({ none: 'no-criterion', incomplete: 'incomplete', 'not-enforceable': 'not-enforceable', hint: 'semantic' })[r.enforcement];
    }
    return { ...r, state, reason, note: status.notes[r.id] ?? null, clangTidy: viaClang.has(r.id), title: titles[r.id]?.title ?? null };
  });
  return { rows, extension: EXTENSION_IDS, unknown, status, commit: data.commit, baseUrl: data.baseUrl, clangMap };
}
