import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const nm = (p) => resolve('node_modules', p);
const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });
copyFileSync(nm('web-tree-sitter/tree-sitter.wasm'), 'dist/tree-sitter.wasm');
copyFileSync(nm('tree-sitter-wasms/out/tree-sitter-cpp.wasm'), 'dist/tree-sitter-cpp.wasm');

const options = {
  entryPoints: ['src/vscode/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  // The ESM build of web-tree-sitter relies on import.meta; use the CommonJS build.
  alias: { 'web-tree-sitter': nm('web-tree-sitter/tree-sitter.cjs') },
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
