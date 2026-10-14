# Aplicador das C++ Core Guidelines (C++20)

Uma extensão para VS Code / Antigravity que verifica código C++ contra as
[C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines), **modernizadas para C++20**:
onde as diretrizes apontam para algo legado, a extensão encaminha-o para a alternativa moderna do C++20, e cada
diagnóstico traz uma correção rápida (*Quick Fix*) sempre que existe uma correção mecânica.

## O que oferece

* **Erros** para violações das diretrizes e **avisos** para as opcionais/recomendadas
  ([como se decide](docs/SEVERITY.md)). Uma única definição desliga todos os avisos.
* **Correções rápidas** em cada diagnóstico: uma correção *preferida* quando a reescrita preserva o comportamento,
  correções separadas marcadas *"(pode alterar o comportamento - reveja)"* nos restantes casos, "Abrir a
  documentação da regra" e "Suprimir nesta linha (requer justificação)". Existe ainda a ação *Corrigir todos os
  problemas seguros*.
* **239 das 469 regras** são verificadas pelo analisador interno (tree-sitter, funciona offline). As restantes
  estão em [docs/COVERAGE.md](docs/COVERAGE.md) com o motivo: muitas não têm critério que uma ferramenta consiga
  decidir (a própria diretriz o diz) e algumas contradizem o C++20.
* **Regras de modernização C++20** (`CPP20.*`, avisos): `std::ranges`, conceitos em vez de `enable_if`,
  `std::erase_if`, `contains`/`starts_with`, `std::format`, `std::jthread`, `std::span`, `std::source_location`,
  `std::bit_cast`, `std::numbers`, `constinit`, `[[nodiscard]]`, `operator<=>`, traits `_v`/`_t` e facilidades removidas.
* **Ponte opcional para o clang-tidy**, para as regras que precisam de análise semântica real (p. ex. uso após movimento).
* Mensagens em **inglês e português** (segue o idioma do editor).

A formatação também é verificada pelas regras de nomes e layout das próprias diretrizes (NL.*: chavetas K&R/Stroustrup,
declaradores `T* p`, uma instrução por linha, espaços, indentação, estilo de nomes). A extensão **não** depende de
nenhum ficheiro `.clang-format`.

## Instalação

```
npm ci
npm run build
npm run package        # cria cpp20-guidelines-<versão>.vsix
```

Depois, *Extensões: Instalar a partir de VSIX...* no VS Code ou no Antigravity. Para depurar, abra a pasta e prima **F5**.

## Definições

| Definição | Por defeito | |
|---|---|---|
| `cpp20Guidelines.enable` | `true` | Interruptor geral. |
| `cpp20Guidelines.enableOptionalWarnings` | `true` | **Desligue para silenciar todos os avisos** (os erros nunca são afetados). |
| `cpp20Guidelines.run` | `onType` | `onType` (com atraso) ou `onSave`. |
| `cpp20Guidelines.exclude` | `build`, `third_party`, `external`, `vendor`, `node_modules` | Globs que nunca são analisados. |
| `cpp20Guidelines.gsl.enabled` | `false` | A Microsoft GSL está disponível: ativa `gsl::not_null` (I.12/F.23) e oferece `gsl::owner` (R.20). |
| `cpp20Guidelines.modules.enforce` | `false` | Exige também `import <cabeçalho>;` em vez de `#include` (`CPP20.modules`). |
| `cpp20Guidelines.fileSuffixes.sources` / `.headers` | `.cpp .cxx .cc .C` / `.h .hh .hpp .hxx` | NL.27 / SF.1. |
| `cpp20Guidelines.thresholds.*` | 60 linhas, 140 colunas, 10 caminhos, 7 dígitos, 6 parâmetros | Os valores que as diretrizes sugerem (F.3, NL.11, F.2). |
| `cpp20Guidelines.magicConstants.allowList` | `0 1 -1 2 ...` | Lista positiva da ES.45. |
| `cpp20Guidelines.clangTidy.enabled` / `.path` / `.extraArgs` | `false` / `clang-tidy` / `[]` | Precisa do `clang-tidy` (e de um `compile_commands.json` em projetos reais). Corre ao guardar. |

## Suprimir um diagnóstico

Os erros não se desligam por configuração. Um desvio pontual pode ser aceite *com justificação*:

```cpp
int* p = NULL;  // cpp20-guideline: ignore ES.47 -- a API em C exige um NULL literal aqui

// cpp20-guideline: ignore F.9, ES.47 -- callback gerado, a assinatura é fixa
void on_event(int unused, int* p = NULL);
```

Um comentário no fim da linha aplica-se à própria linha; um comentário sozinho aplica-se à linha seguinte. Sem
justificação, ou com uma regra desconhecida, nada é suprimido e o próprio comentário é um erro (`CPP20.suppress`).
A correção rápida *Suprimir* pede a justificação e escreve o comentário.

## Limitações assumidas

* O analisador é **sintático** (tree-sitter): não tem informação de tipos. As regras que precisam de tipos, fluxo de
  dados ou do programa inteiro ou não estão implementadas, ou são aproximadas de forma conservadora (documentado por
  regra em [docs/COVERAGE.md](docs/COVERAGE.md)), ou estão disponíveis através do clang-tidy.
* Onde a diretriz deixa margem de interpretação, a escolha feita está escrita na coluna *Notes* de
  [docs/COVERAGE.md](docs/COVERAGE.md). Os limiares numéricos são os do texto da diretriz e são definições.
* As regras marcadas *superseded* (T.48, C.86, T.21) não são aplicadas de propósito: contradiriam o C++20. As
  entidades GSL com equivalente padrão são substituídas pelo padrão (`CPP20.gsl_to_std`).
* O texto das diretrizes **não** é distribuído: o repositório só contém identificadores de regras, ligações para o
  texto oficial e palavras nossas. As Core Guidelines são © Standard C++ Foundation e colaboradores (ver `LICENSE`).

## Desenvolvimento

```
npm test                  # testes unitários (vitest), incluindo uma execução real do clang-tidy quando instalado
npm run typecheck
npm run smoke             # carrega o dist/extension.js empacotado contra um módulo `vscode` simulado
npm run rules:extract     # relê o CppCoreGuidelines.md -> data/rules.json (fixa o commit e as severidades)
npm run docs:coverage     # regenera docs/COVERAGE.md, docs/SEVERITY.md e data/coverage.json
node scripts/l10n-extract.mjs --list   # todas as mensagens traduzíveis
```

## Licença

MIT para o código da extensão. Ver `LICENSE` para a atribuição das C++ Core Guidelines.
