# Error or warning? (answer 3A)

The guideline has no formal "optional" category, so the severity of each rule is derived from its own wording:

* **warning** when the rule says it is only a recommendation (`This is a recommendation for when you have no constraints or better ideas`, used by the naming/layout rules), or when its title contains *prefer*, *consider*, *avoid*, *favor*, *should* or *ideally*;
* **error** for everything else (`Don't…`, `Never…`, `Use…`, `Always…`, `Make…`, …).

Warnings disappear when `cpp20Guidelines.enableOptionalWarnings` is off; errors never do. The `CPP20.*` modernisations are always warnings.

354 errors and 115 warnings in total.

To change a classification, edit `scripts/extract-rules.mjs` (the keyword list) and run `npm run rules:extract && npm run docs:coverage`.

## In

| Rule | Severity | Decided by |
|---|---|---|
| [In.0](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#r0) | error | default (error) |

## P

| Rule | Severity | Decided by |
|---|---|---|
| [P.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-direct) | error | default (error) |
| [P.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-cplusplus) | error | default (error) |
| [P.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-what) | error | default (error) |
| [P.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-typesafe) | warning | title: "ideally" |
| [P.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-compile-time) | warning | title: "prefer" |
| [P.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-run-time) | warning | title: "should" |
| [P.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-early) | error | default (error) |
| [P.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-leak) | error | default (error) |
| [P.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-waste) | error | default (error) |
| [P.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-mutable) | warning | title: "prefer" |
| [P.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-library) | error | default (error) |
| [P.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-tools) | error | default (error) |
| [P.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rp-lib) | error | default (error) |

## I

| Rule | Severity | Decided by |
|---|---|---|
| [I.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-explicit) | error | default (error) |
| [I.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-global) | warning | title: "avoid" |
| [I.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-singleton) | warning | title: "avoid" |
| [I.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-typed) | error | default (error) |
| [I.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-pre) | error | default (error) |
| [I.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-expects) | warning | title: "prefer" |
| [I.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-post) | error | default (error) |
| [I.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-ensures) | warning | title: "prefer" |
| [I.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-concepts) | error | default (error) |
| [I.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-except) | error | default (error) |
| [I.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-raw) | error | default (error) |
| [I.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-nullptr) | error | default (error) |
| [I.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-array) | error | default (error) |
| [I.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-global-init) | warning | title: "avoid" |
| [I.23](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-nargs) | error | default (error) |
| [I.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-unrelated) | warning | title: "avoid" |
| [I.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-abstract) | warning | title: "prefer" |
| [I.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-abi) | error | default (error) |
| [I.27](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-pimpl) | warning | title: "consider" |
| [I.30](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-encapsulate) | error | default (error) |

## F

| Rule | Severity | Decided by |
|---|---|---|
| [F.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-package) | error | default (error) |
| [F.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-logical) | warning | title: "should" |
| [F.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-single) | error | default (error) |
| [F.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-constexpr) | error | default (error) |
| [F.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-inline) | error | default (error) |
| [F.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-noexcept) | error | default (error) |
| [F.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-smart) | error | default (error) |
| [F.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-pure) | warning | title: "prefer" |
| [F.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-unused) | warning | title: "should" |
| [F.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-name) | error | default (error) |
| [F.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-lambda) | error | default (error) |
| [F.15](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-conventional) | warning | title: "prefer" |
| [F.16](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-in) | error | default (error) |
| [F.17](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-inout) | error | default (error) |
| [F.18](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-consume) | error | default (error) |
| [F.19](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-forward) | error | default (error) |
| [F.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-out) | warning | title: "prefer" |
| [F.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-out-multi) | warning | title: "prefer" |
| [F.60](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-ptr-ref) | warning | title: "prefer" |
| [F.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-ptr) | error | default (error) |
| [F.23](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-nullptr) | error | default (error) |
| [F.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-range) | error | default (error) |
| [F.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-zstring) | error | default (error) |
| [F.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-unique_ptr) | error | default (error) |
| [F.27](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-shared_ptr) | error | default (error) |
| [F.42](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-ptr) | error | default (error) |
| [F.43](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-dangle) | error | default (error) |
| [F.44](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-ref) | error | default (error) |
| [F.45](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-ref-ref) | error | default (error) |
| [F.46](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-main) | error | default (error) |
| [F.47](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-assignment-op) | error | default (error) |
| [F.48](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-move-local) | error | default (error) |
| [F.49](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-const) | error | default (error) |
| [F.50](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-capture-vs-overload) | error | default (error) |
| [F.51](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-default-args) | warning | title: "prefer" |
| [F.52](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-reference-capture) | warning | title: "prefer" |
| [F.53](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-value-capture) | warning | title: "avoid" |
| [F.54](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-this-capture) | error | default (error) |
| [F.55](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#f-varargs) | error | default (error) |
| [F.56](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#f-nesting) | warning | title: "avoid" |

## C

| Rule | Severity | Decided by |
|---|---|---|
| [C.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-org) | error | default (error) |
| [C.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-struct) | error | default (error) |
| [C.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-interface) | error | default (error) |
| [C.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-member) | error | default (error) |
| [C.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-helper) | error | default (error) |
| [C.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-standalone) | error | default (error) |
| [C.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-class) | error | default (error) |
| [C.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-private) | error | default (error) |
| [C.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-concrete) | warning | title: "prefer" |
| [C.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-regular) | error | default (error) |
| [C.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-constref) | error | default (error) |
| [C.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-lifetime) | error | default (error) |
| [C.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-zero) | warning | title: "avoid" |
| [C.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-five) | error | default (error) |
| [C.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-matched) | error | default (error) |
| [C.30](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor) | error | default (error) |
| [C.31](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-release) | error | default (error) |
| [C.32](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-ptr) | warning | title: "consider" |
| [C.33](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-ptr2) | error | default (error) |
| [C.35](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-virtual) | warning | title: "should" |
| [C.36](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-fail) | error | default (error) |
| [C.37](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-noexcept) | error | default (error) |
| [C.40](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-ctor) | error | default (error) |
| [C.41](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-complete) | warning | title: "should" |
| [C.42](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-throw) | error | default (error) |
| [C.43](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-default0) | error | default (error) |
| [C.44](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-default00) | warning | title: "prefer" |
| [C.45](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-default) | error | default (error) |
| [C.46](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-explicit) | error | default (error) |
| [C.47](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-order) | error | default (error) |
| [C.48](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-in-class-initializer) | warning | title: "prefer" |
| [C.49](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-initialize) | warning | title: "prefer" |
| [C.50](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-factory) | error | default (error) |
| [C.51](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-delegating) | error | default (error) |
| [C.52](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-inheriting) | error | default (error) |
| [C.60](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-copy-assignment) | error | default (error) |
| [C.61](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-copy-semantic) | warning | title: "should" |
| [C.62](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-copy-self) | error | default (error) |
| [C.63](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-move-assignment) | error | default (error) |
| [C.64](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-move-semantic) | warning | title: "should" |
| [C.65](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-move-self) | error | default (error) |
| [C.66](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-move-noexcept) | error | default (error) |
| [C.67](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-copy-virtual) | warning | title: "should" |
| [C.80](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-eqdefault) | error | default (error) |
| [C.81](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-delete) | error | default (error) |
| [C.82](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-ctor-virtual) | error | default (error) |
| [C.83](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-swap) | warning | title: "consider" |
| [C.84](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-swap-fail) | error | default (error) |
| [C.85](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-swap-noexcept) | error | default (error) |
| [C.86](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-eq) | error | default (error) |
| [C.87](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-eq-base) | error | default (error) |
| [C.89](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-hash) | error | default (error) |
| [C.90](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-memset) | error | default (error) |
| [C.100](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcon-stl) | error | default (error) |
| [C.101](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcon-val) | error | default (error) |
| [C.102](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcon-move) | error | default (error) |
| [C.103](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcon-init) | error | default (error) |
| [C.104](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcon-empty) | error | default (error) |
| [C.109](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcon-ptr) | error | default (error) |
| [C.120](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-domain) | error | default (error) |
| [C.121](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-abstract) | error | default (error) |
| [C.122](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-separation) | error | default (error) |
| [C.126](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-abstract-ctor) | error | default (error) |
| [C.127](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-dtor) | warning | title: "should" |
| [C.128](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-override) | warning | title: "should" |
| [C.129](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-kind) | error | default (error) |
| [C.130](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-copy) | warning | title: "prefer" |
| [C.131](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-get) | warning | title: "avoid" |
| [C.132](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-virtual) | error | default (error) |
| [C.133](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-protected) | warning | title: "avoid" |
| [C.134](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-public) | error | default (error) |
| [C.135](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-mi-interface) | error | default (error) |
| [C.136](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-mi-implementation) | error | default (error) |
| [C.137](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-vbase) | warning | title: "avoid" |
| [C.138](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-using) | error | default (error) |
| [C.139](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-final) | error | default (error) |
| [C.140](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-virtual-default-arg) | error | default (error) |
| [C.145](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-poly) | error | default (error) |
| [C.146](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-dynamic_cast) | error | default (error) |
| [C.147](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-ref-cast) | error | default (error) |
| [C.148](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-ptr-cast) | error | default (error) |
| [C.149](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-smart) | warning | title: "avoid" |
| [C.150](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-make_unique) | error | default (error) |
| [C.151](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-make_shared) | error | default (error) |
| [C.152](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-array) | error | default (error) |
| [C.153](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rh-use-virtual) | warning | title: "prefer" |
| [C.160](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-conventional) | error | default (error) |
| [C.161](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-symmetric) | error | default (error) |
| [C.162](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-equivalent) | error | default (error) |
| [C.163](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-equivalent-2) | error | default (error) |
| [C.164](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-conversion) | warning | title: "avoid" |
| [C.165](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-custom) | error | default (error) |
| [C.166](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-address-of) | error | default (error) |
| [C.167](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-overload) | error | default (error) |
| [C.168](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-namespace) | error | default (error) |
| [C.170](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ro-lambda) | error | default (error) |
| [C.180](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ru-union) | error | default (error) |
| [C.181](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ru-naked) | warning | title: "avoid" |
| [C.182](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ru-anonymous) | error | default (error) |
| [C.183](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ru-pun) | error | default (error) |

## Enum

| Rule | Severity | Decided by |
|---|---|---|
| [Enum.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-macro) | warning | title: "prefer" |
| [Enum.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-set) | error | default (error) |
| [Enum.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-class) | warning | title: "prefer" |
| [Enum.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-oper) | error | default (error) |
| [Enum.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-caps) | error | default (error) |
| [Enum.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-unnamed) | warning | title: "avoid" |
| [Enum.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-underlying) | error | default (error) |
| [Enum.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#renum-value) | error | default (error) |

## R

| Rule | Severity | Decided by |
|---|---|---|
| [R.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-raii) | error | default (error) |
| [R.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-use-ptr) | error | default (error) |
| [R.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-ptr) | error | default (error) |
| [R.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-ref) | error | default (error) |
| [R.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-scoped) | warning | title: "prefer" |
| [R.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-global) | warning | title: "avoid" |
| [R.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-mallocfree) | warning | title: "avoid" |
| [R.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-newdelete) | warning | title: "avoid" |
| [R.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-immediate-alloc) | error | default (error) |
| [R.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-single-alloc) | error | default (error) |
| [R.14](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-ap) | warning | title: "avoid" |
| [R.15](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-pair) | error | default (error) |
| [R.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-owner) | error | default (error) |
| [R.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-unique) | warning | title: "prefer" |
| [R.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-make_shared) | error | default (error) |
| [R.23](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-make_unique) | error | default (error) |
| [R.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-weak_ptr) | error | default (error) |
| [R.30](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-smartptrparam) | error | default (error) |
| [R.31](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-smart) | error | default (error) |
| [R.32](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-uniqueptrparam) | error | default (error) |
| [R.33](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-reseat) | error | default (error) |
| [R.34](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-sharedptrparam-owner) | error | default (error) |
| [R.35](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-sharedptrparam) | error | default (error) |
| [R.36](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-sharedptrparam-const) | error | default (error) |
| [R.37](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-smartptrget) | error | default (error) |

## ES

| Rule | Severity | Decided by |
|---|---|---|
| [ES.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-lib) | warning | title: "prefer" |
| [ES.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-abstr) | warning | title: "prefer" |
| [ES.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-dry) | warning | title: "avoid" |
| [ES.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-scope) | error | default (error) |
| [ES.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-cond) | error | default (error) |
| [ES.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-name-length) | error | default (error) |
| [ES.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-name-similar) | warning | title: "avoid" |
| [ES.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-not-caps) | warning | title: "avoid" |
| [ES.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-name-one) | error | default (error) |
| [ES.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-auto) | warning | title: "avoid" |
| [ES.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-reuse) | error | default (error) |
| [ES.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-always) | error | default (error) |
| [ES.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-introduce) | error | default (error) |
| [ES.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-init) | error | default (error) |
| [ES.23](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-list) | warning | title: "prefer" |
| [ES.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-unique) | error | default (error) |
| [ES.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-const) | error | default (error) |
| [ES.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-recycle) | error | default (error) |
| [ES.27](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-stack) | error | default (error) |
| [ES.28](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-lambda-init) | error | default (error) |
| [ES.30](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-macros) | error | default (error) |
| [ES.31](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-macros2) | error | default (error) |
| [ES.32](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-all_caps) | error | default (error) |
| [ES.33](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-macros3) | error | default (error) |
| [ES.34](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-ellipses) | error | default (error) |
| [ES.40](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-complicated) | warning | title: "avoid" |
| [ES.41](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-parens) | error | default (error) |
| [ES.42](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-ptr) | error | default (error) |
| [ES.43](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-order) | warning | title: "avoid" |
| [ES.44](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-order-fct) | error | default (error) |
| [ES.45](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-magic) | warning | title: "avoid" |
| [ES.46](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-narrowing) | warning | title: "avoid" |
| [ES.47](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-nullptr) | error | default (error) |
| [ES.48](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-casts) | warning | title: "avoid" |
| [ES.49](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-casts-named) | error | default (error) |
| [ES.50](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-casts-const) | error | default (error) |
| [ES.55](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-range-checking) | warning | title: "avoid" |
| [ES.56](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-move) | error | default (error) |
| [ES.60](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-new) | warning | title: "avoid" |
| [ES.61](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-del) | error | default (error) |
| [ES.62](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-arr2) | error | default (error) |
| [ES.63](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-slice) | error | default (error) |
| [ES.64](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-construct) | error | default (error) |
| [ES.65](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-deref) | error | default (error) |
| [ES.70](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-switch-if) | warning | title: "prefer" |
| [ES.71](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-for-range) | warning | title: "prefer" |
| [ES.72](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-for-while) | warning | title: "prefer" |
| [ES.73](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-while-for) | warning | title: "prefer" |
| [ES.74](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-for-init) | warning | title: "prefer" |
| [ES.75](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-do) | warning | title: "avoid" |
| [ES.76](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-goto) | warning | title: "avoid" |
| [ES.77](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-continue) | error | default (error) |
| [ES.78](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-break) | error | default (error) |
| [ES.79](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-default) | error | default (error) |
| [ES.84](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-noname) | error | default (error) |
| [ES.85](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-empty) | error | default (error) |
| [ES.86](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-loop-counter) | warning | title: "avoid" |
| [ES.87](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-if) | error | default (error) |
| [ES.100](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-mix) | error | default (error) |
| [ES.101](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-unsigned) | error | default (error) |
| [ES.102](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-signed) | error | default (error) |
| [ES.103](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-overflow) | error | default (error) |
| [ES.104](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-underflow) | error | default (error) |
| [ES.105](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-zero) | error | default (error) |
| [ES.106](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-nonnegative) | warning | title: "avoid" |
| [ES.107](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-subscripts) | warning | title: "prefer" |

## Per

| Rule | Severity | Decided by |
|---|---|---|
| [Per.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-reason) | error | default (error) |
| [Per.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-knuth) | error | default (error) |
| [Per.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-critical) | error | default (error) |
| [Per.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-simple) | error | default (error) |
| [Per.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-low) | error | default (error) |
| [Per.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-measure) | error | default (error) |
| [Per.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-efficiency) | error | default (error) |
| [Per.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-type) | error | default (error) |
| [Per.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-comp) | error | default (error) |
| [Per.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-alias) | error | default (error) |
| [Per.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-indirect) | error | default (error) |
| [Per.14](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-alloc) | error | default (error) |
| [Per.15](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-alloc0) | error | default (error) |
| [Per.16](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-compact) | error | default (error) |
| [Per.17](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-struct) | error | default (error) |
| [Per.18](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-space) | error | default (error) |
| [Per.19](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-access) | error | default (error) |
| [Per.30](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rper-context) | warning | title: "avoid" |

## CP

| Rule | Severity | Decided by |
|---|---|---|
| [CP.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-multi) | error | default (error) |
| [CP.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-races) | warning | title: "avoid" |
| [CP.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-data) | error | default (error) |
| [CP.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-task) | error | default (error) |
| [CP.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-volatile) | error | default (error) |
| [CP.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-tools) | error | default (error) |
| [CP.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-raii) | error | default (error) |
| [CP.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-lock) | error | default (error) |
| [CP.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-unknown) | error | default (error) |
| [CP.23](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-join) | error | default (error) |
| [CP.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-detach) | error | default (error) |
| [CP.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-joining_thread) | warning | title: "prefer" |
| [CP.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-detached_thread) | error | default (error) |
| [CP.31](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-data-by-value) | error | default (error) |
| [CP.32](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-shared) | error | default (error) |
| [CP.40](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-switch) | error | default (error) |
| [CP.41](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-create) | error | default (error) |
| [CP.42](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-wait) | error | default (error) |
| [CP.43](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-time) | error | default (error) |
| [CP.44](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-name) | error | default (error) |
| [CP.50](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-mutex) | error | default (error) |
| [CP.51](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcoro-capture) | error | default (error) |
| [CP.52](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcoro-locks) | error | default (error) |
| [CP.53](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcoro-reference-parameters) | warning | title: "should" |
| [CP.60](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-future) | error | default (error) |
| [CP.61](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-async) | error | default (error) |
| [CP.100](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-lockfree) | error | default (error) |
| [CP.101](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-distrust) | error | default (error) |
| [CP.102](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-literature) | error | default (error) |
| [CP.110](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-double) | error | default (error) |
| [CP.111](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-double-pattern) | error | default (error) |
| [CP.200](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-volatile2) | error | default (error) |
| [CP.201](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-signal) | error | default (error) |

## E

| Rule | Severity | Decided by |
|---|---|---|
| [E.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-design) | error | default (error) |
| [E.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-throw) | error | default (error) |
| [E.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-errors) | error | default (error) |
| [E.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-design-invariants) | error | default (error) |
| [E.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-invariant) | error | default (error) |
| [E.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-raii) | error | default (error) |
| [E.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-precondition) | error | default (error) |
| [E.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-postcondition) | error | default (error) |
| [E.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-noexcept) | error | default (error) |
| [E.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-never-throw) | error | default (error) |
| [E.14](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-exception-types) | error | default (error) |
| [E.15](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-exception-ref) | error | default (error) |
| [E.16](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-never-fail) | error | default (error) |
| [E.17](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-not-always) | error | default (error) |
| [E.18](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-catch) | error | default (error) |
| [E.19](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-finally) | error | default (error) |
| [E.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-no-throw-raii) | error | default (error) |
| [E.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-no-throw-crash) | warning | title: "consider" |
| [E.27](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-no-throw-codes) | error | default (error) |
| [E.28](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-no-throw) | warning | title: "avoid" |
| [E.30](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-specifications) | error | default (error) |
| [E.31](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re_catch) | error | default (error) |

## Con

| Rule | Severity | Decided by |
|---|---|---|
| [Con.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconst-immutable) | error | default (error) |
| [Con.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconst-fct) | error | default (error) |
| [Con.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconst-ref) | error | default (error) |
| [Con.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconst-const) | error | default (error) |
| [Con.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconst-constexpr) | error | default (error) |

## T

| Rule | Severity | Decided by |
|---|---|---|
| [T.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-raise) | error | default (error) |
| [T.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-algo) | error | default (error) |
| [T.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-cont) | error | default (error) |
| [T.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-expr) | error | default (error) |
| [T.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-generic-oo) | error | default (error) |
| [T.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-concepts) | error | default (error) |
| [T.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-std-concepts) | error | default (error) |
| [T.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-auto) | warning | title: "prefer" |
| [T.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-shorthand) | warning | title: "prefer" |
| [T.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-low) | warning | title: "avoid" |
| [T.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-complete) | error | default (error) |
| [T.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-axiom) | error | default (error) |
| [T.23](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-refine) | error | default (error) |
| [T.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-tag) | error | default (error) |
| [T.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-not) | warning | title: "avoid" |
| [T.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-use) | warning | title: "prefer" |
| [T.40](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-fo) | error | default (error) |
| [T.41](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-essential) | error | default (error) |
| [T.42](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-alias) | error | default (error) |
| [T.43](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-using) | warning | title: "prefer" |
| [T.44](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-deduce) | error | default (error) |
| [T.46](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-regular) | error | default (error) |
| [T.47](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-visible) | warning | title: "avoid" |
| [T.48](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-concept-def) | error | default (error) |
| [T.49](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-erasure) | warning | title: "avoid" |
| [T.60](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-depend) | error | default (error) |
| [T.61](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-scary) | error | default (error) |
| [T.62](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-nondependent) | error | default (error) |
| [T.64](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-specialization) | error | default (error) |
| [T.65](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-tag-dispatch) | error | default (error) |
| [T.67](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-specialization2) | error | default (error) |
| [T.68](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-cast) | warning | title: "avoid" |
| [T.69](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-customization) | error | default (error) |
| [T.80](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-hier) | error | default (error) |
| [T.81](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-array) | error | default (error) |
| [T.82](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-linear) | error | default (error) |
| [T.83](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-virtual) | error | default (error) |
| [T.84](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-abi) | error | default (error) |
| [T.100](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-variadic) | error | default (error) |
| [T.101](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-variadic-pass) | error | default (error) |
| [T.102](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-variadic-process) | error | default (error) |
| [T.103](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-variadic-not) | error | default (error) |
| [T.120](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-metameta) | error | default (error) |
| [T.121](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-emulate) | error | default (error) |
| [T.122](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-tmp) | error | default (error) |
| [T.123](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-fct) | error | default (error) |
| [T.124](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-std-tmp) | warning | title: "prefer" |
| [T.125](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-lib) | error | default (error) |
| [T.140](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-name) | error | default (error) |
| [T.141](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-lambda) | error | default (error) |
| [T.142?](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-var) | error | default (error) |
| [T.143](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-non-generic) | error | default (error) |
| [T.144](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-specialize-function) | error | default (error) |
| [T.150](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rt-check-class) | error | default (error) |

## CPL

| Rule | Severity | Decided by |
|---|---|---|
| [CPL.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcpl-c) | warning | title: "prefer" |
| [CPL.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcpl-subset) | error | default (error) |
| [CPL.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcpl-interface) | error | default (error) |

## SF

| Rule | Severity | Decided by |
|---|---|---|
| [SF.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-file-suffix) | error | default (error) |
| [SF.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-inline) | error | default (error) |
| [SF.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-declaration-header) | error | default (error) |
| [SF.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-include-order) | error | default (error) |
| [SF.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-consistency) | error | default (error) |
| [SF.6](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-using) | error | default (error) |
| [SF.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-using-directive) | error | default (error) |
| [SF.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-guards) | error | default (error) |
| [SF.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-cycles) | warning | title: "avoid" |
| [SF.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-implicit) | warning | title: "avoid" |
| [SF.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-contained) | warning | title: "should" |
| [SF.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-incform) | warning | title: "prefer" |
| [SF.13](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-portable-header-id) | error | default (error) |
| [SF.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-namespace) | error | default (error) |
| [SF.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-unnamed) | error | default (error) |
| [SF.22](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-unnamed2) | error | default (error) |

## SL

| Rule | Severity | Decided by |
|---|---|---|
| [SL.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rsl-lib) | error | default (error) |
| [SL.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rsl-sl) | warning | title: "prefer" |
| [SL.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#sl-std) | error | default (error) |
| [SL.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#sl-safe) | error | default (error) |
| [SL.con.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rsl-arrays) | warning | title: "prefer" |
| [SL.con.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rsl-vector) | warning | title: "prefer" |
| [SL.con.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rsl-bounds) | warning | title: "avoid" |
| [SL.con.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rsl-copy) | error | default (error) |
| [SL.str.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-string) | error | default (error) |
| [SL.str.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-view) | error | default (error) |
| [SL.str.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-zstring) | error | default (error) |
| [SL.str.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-charp) | error | default (error) |
| [SL.str.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-byte) | error | default (error) |
| [SL.str.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-locale) | error | default (error) |
| [SL.str.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-span) | error | default (error) |
| [SL.str.12](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rstr-s) | error | default (error) |
| [SL.io.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-low) | error | default (error) |
| [SL.io.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-validate) | warning | title: "consider" |
| [SL.io.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-streams) | warning | title: "prefer" |
| [SL.io.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-sync) | error | default (error) |
| [SL.io.50](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-endl) | warning | title: "avoid" |
| [SL.C.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rclib-jmp) | error | default (error) |

## A

| Rule | Severity | Decided by |
|---|---|---|
| [A.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ra-stable) | error | default (error) |
| [A.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ra-lib) | error | default (error) |
| [A.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ra-dag) | warning | title: "should" |

## NL

| Rule | Severity | Decided by |
|---|---|---|
| [NL.1](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-comments) | error | default (error) |
| [NL.2](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-comments-intent) | error | default (error) |
| [NL.3](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-comments-crisp) | error | default (error) |
| [NL.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-indent) | error | default (error) |
| [NL.5](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-name-type) | warning | title: "avoid" |
| [NL.7](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-name-length) | error | default (error) |
| [NL.8](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-name) | error | default (error) |
| [NL.9](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-all-caps) | error | default (error) |
| [NL.10](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-camel) | warning | text: "recommendation" |
| [NL.11](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-literals) | error | default (error) |
| [NL.15](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-space) | warning | text: "recommendation" |
| [NL.16](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-order) | warning | text: "recommendation" |
| [NL.17](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-knr) | warning | text: "recommendation" |
| [NL.18](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-ptr) | warning | text: "recommendation" |
| [NL.19](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-misread) | warning | title: "avoid" |
| [NL.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-stmt) | error | default (error) |
| [NL.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-dcl) | error | default (error) |
| [NL.25](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-void) | error | default (error) |
| [NL.26](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-const) | warning | text: "recommendation" |
| [NL.27](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rl-file-suffix) | error | default (error) |
