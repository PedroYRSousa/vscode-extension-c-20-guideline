import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clangTidyChecksArgument, parseClangTidyFixes } from './clangtidy.js';
import type { Finding } from './types.js';

export interface ClangTidyOptions {
  /** Path or name of the clang-tidy executable. */
  executable: string;
  filePath: string;
  /** The text of the file as it is on disk (offsets in the YAML refer to it). */
  text: string;
  /** Extra arguments passed to clang-tidy itself, e.g. `--extra-arg=-Iinclude`. */
  extraArgs?: string[];
  /** Directory that holds `compile_commands.json` (`-p`). Without it the file is analysed as C++20. */
  buildDir?: string;
  cwd?: string;
  timeoutMs?: number;
}

export class ClangTidyUnavailable extends Error {}

/** Run clang-tidy with only the checks that map to guideline rules and return them as findings. */
export async function runClangTidy(opts: ClangTidyOptions): Promise<Finding[]> {
  const dir = await mkdtemp(join(tmpdir(), 'cpp20-guidelines-'));
  const fixes = join(dir, 'fixes.yaml');
  const args = ['--quiet', `--checks=${clangTidyChecksArgument()}`, `--export-fixes=${fixes}`, ...(opts.extraArgs ?? [])];
  if (opts.buildDir) args.push('-p', opts.buildDir, opts.filePath);
  else args.push(opts.filePath, '--', '-std=c++20');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(opts.executable, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 }, (error) => {
        // clang-tidy exits non-zero when it reports errors; the exported fixes are still valid.
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(new ClangTidyUnavailable(`cannot run ${opts.executable}`));
        else resolve();
      });
    });
    let yaml: string;
    try {
      yaml = await readFile(fixes, 'utf8');
    } catch {
      return []; // clang-tidy found nothing (it writes no file then)
    }
    return parseClangTidyFixes(yaml, opts.filePath, opts.text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
