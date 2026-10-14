import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without declarations
import { extractMessages } from '../scripts/l10n-extract.mjs';
import { setTranslator, t } from '../src/core/i18n';

const load = (name: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, '..', name), 'utf8'));

describe('localization (answer 9: English + Portuguese)', () => {
  const messages: Map<string, string> = extractMessages();

  for (const locale of ['pt-pt', 'pt-br']) {
    it(`translates every message to ${locale}`, () => {
      const bundle = load(`l10n/bundle.l10n.${locale}.json`);
      const missing = [...messages.keys()].filter((m) => !(m in bundle));
      expect(missing).toEqual([]);
      const stale = Object.keys(bundle).filter((k) => !messages.has(k));
      expect(stale).toEqual([]);
    });
  }

  it('keeps placeholders intact in every translation', () => {
    const bundle = load('l10n/bundle.l10n.pt-pt.json');
    for (const [en, pt] of Object.entries(bundle)) {
      expect((pt.match(/\{\d+\}/g) ?? []).sort(), en).toEqual((en.match(/\{\d+\}/g) ?? []).sort());
    }
  });

  it('translates the manifest strings', () => {
    const base = load('package.nls.json');
    const pt = load('package.nls.pt-pt.json');
    expect(Object.keys(pt).sort()).toEqual(Object.keys(base).sort());
  });

  it('formats placeholders with the default (English) translator', () => {
    setTranslator((m, ...a) => m.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)])));
    expect(t('Use nullptr rather than {0}.', 'NULL')).toBe('Use nullptr rather than NULL.');
  });
});
