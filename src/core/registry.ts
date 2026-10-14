import data from '../../data/rules.json';
import type { Severity } from './types.js';

export interface RuleInfo {
  id: string;
  severity: Severity;
  /** `rule`: a real guideline rule. `extension`: a rule that only exists in this extension (C++20 modernisation). */
  kind: 'rule' | 'non-rule' | 'faq' | 'extension';
  anchor?: string;
  /** Rules that stay silent unless the user opts in (answer 5C: modules). */
  optIn?: 'modules';
}

export const GUIDELINES_URL = data.baseUrl;
export const GUIDELINES_COMMIT = data.commit;

const infos = new Map<string, RuleInfo>();
for (const r of data.rules) {
  infos.set(r.id, { id: r.id, severity: r.severity as Severity, kind: r.kind as RuleInfo['kind'], anchor: r.anchor });
}

/** Rules that are not in the Core Guidelines (answer 5A). Always `warning` (answer 5B), except the suppression check. */
export const EXTENSION_RULES: Record<string, { severity: Severity; optIn?: 'modules' }> = {
  'CPP20.suppress': { severity: 'error' },
  'CPP20.concepts': { severity: 'warning' },
  'CPP20.ranges': { severity: 'warning' },
  'CPP20.spaceship': { severity: 'warning' },
  'CPP20.source_location': { severity: 'warning' },
  'CPP20.nodiscard': { severity: 'warning' },
  'CPP20.constinit': { severity: 'warning' },
  'CPP20.bit_cast': { severity: 'warning' },
  'CPP20.erase_if': { severity: 'warning' },
  'CPP20.contains': { severity: 'warning' },
  'CPP20.type_traits': { severity: 'warning' },
  'CPP20.removed': { severity: 'warning' },
  'CPP20.gsl_to_std': { severity: 'warning' },
  'CPP20.string_view': { severity: 'warning' },
  'CPP20.numbers': { severity: 'warning' },
  'CPP20.modules': { severity: 'warning', optIn: 'modules' },
};

for (const [id, v] of Object.entries(EXTENSION_RULES)) {
  infos.set(id, { id, severity: v.severity, kind: 'extension', optIn: v.optIn });
}

export function ruleInfo(id: string): RuleInfo | undefined {
  return infos.get(id);
}

export function isKnownRuleId(id: string): boolean {
  return infos.has(id);
}

export function allRuleInfos(): RuleInfo[] {
  return [...infos.values()];
}

export function severityOf(id: string): Severity {
  const info = infos.get(id);
  if (!info) throw new Error(`unknown rule id: ${id}`);
  return info.severity;
}

export function docUrl(id: string): string | undefined {
  const info = infos.get(id);
  if (!info) return undefined;
  if (info.kind === 'extension') return undefined;
  return `${GUIDELINES_URL}#${info.anchor}`;
}
