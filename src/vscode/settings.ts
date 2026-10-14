import * as vscode from 'vscode';
import { defaultConfig, type AnalyzerConfig } from '../core/types.js';

export const SECTION = 'cpp20Guidelines';

export function readConfig(scope?: vscode.ConfigurationScope): AnalyzerConfig {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  const d = defaultConfig;
  return {
    enableOptionalWarnings: c.get<boolean>('enableOptionalWarnings', d.enableOptionalWarnings),
    gslEnabled: c.get<boolean>('gsl.enabled', d.gslEnabled),
    enforceModules: c.get<boolean>('modules.enforce', d.enforceModules),
    fileSuffixes: {
      sources: c.get<string[]>('fileSuffixes.sources', d.fileSuffixes.sources),
      headers: c.get<string[]>('fileSuffixes.headers', d.fileSuffixes.headers),
    },
    thresholds: {
      maxFunctionLines: c.get<number>('thresholds.maxFunctionLines', d.thresholds.maxFunctionLines),
      maxFunctionColumns: c.get<number>('thresholds.maxFunctionColumns', d.thresholds.maxFunctionColumns),
      maxCyclomaticComplexity: c.get<number>('thresholds.maxCyclomaticComplexity', d.thresholds.maxCyclomaticComplexity),
      digitSeparatorMinDigits: c.get<number>('thresholds.digitSeparatorMinDigits', d.thresholds.digitSeparatorMinDigits),
      maxParameters: c.get<number>('thresholds.maxParameters', d.thresholds.maxParameters),
    },
    magicConstantAllowList: c.get<string[]>('magicConstants.allowList', d.magicConstantAllowList),
  };
}

export interface ExtensionSettings {
  enable: boolean;
  exclude: string[];
  run: 'onType' | 'onSave';
  clangTidy: { enabled: boolean; path: string; extraArgs: string[] };
}

export function readExtensionSettings(scope?: vscode.ConfigurationScope): ExtensionSettings {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  return {
    enable: c.get<boolean>('enable', true),
    exclude: c.get<string[]>('exclude', []),
    run: c.get<'onType' | 'onSave'>('run', 'onType'),
    clangTidy: {
      enabled: c.get<boolean>('clangTidy.enabled', false),
      path: c.get<string>('clangTidy.path', 'clang-tidy'),
      extraArgs: c.get<string[]>('clangTidy.extraArgs', []),
    },
  };
}
