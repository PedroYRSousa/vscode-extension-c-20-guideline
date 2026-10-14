import * as vscode from 'vscode';
import { docUrl } from '../core/registry.js';
import { t } from '../core/i18n.js';
import type { Finding, Fix } from '../core/types.js';

export const DIAGNOSTIC_SOURCE = 'cpp20-guidelines';

/** Findings that produced the diagnostics currently shown for a document. */
export interface Analysed {
  version: number;
  findings: Finding[];
  diagnostics: vscode.Diagnostic[];
}

export function toDiagnostic(doc: vscode.TextDocument, f: Finding): vscode.Diagnostic {
  const range = new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end));
  const also = f.alsoCovers.length > 0 ? ` ${t('(also {0})', f.alsoCovers.join(', '))}` : '';
  const d = new vscode.Diagnostic(
    range,
    f.message + also,
    f.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
  );
  d.source = DIAGNOSTIC_SOURCE;
  const url = docUrl(f.ruleId);
  d.code = url ? { value: f.ruleId, target: vscode.Uri.parse(url) } : f.ruleId;
  return d;
}

export function toWorkspaceEdit(doc: vscode.TextDocument, fix: Fix): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const e of fix.edits) {
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  }
  return edit;
}

/** Fixes whose edits overlap an already chosen fix are skipped (they would conflict). */
export function selectNonOverlapping(fixes: Fix[]): Fix[] {
  const chosen: Fix[] = [];
  const taken: Array<[number, number]> = [];
  for (const fix of fixes) {
    const ranges = fix.edits.map((e): [number, number] => [e.start, Math.max(e.end, e.start)]);
    const clash = ranges.some(([s, e]) => taken.some(([ts, te]) => s <= te && e >= ts));
    if (clash) continue;
    chosen.push(fix);
    taken.push(...ranges);
  }
  return chosen;
}
