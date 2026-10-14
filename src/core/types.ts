import type { Node } from 'web-tree-sitter';

export type Severity = 'error' | 'warning';

/** Offsets are UTF-16 code units into the analysed text (same unit as VS Code document offsets). */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * A quick fix.
 *  - `safe`:   behaviour preserving (or turns into a compile error when it is not); offered as the preferred fix.
 *  - `unsafe`: may change behaviour or an API; offered separately and flagged for review (answer 8C).
 */
export interface Fix {
  title: string;
  edits: TextEdit[];
  safety: 'safe' | 'unsafe';
}

export interface Finding {
  /** Guideline rule id (`ES.47`) or an extension rule id (`CPP20.format`). */
  ruleId: string;
  severity: Severity;
  start: number;
  end: number;
  message: string;
  fixes: Fix[];
  /** Other guideline rules violated by the same construct (reported once). */
  alsoCovers: string[];
}

export interface ReportArgs {
  ruleId: string;
  node?: Node;
  start?: number;
  end?: number;
  message: string;
  fixes?: Fix[];
  alsoCovers?: string[];
}

export interface FileInfo {
  path: string;
  /** Lower-case extension including the dot (`.h`), or '' when none. */
  ext: string;
  isHeader: boolean;
}

export interface AnalyzerConfig {
  /** Answer 3A/5B: when false, every `warning` is dropped. */
  enableOptionalWarnings: boolean;
  /** Answer 4A: GSL is an optional dependency for the entities that have no `std` equivalent. */
  gslEnabled: boolean;
  /** Answer 5C: `import` instead of `#include` is off by default. */
  enforceModules: boolean;
  fileSuffixes: { sources: string[]; headers: string[] };
  thresholds: {
    /** F.3: "Try 60 lines by 140 characters". */
    maxFunctionLines: number;
    maxFunctionColumns: number;
    /** F.3: "more than 10 logical paths through". */
    maxCyclomaticComplexity: number;
    /** NL.11: "Flag long digit sequences ... maybe 7". */
    digitSeparatorMinDigits: number;
    /** I.23 style limit used by the parameter-count check. */
    maxParameters: number;
  };
  /** ES.45: literals that are allowed ("0, 1, nullptr, \n, "" and others on a positive list"). */
  magicConstantAllowList: string[];
}

export const defaultConfig: AnalyzerConfig = {
  enableOptionalWarnings: true,
  gslEnabled: false,
  enforceModules: false,
  fileSuffixes: {
    sources: ['.cpp', '.cxx', '.cc', '.C'],
    headers: ['.h', '.hh', '.hpp', '.hxx'],
  },
  thresholds: {
    maxFunctionLines: 60,
    maxFunctionColumns: 140,
    maxCyclomaticComplexity: 10,
    digitSeparatorMinDigits: 7,
    maxParameters: 5,
  },
  magicConstantAllowList: ['0', '1', '-1', '2', '0.0', '1.0', '0.5', '100', '1000', "'\\n'", "'\\0'", '""', "' '"],
};

export interface Check {
  /** Short name for diagnostics/tests. */
  name: string;
  /** Every rule id this check may report. Used to build the coverage matrix and to validate `report`. */
  covers: readonly string[];
  run(ctx: import('./context.js').Context): void;
}
