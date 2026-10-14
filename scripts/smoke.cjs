// Loads the bundled extension (dist/extension.js) against a minimal fake `vscode` module and checks that
// diagnostics and quick fixes are produced end to end (including loading the WASM files from dist/).
const Module = require('node:module');
const path = require('node:path');

const diagnosticsByUri = new Map();
const providers = [];
const commands = new Map();
const listeners = { open: [], change: [], save: [], close: [], config: [] };

class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range {
  constructor(s, e) { this.start = s; this.end = e; }
  intersection(o) { return o && o.start.line <= this.end.line && this.start.line <= o.end.line ? this : undefined; }
}
class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; } }
class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ range, text }); } insert(uri, pos, text) { this.edits.push({ range: new Range(pos, pos), text }); } }
const CodeActionKind = { QuickFix: { value: 'quickfix', contains: (k) => k.value === 'quickfix', append: (s) => ({ value: 'source.fixAll.' + s, contains: (k) => k.value.startsWith('source.fixAll') }) }, SourceFixAll: { append: (s) => ({ value: 'source.fixAll.' + s, contains: (k) => k.value.startsWith('source.fixAll') }) } };
const Uri = { parse: (s) => ({ toString: () => s, fsPath: s }), file: (p) => ({ toString: () => 'file://' + p, fsPath: p, scheme: 'file' }) };

const fakeVscode = {
  Position, Range, Diagnostic, CodeAction, WorkspaceEdit, CodeActionKind, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  l10n: { t: (m, ...a) => m.replace(/\{(\d+)\}/g, (_, i) => a[i]) },
  languages: {
    createDiagnosticCollection: () => ({ set: (uri, d) => diagnosticsByUri.set(uri.toString(), d), delete: (uri) => diagnosticsByUri.delete(uri.toString()), dispose() {} }),
    registerCodeActionsProvider: (sel, p) => { providers.push(p); return { dispose() {} }; },
  },
  window: { createOutputChannel: () => ({ appendLine: (l) => console.log('[output]', l), dispose() {} }) },
  commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; } },
  env: { openExternal: async () => true },
  workspace: {
    textDocuments: [],
    asRelativePath: (u) => path.basename(u.fsPath),
    getConfiguration: () => ({ get: (_k, d) => d }),
    onDidOpenTextDocument: (f) => { listeners.open.push(f); return { dispose() {} }; },
    onDidSaveTextDocument: (f) => { listeners.save.push(f); return { dispose() {} }; },
    onDidChangeTextDocument: (f) => { listeners.change.push(f); return { dispose() {} }; },
    onDidCloseTextDocument: (f) => { listeners.close.push(f); return { dispose() {} }; },
    onDidChangeConfiguration: (f) => { listeners.config.push(f); return { dispose() {} }; },
  },
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return origLoad.call(this, request, ...rest);
};

function makeDoc(fsPath, text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    languageId: 'cpp', version: 1, fileName: fsPath, uri: Uri.file(fsPath),
    getText: () => text,
    positionAt: (o) => { let l = 0; while (l + 1 < starts.length && starts[l + 1] <= o) l++; return new Position(l, o - starts[l]); },
  };
}

(async () => {
  const ext = require(path.resolve(__dirname, '../dist/extension.js'));
  ext.activate({ extensionPath: path.resolve(__dirname, '..'), subscriptions: [] });
  const doc = makeDoc('/tmp/sample.cpp', 'int* f() {\n    int* p = NULL;\n    return p;\n}\n');
  await Promise.all(listeners.open.map((f) => f(doc)));
  await new Promise((r) => setTimeout(r, 300));
  const diags = diagnosticsByUri.get(doc.uri.toString()) || [];
  if (diags.length === 0) throw new Error('no diagnostics produced from the bundled extension');
  const codes = diags.map((d) => (d.code && d.code.value) || d.code);
  console.log('diagnostics:', codes.join(', '));
  if (!codes.includes('ES.47')) throw new Error('expected ES.47');
  const d = diags.find((x) => ((x.code && x.code.value) || x.code) === 'ES.47');
  const actions = providers[0].provideCodeActions(doc, d.range, { only: undefined, diagnostics: [d] });
  const titles = actions.map((a) => a.title);
  console.log('actions:', titles.join(' | '));
  if (!titles.some((t) => t.startsWith('Replace with nullptr'))) throw new Error('missing quick fix');
  if (!titles.some((t) => t.startsWith('Suppress ES.47'))) throw new Error('missing suppress action');
  console.log('SMOKE OK');
  process.exit(0);
})().catch((e) => { console.error('SMOKE FAILED', e); process.exit(1); });
