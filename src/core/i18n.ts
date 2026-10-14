export type Translator = (message: string, ...args: Array<string | number>) => string;

const format = (message: string, args: Array<string | number>): string =>
  message.replace(/\{(\d+)\}/g, (whole, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : whole));

let translator: Translator = (message, ...args) => format(message, args);

/** The VS Code layer installs `vscode.l10n.t` here (answer 9: en + pt-PT via localization). */
export function setTranslator(t: Translator): void {
  translator = t;
}

/**
 * Translate a message. The English literal is the l10n key, so it must be a plain string literal
 * (`scripts/l10n.mjs` extracts them from the sources).
 */
export function t(message: string, ...args: Array<string | number>): string {
  return translator(message, ...args);
}
