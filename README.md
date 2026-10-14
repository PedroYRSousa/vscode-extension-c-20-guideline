# C++20 Core Guidelines Enforcer

A VS Code / Antigravity extension that checks C++ source against the
[C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines), **modernised for C++20**:
where the guidelines point at a legacy facility, the extension steers you to the modern C++20 one, and every
diagnostic comes with a Quick Fix whenever a mechanical fix exists.

> Portuguese version: [README.pt-PT.md](README.pt-PT.md)

## What you get

* **Errors** for violations of the guidelines, **warnings** for optional / recommended ones
  ([how that is decided](docs/SEVERITY.md)). A single setting turns every warning off.
* **Quick Fixes** on every diagnostic: a *preferred* fix when the rewrite is behaviour preserving, separate
  fixes marked *"(may change behaviour - review)"* otherwise, "Open the documentation of the rule", and
  "Suppress on this line (justification required)". There is also a *Fix all safe issues* source action.
  A fix is withheld where it would have to cut through preprocessor lines or code the parser could not understand.
* **239 of the 469 rules** are checked by the built-in analyser (tree-sitter, works offline). The rest are
  listed with the reason in [docs/COVERAGE.md](docs/COVERAGE.md): many rules have no criterion that a tool can
  decide (the guideline itself says so), and some contradict C++20.
* **C++20 modernisation rules** (`CPP20.*`, warnings): `std::ranges`, concepts instead of `enable_if`,
  `std::erase_if`, `contains`/`starts_with`, `std::format`, `std::jthread`, `std::span`, `std::source_location`,
  `std::bit_cast`, `std::numbers`, `constinit`, `[[nodiscard]]`, `operator<=>`, `_v`/`_t` traits, removed facilities.
* Optional **clang-tidy bridge** for the rules that need real semantic analysis (e.g. use-after-move).
* Messages in **English and Portuguese** (follows the editor language).

Formatting is checked too: the Core Guidelines' own naming and layout rules (NL.*: K&R/Stroustrup braces,
`T* p` declarators, one statement per line, spaces, indentation, naming style) are part of the rule set. The
extension does not need a `.clang-format` to work, but the repository ships one that produces exactly this layout:
copy [`.clang-format`](.clang-format) to your project (clang-format 17+), see [docs/FORMATTING.md](docs/FORMATTING.md)
for what each option is for and for the few cases a formatter cannot fix.

## Install

```
npm ci
npm run build
npm run package        # creates cpp20-guidelines-<version>.vsix
```

Then *Extensions: Install from VSIX...* in VS Code or Antigravity. To debug, open the folder and press **F5**.

## Settings

| Setting | Default | |
|---|---|---|
| `cpp20Guidelines.enable` | `true` | Master switch. |
| `cpp20Guidelines.enableOptionalWarnings` | `true` | **Turn off to silence all warnings** (errors are never affected). |
| `cpp20Guidelines.run` | `onType` | `onType` (debounced) or `onSave`. |
| `cpp20Guidelines.exclude` | `build`, `third_party`, `external`, `vendor`, `node_modules` | Globs that are never analysed. |
| `cpp20Guidelines.gsl.enabled` | `false` | The Microsoft GSL is available: enables `gsl::not_null` (I.12/F.23) and offers `gsl::owner` (R.20). |
| `cpp20Guidelines.modules.enforce` | `false` | Also require `import <header>;` instead of `#include` (`CPP20.modules`). |
| `cpp20Guidelines.fileSuffixes.sources` / `.headers` | `.cpp .cxx .cc .C` / `.h .hh .hpp .hxx` | NL.27 / SF.1. |
| `cpp20Guidelines.thresholds.*` | 60 lines, 140 columns, 10 paths, 7 digits, 6 parameters | The numbers are the ones the guidelines suggest (F.3, NL.11, F.2). |
| `cpp20Guidelines.magicConstants.allowList` | `0 1 -1 2 ...` | ES.45 positive list. |
| `cpp20Guidelines.clangTidy.enabled` / `.path` / `.extraArgs` | `false` / `clang-tidy` / `[]` | Needs `clang-tidy` (and a `compile_commands.json` for real projects). Runs on save. |

## Suppressing a diagnostic

Errors cannot be disabled by configuration. A single deviation can be accepted *with a justification*:

```cpp
int* p = NULL;  // cpp20-guideline: ignore ES.47 -- the C API requires a literal NULL here

// cpp20-guideline: ignore F.9, ES.47 -- generated callback, signature is fixed
void on_event(int unused, int* p = NULL);
```

A trailing comment applies to its own line (and to the statement it ends, if a formatter wrapped it), a comment on
its own line applies to the next line (and to the rest of the head of the declaration that starts there). Without a
justification, or with an unknown rule, nothing is suppressed and the comment is itself an error (`CPP20.suppress`).
The *Suppress* Quick Fix asks for the justification and writes the comment for you.

## Honest limitations

* The analyser is **syntax-level** (tree-sitter): it has no type information. Rules that need types, data flow or
  the whole program are either not implemented, approximated conservatively (documented per rule in
  [docs/COVERAGE.md](docs/COVERAGE.md)), or available through the clang-tidy bridge.
* Where the guideline leaves room for interpretation, the choice made is written down in the *Notes* column of
  [docs/COVERAGE.md](docs/COVERAGE.md). The numeric thresholds are the ones given in the guideline text and are settings.
* Rules marked *superseded by C++20* (T.48, C.86, T.21) are deliberately not enforced: enforcing them would
  contradict C++20. GSL entities with a standard equivalent are replaced by the standard one (`CPP20.gsl_to_std`).
* The guideline text is **not** shipped: the repository only contains rule ids, links to the official text and
  our own wording. The Core Guidelines are © Standard C++ Foundation and its contributors (see `LICENSE`).

## Development

```
npm test                  # unit tests (vitest), including a real clang-tidy run when it is installed
npm run typecheck
npm run smoke             # loads the bundled dist/extension.js against a fake `vscode` module
npm run rules:extract     # re-read ../CppCoreGuidelines.md -> data/rules.json (pins the commit and the severities)
npm run docs:coverage     # regenerate docs/COVERAGE.md, docs/SEVERITY.md and data/coverage.json
node scripts/l10n-extract.mjs --list   # every translatable message
```

* `src/core` - analyser, symbol table, suppressions, clang-tidy bridge (no `vscode` import: unit-testable).
* `src/rules` - one file per group of rules; each `Check` declares the rule ids it can report (`covers`).
* `src/vscode` - diagnostics, code actions, commands, settings.
* `data/rules.json` - generated from the pinned guideline commit; `data/rule-status.json` - why a rule is not
  implemented, and per-rule interpretation notes.
* A new message must be added to `l10n/bundle.l10n.pt-pt.json` and `pt-br` (a test fails otherwise).
* `docs/local/` (git-ignored) holds the same tables **with** rule titles for local review.

## License

MIT for the extension code. See `LICENSE` for the attribution of the C++ Core Guidelines.
