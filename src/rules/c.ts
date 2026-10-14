import type { Node } from 'web-tree-sitter';
import { ancestor, field, kids, namedKids } from '../core/ast.js';
import type { Context } from '../core/context.js';
import { t } from '../core/i18n.js';
import { shapeOf } from '../core/symbols.js';
import type { Check, Fix, TextEdit } from '../core/types.js';
import { classesOf, classByName, specialMembers, type ClassInfo, type FieldInfo, type MemberFunction } from './classes.js';
import { isSingleParamOf } from './funcs.js';
import { isCallTo } from './util.js';

const dataFields = (c: ClassInfo): FieldInfo[] => c.fields.filter((f) => !f.isStatic);

function memberIndent(ctx: Context, c: ClassInfo): string {
  const first = kids(c.body).find((k) => k.type !== '{' && k.type !== '}' && k.type !== 'comment');
  if (first && !ctx.startsLine(first.startIndex)) return ctx.indentAt(c.node.startIndex) + ctx.indentUnit;
  return first ? ctx.indentAt(first.startIndex) : ctx.indentAt(c.node.startIndex) + ctx.indentUnit;
}

// ---------------------------------------------------------------------------------------------
// C.2 / C.8 / C.9 / C.133 / C.134  Struct vs class, access of data members
// ---------------------------------------------------------------------------------------------
function structToClassFix(ctx: Context, c: ClassInfo): Fix {
  const edits: TextEdit[] = [];
  const keyword = kids(c.node).find((k) => k.type === 'struct');
  if (keyword) edits.push(ctx.replace(keyword, 'class'));
  const firstMember = kids(c.body).find((k) => k.type !== '{' && k.type !== '}' && k.type !== 'comment');
  if (firstMember && firstMember.type !== 'access_specifier') {
    edits.push(ctx.insertAt(c.body.startIndex + 1, `${ctx.eol}${ctx.indentAt(c.node.startIndex)}public:`));
  }
  for (const b of c.bases) if (!b.access) edits.push(ctx.insertAt(b.node.startIndex, 'public '));
  return ctx.fix(t('Declare it as a class'), edits);
}

const accessCheck: Check = {
  name: 'C.8 struct/class and data access',
  covers: ['C.2', 'C.8', 'C.9', 'C.133', 'C.134'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const nonPublicMembers = [...c.fields, ...c.functions.map((m) => ({ access: m.access, node: m.info.node }))].filter((m) => m.access !== 'public');

      // C.8: use class if any member is non-public
      if (c.keyword === 'struct' && nonPublicMembers.length > 0) {
        const keyword = kids(c.node).find((k) => k.type === 'struct');
        ctx.report({
          ruleId: 'C.8',
          alsoCovers: ['C.2'],
          node: keyword ?? c.node,
          message: t('Use class rather than struct when a member is not public.'),
          fixes: [structToClassFix(ctx, c)],
        });
      }

      const data = dataFields(c);
      // C.2: a class with public data members has no invariant; make it a struct
      if (c.keyword === 'class') {
        const publicData = data.filter((f) => f.access === 'public' && !f.isConst);
        if (publicData.length > 0 && publicData.length === data.length && c.functions.every((m) => m.access === 'public')) {
          ctx.report({
            ruleId: 'C.2',
            node: kids(c.node).find((k) => k.type === 'class') ?? c.node,
            message: t('A class whose data members are all public has no invariant; declare it as a struct.'),
            fixes: [ctx.fix(t('Declare it as a struct'), classToStructEdits(ctx, c))],
          });
        } else {
          for (const f of publicData) {
            ctx.report({ ruleId: 'C.2', node: f.node, message: t('A class with public data members has no invariant; make the data private or use a struct.') });
          }
        }
      }

      // C.133 (+C.9): protected data
      for (const f of data.filter((d) => d.access === 'protected' && !d.isConst)) {
        ctx.report({
          ruleId: 'C.133',
          alsoCovers: ['C.9'],
          node: f.node,
          message: t('Avoid protected data members.'),
        });
      }

      // C.134 (+C.9): different access levels for non-const data
      const levels = new Set(data.filter((d) => !d.isConst).map((d) => d.access));
      if (levels.size > 1) {
        const second = data.filter((d) => !d.isConst).find((d) => d.access !== data.find((x) => !x.isConst)!.access)!;
        ctx.report({
          ruleId: 'C.134',
          alsoCovers: ['C.9'],
          node: second.node,
          message: t('Ensure all non-const data members have the same access level.'),
        });
      }
    }
  },
};

function classToStructEdits(ctx: Context, c: ClassInfo): TextEdit[] {
  const edits: TextEdit[] = [];
  const keyword = kids(c.node).find((k) => k.type === 'class');
  if (keyword) edits.push(ctx.replace(keyword, 'struct'));
  // `class D : B` inherits privately, `struct D : B` publicly: keep the meaning
  for (const b of c.bases) if (!b.access) edits.push(ctx.insertAt(b.node.startIndex, 'private '));
  return edits;
}

// ---------------------------------------------------------------------------------------------
// C.12  const / reference data members in copyable or movable types
// ---------------------------------------------------------------------------------------------
const constMemberCheck: Check = {
  name: 'C.12 const members',
  covers: ['C.12'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const sm = specialMembers(ctx, c);
      const copyOrMove = [...sm.copyCtor, ...sm.copyAssign, ...sm.moveCtor, ...sm.moveAssign];
      const allSuppressed = copyOrMove.length > 0 && copyOrMove.every((m) => m.info.isDeleted);
      if (allSuppressed) continue;
      for (const f of dataFields(c)) {
        if (f.isConst || f.isReference) {
          if (f.isPointer && !f.isReference && !f.isConst) continue;
          ctx.report({
            ruleId: 'C.12',
            node: f.node,
            message: t("Don't make data members const or references in a copyable or movable type."),
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.21  Define or delete all of copy / move / destructor
// ---------------------------------------------------------------------------------------------
const ruleOfFiveCheck: Check = {
  name: 'C.21 rule of five',
  covers: ['C.21'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      const sm = specialMembers(ctx, c);
      const present = {
        copyCtor: sm.copyCtor.length > 0,
        copyAssign: sm.copyAssign.length > 0,
        moveCtor: sm.moveCtor.length > 0,
        moveAssign: sm.moveAssign.length > 0,
        dtor: sm.dtor.length > 0,
      };
      const count = Object.values(present).filter(Boolean).length;
      if (count === 0 || count === 5) continue;
      const n = c.name;
      const missing: string[] = [];
      if (!present.copyCtor) missing.push(`${n}(const ${n}&) = default;`);
      if (!present.copyAssign) missing.push(`${n}& operator=(const ${n}&) = default;`);
      if (!present.moveCtor) missing.push(`${n}(${n}&&) noexcept = default;`);
      if (!present.moveAssign) missing.push(`${n}& operator=(${n}&&) noexcept = default;`);
      if (!present.dtor) missing.push(`~${n}() = default;`);
      const all = [...sm.copyCtor, ...sm.copyAssign, ...sm.moveCtor, ...sm.moveAssign, ...sm.dtor].sort((a, b) => a.info.node.startIndex - b.info.node.startIndex);
      const last = all[all.length - 1];
      const indent = ctx.indentAt(last.info.node.startIndex);
      const text = missing.map((m) => `${ctx.eol}${indent}${m}`).join('');
      const fixes = c.name ? [ctx.fix(t('Declare the missing special members as = default'), [ctx.insertAt(last.info.node.endIndex, text)], 'unsafe')] : [];
      ctx.report({
        ruleId: 'C.21',
        node: c.nameNode ?? c.node,
        message: t('Define or =delete all of the copy/move operations and the destructor, or none of them.'),
        fixes,
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.30 / C.31 / C.32 / C.33  Resources acquired by a class are released by its destructor
// ---------------------------------------------------------------------------------------------
const resourceCheck: Check = {
  name: 'C.31 resource release',
  covers: ['C.31'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const sm = specialMembers(ctx, c);
      if (sm.dtor.length > 0) continue;
      const pointerMembers = new Set(dataFields(c).filter((f) => f.isPointer && !f.isConst).flatMap((f) => f.names.map((n) => n.text)));
      if (pointerMembers.size === 0) continue;
      let allocated: string | null = null;
      for (const m of c.functions) {
        if (!m.info.isConstructor) continue;
        for (const n of m.info.node.descendantsOfType('new_expression')) {
          if (!n || field(n, 'placement')) continue;
          const p = n.parent;
          let target: string | undefined;
          if (p?.type === 'argument_list' && p.parent?.type === 'field_initializer') target = kids(p.parent).find((k) => k.type === 'field_identifier')?.text;
          else if (p?.type === 'assignment_expression') target = field(p, 'left')?.text.replace(/^this->/, '');
          if (target && pointerMembers.has(target)) allocated = target;
        }
      }
      if (allocated) {
        ctx.report({
          ruleId: 'C.31',
          alsoCovers: ['C.30', 'C.32', 'C.33'],
          node: c.nameNode ?? c.node,
          message: t('The constructor allocates "{0}" but the class has no destructor that releases it; use a smart pointer or define one.', allocated),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.35 / C.127  Destructors of classes with virtual functions
// ---------------------------------------------------------------------------------------------
const virtualDestructorCheck: Check = {
  name: 'C.127 virtual destructor',
  covers: ['C.127'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union' || c.bases.length > 0) continue;
      const introduces = c.functions.some((m) => m.isVirtual && !m.isOverride && !m.info.isDestructor);
      if (!introduces) continue;
      const dtor = c.functions.find((m) => m.info.isDestructor);
      if (dtor) {
        const ok = (dtor.access === 'public' && dtor.isVirtual) || (dtor.access === 'protected' && !dtor.isVirtual);
        if (ok) continue;
        const fixes: Fix[] = [];
        if (dtor.access === 'public' && !dtor.isVirtual) {
          fixes.push(ctx.fix(t('Make the destructor virtual'), [ctx.insertAt(dtor.info.node.startIndex, 'virtual ')]));
        }
        ctx.report({
          ruleId: 'C.127',
          alsoCovers: ['C.35'],
          node: dtor.info.nameNode,
          message: t('A class with virtual functions needs a destructor that is public and virtual, or protected and non-virtual.'),
          fixes,
        });
        continue;
      }
      // no destructor declared: add `virtual ~X() = default;` in a public section
      const publicLabel = c.accessLabels.find((l) => l.node && l.access === 'public');
      const indent = memberIndent(ctx, c);
      const dtorLine = `virtual ~${c.name}() = default;`;
      let edit: TextEdit;
      if (publicLabel?.node) edit = ctx.insertAt(publicLabel.node.endIndex + 1, `${ctx.eol}${indent}${dtorLine}`);
      else if (c.keyword === 'struct') edit = ctx.insertAt(c.body.startIndex + 1, `${ctx.eol}${indent}${dtorLine}`);
      else edit = ctx.insertAt(c.body.endIndex - 1, `${ctx.indentAt(c.node.startIndex)}public:${ctx.eol}${indent}${dtorLine}${ctx.eol}`);
      ctx.report({
        ruleId: 'C.127',
        alsoCovers: ['C.35'],
        node: c.nameNode ?? c.node,
        message: t('A class with virtual functions needs a destructor that is public and virtual, or protected and non-virtual.'),
        fixes: c.name ? [ctx.fix(t('Add a public virtual destructor'), [edit], 'unsafe')] : [],
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.40 / E.5 / C.43  Constructors
// ---------------------------------------------------------------------------------------------
const constructorCheck: Check = {
  name: 'C.40 constructors',
  covers: ['C.40', 'E.5', 'C.43'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union') continue;
      const sm = specialMembers(ctx, c);
      const ctors = c.functions.filter((m) => m.info.isConstructor);
      const hasAnyCtor = ctors.length > 0;
      const privateState = dataFields(c).some((f) => f.access !== 'public' && !f.isConst);
      const userCopy = [...sm.copyCtor, ...sm.copyAssign].filter((m) => !m.info.isDefaulted && !m.info.isDeleted);

      if (!hasAnyCtor && privateState && c.bases.length === 0) {
        ctx.report({
          ruleId: 'E.5',
          alsoCovers: ['C.40'],
          node: c.nameNode ?? c.node,
          message: t('A class with private state needs a constructor that establishes its invariant.'),
        });
      } else if (!hasAnyCtor && userCopy.length > 0) {
        ctx.report({
          ruleId: 'C.40',
          node: c.nameNode ?? c.node,
          message: t('A class with user-defined copy operations has an invariant: define a constructor.'),
        });
      }

      // C.43: copyable class without a default constructor
      const copyDeleted = [...sm.copyCtor, ...sm.copyAssign].some((m) => m.info.isDeleted);
      const refOrConst = dataFields(c).some((f) => f.isConst || f.isReference);
      const userCtors = [...sm.otherCtors, ...sm.defaultCtor];
      // with base classes, copyability depends on them: stay silent unless the class itself is clearly copyable
      if (userCtors.length > 0 && sm.defaultCtor.length === 0 && !copyDeleted && !refOrConst && c.bases.length === 0) {
        ctx.report({
          ruleId: 'C.43',
          node: c.nameNode ?? c.node,
          message: t('A copyable class should have a default constructor.'),
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.45  Default constructors that only initialize with constants
// ---------------------------------------------------------------------------------------------
function isConstantInit(n: Node): boolean {
  return ['number_literal', 'string_literal', 'char_literal', 'true', 'false', 'null', 'concatenated_string', 'raw_string_literal'].includes(n.type);
}

function fieldInitializerValue(ctx: Context, init: Node): { name: Node; value: Node | null } | null {
  const name = kids(init).find((k) => k.type === 'field_identifier');
  if (!name) return null;
  const args = kids(init).find((k) => k.type === 'argument_list' || k.type === 'initializer_list');
  if (!args) return null;
  const items = namedKids(args).filter((k) => k.type !== 'comment');
  void ctx;
  return { name, value: items.length === 1 ? items[0] : null };
}

const defaultInitCheck: Check = {
  name: 'C.45 default member initializers',
  covers: ['C.45'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      for (const m of c.functions) {
        const f = m.info;
        if (!f.isConstructor || f.node.type !== 'function_definition' || f.params.length > 0) continue;
        const list = kids(f.node).find((k) => k.type === 'field_initializer_list');
        if (!list) continue;
        const items = kids(list).filter((k) => k.type === 'field_initializer');
        const removable: Array<{ item: Node; field: FieldInfo; name: string; value: Node }> = [];
        for (const item of items) {
          const fv = fieldInitializerValue(ctx, item);
          if (!fv || !fv.value || !isConstantInit(fv.value)) continue;
          const fieldInfo = c.fields.find((fl) => !fl.isStatic && fl.names.length === 1 && fl.names[0].text === fv.name.text && !fl.hasInitializer && !fl.isArray && !fl.isReference);
          if (fieldInfo) removable.push({ item, field: fieldInfo, name: fv.name.text, value: fv.value });
        }
        if (removable.length === 0) continue;
        const edits: TextEdit[] = [];
        for (const r of removable) {
          const decl = r.field.names[0];
          edits.push(ctx.insertAt(decl.endIndex, `{${ctx.src(r.value)}}`));
        }
        if (removable.length === items.length) {
          edits.push(ctx.replaceRange(f.declarator.endIndex, list.endIndex, ''));
        } else {
          const keep = items.filter((i) => !removable.some((r) => r.item.id === i.id));
          edits.push(ctx.replace(list, `: ${keep.map((k) => ctx.src(k)).join(', ')}`));
        }
        ctx.report({
          ruleId: 'C.45',
          node: removable[0].item,
          message: t("Don't define a default constructor that only initializes data members with constants; use default member initializers."),
          fixes: [ctx.fix(t('Move the constants to default member initializers'), edits)],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.46  Single-argument constructors are explicit
// ---------------------------------------------------------------------------------------------
const explicitCheck: Check = {
  name: 'C.46 explicit constructors',
  covers: ['C.46'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      for (const m of c.functions) {
        const f = m.info;
        if (!f.isConstructor || f.isDeleted) continue;
        if (isSingleParamOf(ctx, f, 'any-ref')) continue; // copy / move
        const required = f.params.filter((p) => p.type === 'parameter_declaration').length;
        const callableWithOne = f.params.length >= 1 && required <= 1;
        if (!callableWithOne) continue;
        const first = f.params[0];
        const typeText = ctx.src(first);
        if (/initializer_list/.test(typeText)) continue;
        if (first.type === 'variadic_parameter_declaration') continue;
        const isExplicit = kids(f.node).some((k) => k.type === 'explicit_function_specifier') || /^\s*explicit\b/.test(ctx.src(f.node));
        if (isExplicit) continue;
        ctx.report({
          ruleId: 'C.46',
          node: f.nameNode,
          message: t('Declare single-argument constructors explicit.'),
          fixes: [ctx.fix(t('Add explicit'), [ctx.insertAt(f.node.startIndex, 'explicit ')], 'unsafe')],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.47 / C.13  Initialization order
// ---------------------------------------------------------------------------------------------
const initOrderCheck: Check = {
  name: 'C.47 initializer order',
  covers: ['C.47', 'C.13'],
  run(ctx) {
    for (const fn of ctx.nodesOf('function_definition')) {
      const list = kids(fn).find((k) => k.type === 'field_initializer_list');
      if (!list) continue;
      const cls = ancestor(fn, 'class_specifier', 'struct_specifier');
      let info: ClassInfo | undefined;
      if (cls) info = classesOf(ctx).find((c) => c.node.id === cls.id);
      else {
        const nameNode = shapeOf(field(fn, 'declarator')).nameNode;
        const q = nameNode ? ctx.src(nameNode).replace(/<.*?>/g, '').split('::') : [];
        if (q.length > 1) info = classByName(ctx, q[q.length - 2]);
      }
      if (!info) continue;
      const order: string[] = info.fields.filter((f) => !f.isStatic).flatMap((f) => f.names.map((n) => n.text));
      const items = kids(list).filter((k) => k.type === 'field_initializer');
      const indexed = items.map((item) => {
        const name = kids(item).find((k) => k.type === 'field_identifier')?.text ?? '';
        return { item, name, idx: order.indexOf(name) };
      });
      const known = indexed.filter((i) => i.idx >= 0);

      // C.13: an initializer that uses a member declared at or after the one being initialized
      for (const cur of known) {
        const args = kids(cur.item).find((k) => k.type === 'argument_list' || k.type === 'initializer_list');
        if (!args) continue;
        for (const id of args.descendantsOfType('identifier')) {
          if (!id) continue;
          const v = ctx.symbols.resolve(id.text, id);
          const idx = order.indexOf(id.text);
          if (v?.kind === 'member' && idx >= cur.idx && id.text !== cur.name) {
            ctx.report({
              ruleId: 'C.13',
              node: id,
              message: t('"{0}" is used before it is constructed: it is declared after "{1}".', id.text, cur.name),
            });
          }
        }
      }

      // C.47: initializers in declaration order
      const sorted = [...known].sort((a, b) => a.idx - b.idx);
      const outOfOrder = known.some((k, i) => k.item.id !== sorted[i].item.id);
      if (outOfOrder) {
        const slots = known.map((k) => k.item);
        const edits: TextEdit[] = [];
        slots.forEach((slot, i) => {
          if (slot.id !== sorted[i].item.id) edits.push(ctx.replace(slot, ctx.src(sorted[i].item)));
        });
        ctx.report({
          ruleId: 'C.47',
          node: list,
          message: t('Member initializers must be listed in the order the members are declared.'),
          fixes: [ctx.fix(t('Reorder the initializers'), edits)],
        });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.49  Prefer initialization to assignment in constructors
// ---------------------------------------------------------------------------------------------
const assignInCtorCheck: Check = {
  name: 'C.49 initialization vs assignment',
  covers: ['C.49'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      const names = new Set(dataFields(c).flatMap((f) => f.names.map((n) => n.text)));
      for (const m of c.functions) {
        const f = m.info;
        if (!f.isConstructor || !f.body || f.isDefaulted) continue;
        for (const stmt of namedKids(f.body)) {
          if (stmt.type !== 'expression_statement') break;
          const e = namedKids(stmt)[0];
          if (e?.type !== 'assignment_expression' || e.child(1)?.text !== '=') break;
          const left = field(e, 'left');
          const target = left?.type === 'identifier' ? left.text : left?.type === 'field_expression' && field(left, 'argument')?.type === 'this' ? field(left, 'field')?.text : undefined;
          if (target && names.has(target)) {
            ctx.report({
              ruleId: 'C.49',
              node: e,
              message: t('Prefer initialization to assignment in constructors: initialize "{0}" in the member initializer list.', target),
            });
          } else break;
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.62  Self-assignment test
// ---------------------------------------------------------------------------------------------
const selfAssignCheck: Check = {
  name: 'C.62 self-assignment',
  covers: ['C.62'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      for (const m of c.functions) {
        if (m.info.name !== 'operator=' || !m.info.body) continue;
        for (const s of m.info.body.descendantsOfType('if_statement')) {
          if (!s) continue;
          const cond = field(s, 'condition');
          const text = cond ? ctx.src(cond).replace(/\s+/g, '') : '';
          if (/^\(this==&\w+\)$/.test(text) || /^\(&\w+==this\)$/.test(text)) {
            ctx.report({
              ruleId: 'C.62',
              node: s,
              start: s.startIndex,
              end: cond!.endIndex,
              message: t('Make assignment naturally safe for self-assignment instead of testing "this == &other".'),
            });
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.67  Polymorphic classes suppress public copy/move
// ---------------------------------------------------------------------------------------------
const polymorphicCopyCheck: Check = {
  name: 'C.67 polymorphic copy',
  covers: ['C.67'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      if (c.keyword === 'union' || c.bases.length > 0) continue;
      if (!c.functions.some((m) => m.isVirtual && !m.isOverride && !m.info.isDestructor)) continue;
      const sm = specialMembers(ctx, c);
      const suppressed = (list: MemberFunction[]): boolean => list.length > 0 && list.every((m) => m.info.isDeleted || m.access !== 'public');
      const copyOk = suppressed(sm.copyCtor) && suppressed(sm.copyAssign);
      if (copyOk) continue;
      const n = c.name;
      const indent = memberIndent(ctx, c);
      const lines = [!suppressed(sm.copyCtor) ? `${n}(const ${n}&) = delete;` : '', !suppressed(sm.copyAssign) ? `${n}& operator=(const ${n}&) = delete;` : ''].filter(Boolean);
      const publicLabel = c.accessLabels.find((l) => l.node && l.access === 'public');
      const at = publicLabel?.node ? publicLabel.node.endIndex + 1 : c.keyword === 'struct' ? c.body.startIndex + 1 : -1;
      const fixes: Fix[] = [];
      if (n && at >= 0) fixes.push(ctx.fix(t('Delete the copy operations'), [ctx.insertAt(at, lines.map((l) => `${ctx.eol}${indent}${l}`).join(''))], 'unsafe'));
      ctx.report({
        ruleId: 'C.67',
        node: c.nameNode ?? c.node,
        message: t('A polymorphic class should suppress public copy/move operations (slicing).'),
        fixes,
      });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.80  Use = default for empty special members
// ---------------------------------------------------------------------------------------------
const defaultedCheck: Check = {
  name: 'C.80 = default',
  covers: ['C.80'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      for (const m of c.functions) {
        const f = m.info;
        if (f.node.type !== 'function_definition' || !f.body || f.isDefaulted || f.isDeleted) continue;
        const emptyBody = namedKids(f.body).filter((n) => n.type !== 'comment').length === 0;
        const noInit = !kids(f.node).some((k) => k.type === 'field_initializer_list');
        const isDefaultCtor = f.isConstructor && f.params.length === 0;
        if (emptyBody && noInit && (isDefaultCtor || f.isDestructor)) {
          ctx.report({
            ruleId: 'C.80',
            node: f.nameNode,
            message: t('An empty {0} has the semantics of the compiler-generated one; use = default.', f.isDestructor ? t('destructor') : t('default constructor')),
            fixes: [ctx.fix(t('Use = default'), [ctx.replaceRange(f.declarator.endIndex, f.body.endIndex, ' = default;')], 'unsafe')],
          });
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.82  Virtual calls in constructors and destructors
// ---------------------------------------------------------------------------------------------
function virtualNames(ctx: Context, c: ClassInfo, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(c.name)) return out;
  seen.add(c.name);
  for (const m of c.functions) if ((m.isVirtual || m.isOverride) && !m.info.isConstructor && !m.info.isDestructor) out.add(m.info.name);
  for (const b of c.bases) {
    const base = classByName(ctx, b.name);
    if (base) for (const n of virtualNames(ctx, base, seen)) out.add(n);
  }
  return out;
}

const virtualCallCheck: Check = {
  name: 'C.82 virtual calls in ctor/dtor',
  covers: ['C.82'],
  run(ctx) {
    for (const c of classesOf(ctx)) {
      const virtuals = virtualNames(ctx, c);
      if (virtuals.size === 0) continue;
      for (const m of c.functions) {
        const f = m.info;
        if (!(f.isConstructor || f.isDestructor) || !f.body) continue;
        for (const call of f.body.descendantsOfType('call_expression')) {
          if (!call || ancestor(call, 'lambda_expression')) continue;
          const fn = field(call, 'function');
          let name: string | undefined;
          if (fn?.type === 'identifier') name = fn.text;
          else if (fn?.type === 'field_expression' && field(fn, 'argument')?.type === 'this') name = field(fn, 'field')?.text;
          if (name && virtuals.has(name)) {
            ctx.report({
              ruleId: 'C.82',
              node: call,
              message: t("Don't call virtual functions in constructors and destructors (\"{0}\").", name),
            });
          }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// C.90 / SL.con.4  memset / memcpy on non-trivially-copyable objects
// ---------------------------------------------------------------------------------------------
const NON_TRIVIAL_STD = /^(?:const\s+)?std::(?:string|wstring|u8string|vector|map|multimap|set|multiset|unordered_\w+|list|deque|forward_list|unique_ptr|shared_ptr|weak_ptr|function|optional|variant|any|mutex|thread)\b/;

const memcpyCheck: Check = {
  name: 'C.90 memset/memcpy',
  covers: ['C.90', 'SL.con.4'],
  run(ctx) {
    for (const call of ctx.nodesOf('call_expression')) {
      if (!isCallTo(call, 'memset', 'memcpy', 'memmove')) continue;
      const args = field(call, 'arguments');
      const first = args ? namedKids(args)[0] : undefined;
      if (!first) continue;
      let nonTrivial = false;
      let subject = '';
      const target = first.type === 'pointer_expression' && first.text.startsWith('&') ? field(first, 'argument') : first;
      if (first.type === 'this' || (first.type === 'pointer_expression' && field(first, 'argument')?.type === 'this')) {
        const cls = ancestor(call, 'class_specifier', 'struct_specifier');
        const info = cls ? classesOf(ctx).find((c) => c.node.id === cls.id) : undefined;
        nonTrivial = !!info && (info.functions.some((m) => m.isVirtual) || info.fields.some((f) => NON_TRIVIAL_STD.test(f.typeText)));
        subject = 'this';
      } else if (target?.type === 'identifier' || (first.type === 'identifier')) {
        const id = target?.type === 'identifier' ? target : first;
        const v = ctx.symbols.resolve(id.text, id);
        if (v && !v.pointer && !v.array) {
          nonTrivial = NON_TRIVIAL_STD.test(v.typeText);
          const cls = classByName(ctx, v.typeText.replace(/^const\s+/, '').trim());
          if (cls) nonTrivial = cls.functions.some((m) => m.isVirtual || m.info.isDestructor && !m.info.isDefaulted) || cls.fields.some((f) => NON_TRIVIAL_STD.test(f.typeText));
          subject = v.name;
        }
      }
      if (nonTrivial) {
        ctx.report({
          ruleId: 'C.90',
          alsoCovers: ['SL.con.4'],
          node: call,
          message: t('Rely on constructors and assignment operators, not memset/memcpy, for the non-trivially-copyable "{0}".', subject),
        });
      }
    }
  },
};

export const cChecks: Check[] = [
  accessCheck,
  constMemberCheck,
  ruleOfFiveCheck,
  resourceCheck,
  virtualDestructorCheck,
  constructorCheck,
  defaultInitCheck,
  explicitCheck,
  initOrderCheck,
  assignInCtorCheck,
  selfAssignCheck,
  polymorphicCopyCheck,
  defaultedCheck,
  virtualCallCheck,
  memcpyCheck,
];
