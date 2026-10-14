// Extracts every message passed to t('...') from src/ so translations can be verified.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Evaluate a JS string literal (quotes included) without running arbitrary code. */
function unquote(literal) {
  const escapes = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`' };
  return literal.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) =>
    e[0] === 'u' || e[0] === 'x' ? String.fromCharCode(parseInt(e.slice(1), 16)) : (escapes[e] ?? e));
}

export function extractMessages() {
  const messages = new Map();
  const re = /(?<![\w.])t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
  for (const f of [...files(join(root, 'src/rules')), ...files(join(root, 'src/core')), ...files(join(root, 'src/vscode'))]) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) {
      const msg = unquote(m[1]);
      if (!messages.has(msg)) messages.set(msg, f.slice(root.length + 1));
    }
  }
  return messages;
}

if (process.argv[1] === import.meta.filename) {
  const all = extractMessages();
  console.log(`${all.size} messages`);
  if (process.argv.includes('--list')) for (const [m, f] of all) console.log(`${f}\t${m}`);
}
