import * as vscode from 'vscode';
import { docUrl } from '../core/registry.js';
import { t } from '../core/i18n.js';
import { DIAGNOSTIC_SOURCE, selectNonOverlapping, toWorkspaceEdit, type Analysed } from './convert.js';

export const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append('cpp20Guidelines');

export class GuidelineCodeActions implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, FIX_ALL_KIND],
  };

  constructor(private readonly state: Map<string, Analysed>) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const analysed = this.state.get(doc.uri.toString());
    if (!analysed || analysed.version !== doc.version) return [];
    const actions: vscode.CodeAction[] = [];

    if (!context.only || context.only.contains(vscode.CodeActionKind.QuickFix)) {
      analysed.diagnostics.forEach((diagnostic, i) => {
        if (diagnostic.source !== DIAGNOSTIC_SOURCE || !diagnostic.range.intersection(range)) return;
        const finding = analysed.findings[i];
        finding.fixes.forEach((fix) => {
          const unsafe = fix.safety === 'unsafe';
          const title = unsafe ? `${fix.title} ${t('(may change behaviour - review)')}` : fix.title;
          const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
          action.edit = toWorkspaceEdit(doc, fix);
          action.diagnostics = [diagnostic];
          action.isPreferred = !unsafe && finding.fixes.filter((f) => f.safety === 'safe').length === 1;
          actions.push(action);
        });

        const url = docUrl(finding.ruleId);
        if (url) {
          const open = new vscode.CodeAction(t('Open the documentation of {0}', finding.ruleId), vscode.CodeActionKind.QuickFix);
          open.command = { command: 'cpp20Guidelines.openRule', title: open.title, arguments: [finding.ruleId] };
          open.diagnostics = [diagnostic];
          actions.push(open);
        }
        if (finding.ruleId !== 'CPP20.suppress') {
          const suppress = new vscode.CodeAction(t('Suppress {0} on this line (justification required)', finding.ruleId), vscode.CodeActionKind.QuickFix);
          suppress.command = {
            command: 'cpp20Guidelines.suppress',
            title: suppress.title,
            arguments: [doc.uri, diagnostic.range.start.line, finding.ruleId],
          };
          suppress.diagnostics = [diagnostic];
          actions.push(suppress);
        }
      });
    }

    if (!context.only || context.only.contains(FIX_ALL_KIND)) {
      const safe = selectNonOverlapping(
        analysed.findings.flatMap((f) => f.fixes.filter((x) => x.safety === 'safe').slice(0, 1)),
      );
      if (safe.length > 0) {
        const all = new vscode.CodeAction(t('Fix all safe C++20 guideline issues ({0})', safe.length), FIX_ALL_KIND);
        const edit = new vscode.WorkspaceEdit();
        for (const fix of safe) {
          for (const e of fix.edits) {
            edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
          }
        }
        all.edit = edit;
        actions.push(all);
      }
    }
    return actions;
  }
}
