#!/usr/bin/env node
// Parses CppCoreGuidelines.md and writes:
//   data/rules.json        (committed)  IDs, anchors, kind, severity + reason, enforcement class.
//   data/local/titles.json (git-ignored) titles and enforcement text, used only to build local review tables.
//
// The Core Guidelines license only allows personal/internal use, so verbatim text is never committed.
//
// Usage: node scripts/extract-rules.mjs [--source <path/to/CppCoreGuidelines.md>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--source');
const source = resolve(srcIdx >= 0 ? args[srcIdx + 1] : '/home/user/isocpp/cppcoreguidelines/CppCoreGuidelines.md');
const md = readFileSync(source, 'utf8');

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', dirname(source), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch { /* not a git checkout */ }

const lines = md.split('\n');
const SECTION_RE = /^# <a name="([^"]+)"><\/a>([A-Za-z]+): (.*)$/;
const RULE_RE = /^### <a name="([^"]+)"><\/a>\s*([A-Za-z]+(?:\.[A-Za-z]+)*\.[0-9]+\??):\s*(.*)$/;

// Severity (answer 3A): wording of the rule title decides.
const WARN_TITLE_RE = /\b(prefer|consider|avoid|favou?r|should|ideally)\b/i;
// Explicit statement in the body that the rule is only a recommendation (NL section).
const RECOMMENDATION_RE = /This is a recommendation for \[when you have no constraints/;

const rules = [];
let section = '';
let current = null;
const flush = (endLine) => {
  if (!current) return;
  current.body = lines.slice(current.startLine, endLine).join('\n');
  rules.push(current);
  current = null;
};

lines.forEach((line, i) => {
  const s = SECTION_RE.exec(line);
  if (s) { flush(i); section = s[2]; return; }
  if (/^## /.test(line)) { flush(i); return; }
  const r = RULE_RE.exec(line);
  if (r) {
    flush(i);
    current = { anchor: r[1], id: r[2], title: r[3].trim(), section, startLine: i + 1 };
  } else if (/^### /.test(line)) {
    flush(i);
  }
});
flush(lines.length);

const enforcementOf = (body) => {
  const m = /(?:^|\n)##### Enforcement\s*\n([\s\S]*?)(?=\n#{1,5} |$)/.exec(body);
  return m ? m[1].trim() : null;
};

const classify = (enf) => {
  if (enf === null) return 'none';
  if (/^(\*\s*)?\?\?\?\.?$/.test(enf)) return 'incomplete';
  if (/(very hard|not enforceable|not possible|impossible|infeasible|unenforceable|hard in general)/i.test(enf)) return 'not-enforceable';
  return 'hint';
};

const out = [];
const local = {};
for (const r of rules) {
  const enf = enforcementOf(r.body);
  const kind = r.section === 'FAQ' ? 'faq' : r.section === 'NR' ? 'non-rule' : 'rule';
  let severity = 'error';
  let severityReason = 'default';
  if (RECOMMENDATION_RE.test(r.body)) { severity = 'warning'; severityReason = 'explicit-recommendation'; }
  else {
    const w = WARN_TITLE_RE.exec(r.title);
    if (w) { severity = 'warning'; severityReason = `title:${w[1].toLowerCase()}`; }
  }
  out.push({
    id: r.id,
    anchor: r.anchor,
    section: r.section,
    kind,
    severity,
    severityReason,
    enforcement: classify(enf),
  });
  local[r.id] = { title: r.title, enforcement: enf };
}

// Duplicate IDs would make the registry ambiguous.
const seen = new Map();
for (const r of out) {
  if (seen.has(r.id)) console.warn(`duplicate id ${r.id}`);
  seen.set(r.id, true);
}

mkdirSync('data/local', { recursive: true });
writeFileSync('data/rules.json', JSON.stringify({
  source: 'https://github.com/isocpp/CppCoreGuidelines',
  commit,
  baseUrl: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines',
  rules: out,
}, null, 1) + '\n');
writeFileSync('data/local/titles.json', JSON.stringify(local, null, 1) + '\n');

const count = (f) => out.filter(f).length;
console.log(`commit ${commit}`);
console.log(`rules: ${count(r => r.kind === 'rule')}  non-rules: ${count(r => r.kind === 'non-rule')}  faq: ${count(r => r.kind === 'faq')}`);
console.log(`error: ${count(r => r.kind === 'rule' && r.severity === 'error')}  warning: ${count(r => r.kind === 'rule' && r.severity === 'warning')}`);
for (const e of ['none', 'incomplete', 'not-enforceable', 'hint']) console.log(`enforcement ${e}: ${count(r => r.kind === 'rule' && r.enforcement === e)}`);
