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

export async function parse(text: string, paths: WasmPaths): Promise<Tree> {
  const parser = await initParser(paths);
  const tree = parser.parse(text);
  if (!tree) throw new Error('tree-sitter failed to parse the document');
  return tree;
}
