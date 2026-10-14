# Formatting with clang-format

The repository ships a [`.clang-format`](../.clang-format) that produces exactly the layout the extension asks for.
Copy it to the root of your C++ project (or point `-style=file:<path>` at it) and format as usual.

* Needs **clang-format 17 or newer**. It is verified with clang-format 18.1.3.
* The test `test/clangformat.test.ts` formats a set of deliberately messy files (Allman, Google, GNU, tabs, CRLF, ...)
  with it and fails if the extension reports a layout problem on the result, if formatting is not stable, or if
  formatting creates or hides any other diagnostic.

## What each option is for

| Rule | What the extension checks | Options that satisfy it |
| --- | --- | --- |
| NL.4 | one indentation style, blocks indented one unit, closing brace aligned | `IndentWidth: 4`, `UseTab: Never`, `ContinuationIndentWidth: 4`, `IndentCaseBlocks: false`, `IndentPPDirectives: None`, `NamespaceIndentation: None`, `AccessModifierOffset: -4` |
| NL.17 | function brace on its own line, other braces on the line of their head, `case` aligned with `switch`, one branch per line | `BreakBeforeBraces: Stroustrup`, `IndentCaseLabels: false`, `AllowShortFunctionsOnASingleLine: None`, `AllowShortIfStatementsOnASingleLine: Never`, `AllowShortLoopsOnASingleLine: false`, `AllowShortBlocksOnASingleLine: Never`, `AllowShortCaseLabelsOnASingleLine: false` |
| NL.15 | a space after `if`/`for`/`while`/`switch`/`catch`, none after a function name or inside `()` `[]` `<>`, no padding | `SpaceBeforeParens: Custom` (+ `SpaceBeforeParensOptions`), `SpacesInParens: Never`, `SpacesInSquareBrackets: false`, `SpacesInAngles: Never`, `SpaceBeforeSquareBrackets: false`, `AlignConsecutive*: None`, `AlignTrailingComments: false` |
| NL.18 | `T* p`, `T& r` | `PointerAlignment: Left`, `ReferenceAlignment: Pointer`, `DerivePointerAlignment: false` |
| NL.26 | `const T`, not `T const` | `QualifierAlignment: Left` |
| NL.11 | digit separators from `digitSeparatorMinDigits` digits (default 7), groups of 3 (decimal) and 4 (hex, binary) | `IntegerLiteralSeparator` (`Decimal: 3`, `Hex: 4`, `Binary: 4`, all `*MinDigits: 7`) |
| NL.20 | one statement per line | clang-format's own behaviour, plus the `AllowShort*` options above |
| F.3 | no line wider than `thresholds.maxFunctionColumns` (default 140) in a function | `ColumnLimit: 100` |

Also: `CommentPragmas: '^ *cpp20-guideline:'` keeps clang-format from reflowing the suppression comments of the extension,
`SortIncludes: Never` leaves the order of the `#include` lines to you (reordering can change the meaning), and
`AlwaysBreakTemplateDeclarations: Yes` / `SpaceAfterTemplateKeyword: false` follow the examples of the Core Guidelines.

### Settings that must stay in step

* `cpp20Guidelines.thresholds.digitSeparatorMinDigits` (default 7) and the `*MinDigits` values of `IntegerLiteralSeparator`.
* `cpp20Guidelines.thresholds.maxFunctionColumns` (default 140) must not be smaller than `ColumnLimit`.
* The macros you use as statements without a trailing `;` (see below).

## What the extension accepts because clang-format produces it

Formatting real code showed that a few layouts which are perfectly consistent were reported, so the checks accept them:

* a block is indented relative to the line where its owner starts (wrapped conditions, wrapped lambda signatures),
  a lambda body relative to its closing brace (lambdas inside `if (...)` heads, argument lists and initializer lists);
* `goto` labels flushed out of the code column; preprocessor directives in column 0; the text of multi-line raw strings;
* `} break;` after a `case` block; a comment right after an opening brace; `[[likely]]`/`[[unlikely]]` in front of a body;
* padding that lines a column up with the line above or below (tables of values, chains of `?:`);
* `T v(a * b);` (a variable with a direct initialiser, not a declarator) and `int *a, *b;` (ES.10 reports those);
* octal literals, which are never grouped;
* C++20 module syntax (`export module m;`, `import m;`, `export namespace n { ... }`), which the grammar cannot parse;
* everything between `// clang-format off` and `// clang-format on` is not checked for layout rules.

## Suppression comments and wrapping

`// cpp20-guideline: ignore <rule> -- <why>` applies to its own line, **and** to the statement it ends (a trailing
comment) or to the head of the declaration below it (a comment alone on a line, everything before the first `{`). That
is what keeps the comment valid when clang-format wraps a long statement. Findings inside a function body are still
covered line by line: if clang-format expands a one-line function, move the comment to the line of the finding.

## What formatting cannot do

These cases keep a diagnostic after formatting, because no clang-format option exists for them. Each one has a quick
fix in the extension, and the result of the quick fix is stable under clang-format (no ping-pong).

| Case | Why | What to do |
| --- | --- | --- |
| a `//` comment (or a multi-line `/* */`) between the head of a statement or class and its `{` | clang-format never moves a brace past a comment | quick fix *Move the brace to the previous line* (`if (x) { // why`) |
| `T1 const&`, `DWORD const&`, `decltype(x) const&`, `struct S const*` | clang-format does not move `const` over all-caps names (it takes them for macros), `decltype(...)` and elaborated types | quick fix *Write const first* |
| `enum E const x`, `union U const x` | clang-format 18 rewrites them to the invalid `enum const E x` | write `const enum E x` before formatting |
| `int *a, *b;` | clang-format keeps this spelling on purpose | quick fix *Split into one declaration per name* (ES.10) |
| `#include < vector >` | the header name is a single token for clang-format | quick fix *Remove the extra space* |
| function-like macros used as statements without `;`, in lower or mixed case | clang-format joins them with the next line | list them under `StatementMacros:` in your copy of `.clang-format` |
| integer literals in macros that stringify or paste (`STR(12345678)`, `CAT(a, 1234567)`) | `IntegerLiteralSeparator` also rewrites macro arguments | keep such literals out of those macros, or wrap them in `// clang-format off` |

Two clang-format behaviours worth knowing: literals shorter than the minimum lose their separators (`65'535` becomes
`65535`), and a few constructs are only stable on the second run (`std::convertible_to<int> auto const&`).

The tree-sitter grammar behind the extension does not understand every macro-heavy construct (export macros in class
heads, attribute-like macros alone on a line, pointer-to-member data members, `new T*[n]`). A layout finding next to a
parse error is most likely an artefact of that; suppress it with a justification.
