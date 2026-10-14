import * as path from 'node:path';
import * as vscode from 'vscode';
import { analyze, fileInfoFor } from '../core/analyzer.js';
import { matchesAnyGlob } from '../core/glob.js';
import { docUrl } from '../core/registry.js';
import { setTranslator, t } from '../core/i18n.js';
import { allChecks } from '../rules/index.js';
import { GuidelineCodeActions } from './codeActions.js';
import { toDiagnostic, type Analysed } from './convert.js';
import { readConfig, readExtensionSettings, SECTION } from './settings.js';

const MAX_BYTES = 2 * 1024 * 1024;
const DEBOUNCE_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  setTranslator((message, ...args) => vscode.l10n.t(message, ...args));
  const wasm = {
    core: path.join(context.extensionPath, 'dist', 'tree-sitter.wasm'),
    cpp: path.join(context.extensionPath, 'dist', 'tree-sitter-cpp.wasm'),
  };
  const collection = vscode.languages.createDiagnosticCollection('cpp20-guidelines');
  const output = vscode.window.createOutputChannel('C++20 Guidelines');
  const state = new Map<string, Analysed>();
  const timers = new Map<string, NodeJS.Timeout>();

  const isCandidate = (doc: vscode.TextDocument): boolean =>
    doc.languageId === 'cpp' && (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled');

  const isExcluded = (doc: vscode.TextDocument): boolean => {
    const { exclude } = readExtensionSettings(doc);
    const relative = vscode.workspace.asRelativePath(doc.uri, false);
    return matchesAnyGlob(relative, exclude) || matchesAnyGlob(doc.uri.fsPath, exclude);
  };

  const clear = (doc: vscode.TextDocument): void => {
    collection.delete(doc.uri);
    state.delete(doc.uri.toString());
  };

  const run = async (doc: vscode.TextDocument): Promise<void> => {
    if (!isCandidate(doc)) return;
    const settings = readExtensionSettings(doc);
    if (!settings.enable || isExcluded(doc)) return clear(doc);
    const text = doc.getText();
    if (text.length > MAX_BYTES) return clear(doc);
    const version = doc.version;
    try {
      const { findings, crashes } = await analyze(text, fileInfoFor(doc.uri.fsPath || doc.fileName), readConfig(doc), {
        wasm,
        checks: allChecks,
      });
      for (const c of crashes) output.appendLine(`[${doc.fileName}] check "${c.check}" failed: ${String(c.error)}`);
      if (doc.version !== version) return; // the document changed while we were analysing
      const diagnostics = findings.map((f) => toDiagnostic(doc, f));
      collection.set(doc.uri, diagnostics);
      state.set(doc.uri.toString(), { version, findings, diagnostics });
    } catch (error) {
      output.appendLine(`[${doc.fileName}] analysis failed: ${String(error)}`);
    }
  };

  const schedule = (doc: vscode.TextDocument): void => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void run(doc);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    collection,
    output,
    vscode.workspace.onDidOpenTextDocument((d) => void run(d)),
    vscode.workspace.onDidSaveTextDocument((d) => void run(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0 || !isCandidate(e.document)) return;
      if (readExtensionSettings(e.document).run === 'onType') schedule(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument(clear),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) vscode.workspace.textDocuments.forEach((d) => void run(d));
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'cpp', scheme: 'file' }, { language: 'cpp', scheme: 'untitled' }],
      new GuidelineCodeActions(state),
      GuidelineCodeActions.metadata,
    ),
    vscode.commands.registerCommand('cpp20Guidelines.openRule', async (ruleId: string) => {
      const url = docUrl(ruleId);
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('cpp20Guidelines.analyzeActiveFile', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc) await run(doc);
    }),
    vscode.commands.registerCommand(
      'cpp20Guidelines.suppress',
      async (uri: vscode.Uri, line: number, ruleId: string) => {
        const justification = await vscode.window.showInputBox({
          prompt: t('Why is it acceptable to ignore {0} here?', ruleId),
          validateInput: (v) => (v.trim().length > 0 ? undefined : t('A justification is required.')),
        });
        if (!justification) return;
        const doc = await vscode.workspace.openTextDocument(uri);
        const target = doc.lineAt(line);
        const indent = target.text.slice(0, target.firstNonWhitespaceCharacterIndex);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(line, 0), `${indent}// cpp20-guideline: ignore ${ruleId} -- ${justification.trim()}\n`);
        await vscode.workspace.applyEdit(edit);
      },
    ),
  );

  vscode.workspace.textDocuments.forEach((d) => void run(d));
}

export function deactivate(): void {
  // Nothing to dispose beyond the subscriptions registered in activate().
}
