import type { Node, Tree } from 'web-tree-sitter';
import { severityOf } from './registry.js';
import { SymbolTable } from './symbols.js';
import type { AnalyzerConfig, FileInfo, Finding, Fix, ReportArgs, TextEdit } from './types.js';

/** Everything a check needs: the text, the syntax tree, an index of nodes by type, and `report`. */
export class Context {
  readonly findings: Finding[] = [];
  private readonly index = new Map<string, Node[]>();
  private readonly lineStarts: number[] = [0];
  private allowed: ReadonlySet<string> | undefined;
  private symbolTable: SymbolTable | undefined;
  private errorRanges: Array<[number, number]> | undefined;

  constructor(
    readonly text: string,
    readonly tree: Tree,
    readonly file: FileInfo,
    readonly config: AnalyzerConfig,
  ) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    this.buildIndex();
  }

  get root(): Node {
    return this.tree.rootNode;
  }

  /** Syntax-only symbol table (built on first use). */
  get symbols(): SymbolTable {
    this.symbolTable ??= new SymbolTable(this.root, this.text);
    return this.symbolTable;
  }

  /** True when `offset` lies inside a region tree-sitter could not parse (results there are unreliable). */
  inSyntaxError(offset: number): boolean {
    this.errorRanges ??= this.nodesOf('ERROR').map((n): [number, number] => [n.startIndex, n.endIndex]);
    return this.errorRanges.some(([s, e]) => offset >= s && offset < e);
  }

  /** Limit `report` to the ids a check declared in `covers` (programming error otherwise). */
  restrictTo(ids: readonly string[] | undefined): void {
    this.allowed = ids ? new Set(ids) : undefined;
  }

  private buildIndex(): void {
    const cursor = this.tree.walk();
    let reachedRoot = false;
    while (!reachedRoot) {
      const node = cursor.currentNode;
      const list = this.index.get(node.type);
      if (list) list.push(node);
      else this.index.set(node.type, [node]);
      if (cursor.gotoFirstChild()) continue;
      if (cursor.gotoNextSibling()) continue;
      for (;;) {
        if (!cursor.gotoParent()) {
          reachedRoot = true;
          break;
        }
        if (cursor.gotoNextSibling()) break;
      }
    }
    cursor.delete();
  }

  /** All nodes of the given types, in document order per type. */
  nodesOf(...types: string[]): Node[] {
    if (types.length === 1) return this.index.get(types[0]) ?? [];
    const out: Node[] = [];
    for (const type of types) out.push(...(this.index.get(type) ?? []));
    return out.sort((a, b) => a.startIndex - b.startIndex);
  }

  slice(start: number, end: number): string {
    return this.text.slice(start, end);
  }

  src(node: Node): string {
    return this.text.slice(node.startIndex, node.endIndex);
  }

  // ---- lines -------------------------------------------------------------------------------

  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  lineStart(line: number): number {
    return this.lineStarts[Math.min(line, this.lineStarts.length - 1)];
  }

  lineEnd(line: number): number {
    return line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] - 1 : this.text.length;
  }

  lineText(line: number): string {
    return this.text.slice(this.lineStart(line), this.lineEnd(line)).replace(/\r$/, '');
  }

  /** Leading whitespace of the line that contains `offset`. */
  indentAt(offset: number): string {
    const text = this.lineText(this.lineOf(offset));
    return /^[ \t]*/.exec(text)![0];
  }

  column(offset: number): number {
    return offset - this.lineStart(this.lineOf(offset));
  }

  /** True when only whitespace precedes `offset` on its line. */
  startsLine(offset: number): boolean {
    return /^[ \t]*$/.test(this.text.slice(this.lineStart(this.lineOf(offset)), offset));
  }

  get eol(): string {
    return this.text.includes('\r\n') ? '\r\n' : '\n';
  }

  /** The indentation unit used by the file (first indented line wins; four spaces by default). */
  get indentUnit(): string {
    for (let i = 0; i < this.lineStarts.length; i++) {
      const m = /^([ \t]+)\S/.exec(this.lineText(i));
      if (m) return m[1].startsWith('\t') ? '\t' : ' '.repeat(Math.min(m[1].length, 8));
    }
    return '    ';
  }

  // ---- reporting ---------------------------------------------------------------------------

  report(args: ReportArgs): void {
    if (this.allowed && !this.allowed.has(args.ruleId)) {
      throw new Error(`check reported ${args.ruleId} without declaring it in 'covers'`);
    }
    const start = args.start ?? args.node?.startIndex;
    const end = args.end ?? args.node?.endIndex;
    if (start === undefined || end === undefined) throw new Error('report() needs a node or an offset range');
    if (this.inSyntaxError(start)) return;
    this.findings.push({
      ruleId: args.ruleId,
      severity: severityOf(args.ruleId),
      start,
      end: end > start ? end : Math.min(start + 1, this.text.length),
      message: args.message,
      fixes: args.fixes ?? [],
      alsoCovers: args.alsoCovers ?? [],
    });
  }

  // ---- fixes -------------------------------------------------------------------------------

  fix(title: string, edits: TextEdit[], safety: Fix['safety'] = 'safe'): Fix {
    return { title, edits, safety };
  }

  replace(node: Node, text: string): TextEdit {
    return { start: node.startIndex, end: node.endIndex, text };
  }

  replaceRange(start: number, end: number, text: string): TextEdit {
    return { start, end, text };
  }

  remove(node: Node): TextEdit {
    return { start: node.startIndex, end: node.endIndex, text: '' };
  }

  insertAt(offset: number, text: string): TextEdit {
    return { start: offset, end: offset, text };
  }

  /** Edits that make sure `#include <header>` is present (none when it already is). */
  includeEdits(header: string): TextEdit[] {
    const includes = this.nodesOf('preproc_include');
    const wanted = new RegExp(`^\\s*#\\s*include\\s*[<"]${header.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}[>"]`);
    if (includes.some((n) => wanted.test(this.src(n)))) return [];
    const eol = this.eol;
    const system = includes.filter((n) => n.childForFieldName('path')?.type === 'system_lib_string');
    const anchor = system.length > 0 ? system[system.length - 1] : includes[includes.length - 1];
    if (anchor) {
      const lineEnd = this.lineEnd(this.lineOf(anchor.endIndex - 1));
      return [this.insertAt(lineEnd, `${eol}#include <${header}>`)];
    }
    return [this.insertAt(this.preambleEnd(), `#include <${header}>${eol}`)];
  }

  /** Offset after a leading comment block / include guard, where a new `#include` can go. */
  preambleEnd(): number {
    let offset = 0;
    for (const child of this.root.children) {
      if (!child) continue;
      if (child.type === 'comment') {
        offset = this.lineEnd(this.lineOf(child.endIndex - 1)) + 1;
        continue;
      }
      if (child.type === 'preproc_ifdef' || child.type === 'preproc_if') {
        // header guard: insert after `#define GUARD`
        const define = child.children.find((c) => c?.type === 'preproc_def');
        if (define) return this.lineEnd(this.lineOf(define.endIndex - 1)) + 1;
      }
      break;
    }
    return Math.min(offset, this.text.length);
  }
}
