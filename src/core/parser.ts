import { readFileSync } from 'node:fs';
import { Language, Parser, type Tree } from 'web-tree-sitter';

export interface WasmPaths {
  core: string;
  cpp: string;
}

let ready: Promise<Parser> | undefined;

/** Initialise web-tree-sitter once. Safe to call repeatedly. */
export function initParser(paths: WasmPaths): Promise<Parser> {
  ready ??= (async () => {
    await Parser.init({ locateFile: () => paths.core });
    const language = await Language.load(new Uint8Array(readFileSync(paths.cpp)));
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();
  return ready;
}

/** `[export] module m;`, `[export] import m;` / `import <h>;` / `import "h";` / `import :part;` / `module :private;` (one line each). */
const MODULE_DECLARATION = /^[ \t]*(?:export[ \t]+)?(?:module|import)[ \t]+(?::?[A-Za-z_][\w.]*(?::[A-Za-z_]\w*)?|<[^>\n]+>|"[^"\n]+")(?:[ \t]*\[\[[^\]\n]*\]\])?[ \t]*;/gm;

/**
 * tree-sitter-cpp knows no C++20 modules: `export module m;` and `export class X {` become parse errors that spread over
 * the whole body. Blank the module syntax out (same length, so every offset stays valid) before parsing: what is left
 * is ordinary C++ (`export` in front of a declaration or block is only a visibility marker).
 */
export function maskModuleSyntax(text: string): string {
  if (!/\b(?:export|module|import)\b/.test(text)) return text;
  const blank = (m: string): string => m.replace(/[^\r\n]/g, ' ');
  return text.replace(MODULE_DECLARATION, blank).replace(/^([ \t]*)export(?=[ \t]*[{A-Za-z_])/gm, (m) => blank(m));
}

export async function parse(text: string, paths: WasmPaths): Promise<Tree> {
  const parser = await initParser(paths);
  const tree = parser.parse(maskModuleSyntax(text));
  if (!tree) throw new Error('tree-sitter failed to parse the document');
  return tree;
}
