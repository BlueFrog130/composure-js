// Placement rules for the static checks (ADR 0023): which built-in tags may go directly inside
// which. The render walk enforces the same rules when a View renders; test/placement.test.tsx renders
// every pair against this table so the two cannot drift. `checkPlacement` walks an ESTree program
// (oxc's in @composurejs/vite, ESLint's or oxlint's in @composurejs/eslint-plugin), and the modules it
// imports function components from through the caller's `load` (ADR 0032).

export const SELECTS: readonly string[] = ["StringSelect", "UserSelect", "RoleSelect", "MentionableSelect", "ChannelSelect"];
export const INPUTS: readonly string[] = [...SELECTS, "TextInput", "RadioGroup", "CheckboxGroup", "Checkbox", "FileUpload"];

/** Every built-in tag (the PascalCase exports of `composurejs/components`). */
export const TAGS: readonly string[] = [
  "Message",
  "Container",
  "Section",
  "Text",
  "Separator",
  "Row",
  "Thumbnail",
  "Gallery",
  "Item",
  "File",
  "Button",
  "Option",
  "Modal",
  "Label",
  ...INPUTS,
];

/** A text child (a string that is not only whitespace), or `<br />`. */
export const TEXT = "#text";

export interface Placement {
  /** What may go directly inside: tags, and {@link TEXT}. */
  children: readonly string[];
  /** The reason a child cannot go inside, where it says more than "cannot go inside". */
  hints?: Readonly<Record<string, string>>;
}

const BLOCKS = [TEXT, "Text", "Section", "Row", "Gallery", "Separator", "File"];
const ACCESSORY_HINT = "goes in <Section accessory={..}>, not inside <Section>";

/** Placement by parent tag. A tag missing here takes no children the walk looks at. */
export const PLACEMENT: Readonly<Record<string, Placement>> = {
  Message: { children: [...BLOCKS, "Container"] },
  Container: { children: BLOCKS },
  Section: { children: [TEXT, "Text"], hints: { Button: ACCESSORY_HINT, Thumbnail: ACCESSORY_HINT } },
  Text: { children: [TEXT] },
  Button: { children: [TEXT] },
  Option: { children: [TEXT] },
  Row: { children: ["Button", ...SELECTS] },
  StringSelect: { children: ["Option"] },
  RadioGroup: { children: ["Option"] },
  CheckboxGroup: { children: ["Option"] },
  Gallery: { children: ["Item"] },
  Modal: { children: [TEXT, "Text", "Label"], hints: Object.fromEntries(INPUTS.map((t) => [t, "goes inside a <Label> in a <Modal>"])) },
  Label: { children: INPUTS, hints: { [TEXT]: "cannot go inside <Label>; use its text and description props" } },
};

/** What `<Section accessory={..}>` takes. */
export const ACCESSORY: readonly string[] = ["Button", "Thumbnail"];

const ROOTS = new Set(["Message", "Modal"]);

/**
 * Why `child` cannot go directly inside `parent`, or undefined when it can (or no rule applies).
 * `child` is a tag, `"br"`, or {@link TEXT}.
 */
export function placementError(parent: string, child: string): string | undefined {
  const rules = PLACEMENT[parent];
  if (!rules || rules.children.includes(child === "br" ? TEXT : child)) return undefined;
  const what = child === TEXT ? "text" : `<${child}>`;
  if (ROOTS.has(child)) return `${what} can only be the root of a View`;
  const hint = rules.hints?.[child];
  return `${what} ${hint ?? `cannot go ${parent === "Message" ? "at the top of a message" : `inside <${parent}>`}`}`;
}

/** Why `child` cannot be a `<Section>` accessory, or undefined when it can. */
export function accessoryError(child: string): string | undefined {
  if (ACCESSORY.includes(child)) return undefined;
  if (child === TEXT) return "<Section> needs exactly one accessory: a <Button> or <Thumbnail>";
  return `<${child}> cannot be a <Section> accessory; use a <Button> or <Thumbnail>`;
}

// ---- The static check ----------------------------------------------------------------------

/** An ESTree node, as oxc, espree and typescript-eslint produce them. */
export interface AstNode {
  type: string;
  [key: string]: any;
}

export interface PlacementProblem {
  /** The misplaced child: a JSX element, text, or expression. */
  node: AstNode;
  message: string;
}

export interface PlacementOptions {
  /** The module's path: relative imports resolve against it. */
  file?: string | undefined;
  /**
   * The parsed program at `path` (`/`-separated, with an extension), or undefined when there is no
   * such file or it does not parse. Without it, only function components in the module are followed.
   */
  load?: ((path: string) => AstNode | undefined) | undefined;
}

const SOURCES = new Set(["composurejs", "composurejs/components"]);
// `parent` is the cycle ESLint adds; the rest are positions and types.
const SKIP = new Set(["parent", "loc", "range", "start", "end", "tokens", "comments", "typeAnnotation", "returnType", "typeParameters", "typeArguments"]);
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/** A kind standing for the `children` a function component was given, and a node that evaluates to it. */
const CHILDREN = "#children";
const CHILDREN_NODE: AstNode = { type: CHILDREN };
/** The parent a `<Section accessory={..}>` value is checked against. */
const ACCESSORY_SLOT = "#accessory";

/** A child that can be told statically: a tag, `"br"`, {@link TEXT} or {@link CHILDREN}, and how it got there. */
interface Found {
  node: AstNode;
  kind: string;
  notes: string[];
}

/** What a function component renders, as far as can be told statically. */
interface Shape {
  /** What it may render at its top: tags, text, and {@link CHILDREN} where it returns its children as they are. */
  roots: string[];
  /** The parents its children land directly inside: tags, or {@link ACCESSORY_SLOT}. */
  slots: string[];
}

interface Module {
  file: string | undefined;
  program: AstNode;
  bindings: Map<string, Binding>;
}

type Binding =
  | { kind: "tag"; tag: string }
  /** A namespace import of composurejs. */
  | { kind: "tags" }
  | { kind: "fn"; fn: AstNode; module: Module }
  /** `name` is `"*"` for a namespace import. */
  | { kind: "import"; source: string; name: string; module: Module };

type Resolved = { kind: "tag"; tag: string } | { kind: "fn"; fn: AstNode; module: Module };

/** Inside a function component: the identifiers holding its children, and its props (or a rest of them). */
interface Props {
  children: Set<string>;
  props: Set<string>;
}

/**
 * Finds built-in tags that end up directly inside a parent that cannot hold them, in one module.
 * Tags count when imported from `composurejs` or `composurejs/components` (renamed, or as a
 * namespace). Children are followed through fragments, `&&` / `||` / `??`, `? :`, arrays and
 * `.map(..)` callbacks, and through function components (ADR 0032): the parents a function
 * component puts its children in, and what it renders at its top. Function components are followed
 * in the module and, with `load`, through relative imports and re-exports. Anything else (a
 * variable, a package's component) is left to the render walk.
 */
export function checkPlacement(program: AstNode, options: PlacementOptions = {}): PlacementProblem[] {
  const { load } = options;
  const modules = new Map<string, Module | undefined>();
  const shapes = new Map<AstNode, Shape>();

  const moduleAt = (from: Module, source: string): Module | undefined => {
    if (!load || from.file === undefined) return undefined;
    for (const path of candidates(from.file, source)) {
      if (!modules.has(path)) {
        const loaded = load(path);
        modules.set(path, loaded && moduleOf(loaded, path));
      }
      const module = modules.get(path);
      if (module) return module;
    }
    return undefined;
  };

  const resolveImport = (from: Module, source: string, name: string, seen: Set<string>): Resolved | undefined => {
    if (SOURCES.has(source)) return TAGS.includes(name) ? { kind: "tag", tag: name } : undefined;
    const module = moduleAt(from, source);
    return module && resolveExport(module, name, seen);
  };

  const resolveBinding = (binding: Binding | undefined, seen: Set<string>): Resolved | undefined => {
    if (!binding || binding.kind === "tags") return undefined;
    if (binding.kind !== "import") return binding;
    return binding.name === "*" ? undefined : resolveImport(binding.module, binding.source, binding.name, seen);
  };

  const resolveExport = (module: Module, name: string, seen: Set<string>): Resolved | undefined => {
    const key = `${module.file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const all: string[] = [];
    for (const s of module.program.body as AstNode[]) {
      if (s.type === "ExportNamedDeclaration" && s.exportKind !== "type") {
        if (s.declaration && declared(s.declaration).includes(name)) return resolveBinding(module.bindings.get(name), seen);
        for (const spec of s.specifiers ?? []) {
          if (nameOf(spec.exported) !== name || spec.exportKind === "type") continue;
          const local = nameOf(spec.local);
          return s.source ? resolveImport(module, s.source.value, local, seen) : resolveBinding(module.bindings.get(local), seen);
        }
      } else if (s.type === "ExportDefaultDeclaration" && name === "default") {
        const d = unwrap(s.declaration);
        if (FUNCTIONS.has(d.type)) return { kind: "fn", fn: d, module };
        return d.type === "Identifier" ? resolveBinding(module.bindings.get(d.name), seen) : undefined;
      } else if (s.type === "ExportAllDeclaration" && !s.exported && s.exportKind !== "type") {
        all.push(s.source.value);
      }
    }
    // `export *` never re-exports a default.
    if (name === "default") return undefined;
    for (const source of all) {
      const found = resolveImport(module, source, name, seen);
      if (found) return found;
    }
    return undefined;
  };

  /** The tag or function component an element names, with the name as written. */
  const targetOf = (element: AstNode, module: Module): { tag: string } | { shape: Shape; name: string } | undefined => {
    const name = element.openingElement.name;
    let resolved: Resolved | undefined;
    let written = "";
    if (name.type === "JSXIdentifier") {
      if (name.name === "br") return { tag: "br" };
      written = name.name;
      resolved = resolveBinding(module.bindings.get(written), new Set());
    } else if (name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier") {
      const binding = module.bindings.get(name.object.name);
      const property: string = name.property.name;
      written = `${name.object.name}.${property}`;
      if (binding?.kind === "tags") resolved = TAGS.includes(property) ? { kind: "tag", tag: property } : undefined;
      else if (binding?.kind === "import" && binding.name === "*") {
        const target = SOURCES.has(binding.source) ? undefined : moduleAt(binding.module, binding.source);
        resolved = target && resolveExport(target, property, new Set());
      }
    } else return undefined;
    if (!resolved) return undefined;
    return resolved.kind === "tag" ? { tag: resolved.tag } : { shape: shapeOf(resolved.fn, resolved.module), name: written };
  };

  /** The children an expression evaluates to that can be told statically. */
  const kinds = (node: AstNode | null | undefined, module: Module, props: Props | undefined, out: Found[] = []): Found[] => {
    if (!node) return out;
    switch (node.type) {
      case CHILDREN:
        out.push({ node, kind: CHILDREN, notes: [] });
        break;
      case "JSXElement": {
        const target = targetOf(node, module);
        if (!target) break;
        if ("tag" in target) {
          out.push({ node, kind: target.tag, notes: [] });
          break;
        }
        for (const root of target.shape.roots) {
          if (root !== CHILDREN) out.push({ node, kind: root, notes: [`rendered by <${target.name}>`] });
          else for (const child of childrenOf(node, props)) for (const f of kinds(child, module, props)) out.push({ ...f, notes: [...f.notes, `in <${target.name}>`] });
        }
        break;
      }
      case "JSXFragment":
        for (const c of node.children) kinds(c, module, props, out);
        break;
      case "JSXText":
        if (node.value.trim() !== "") out.push({ node, kind: TEXT, notes: [] });
        break;
      case "JSXExpressionContainer":
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
        kinds(node.expression, module, props, out);
        break;
      case "Identifier":
        if (props?.children.has(node.name)) out.push({ node, kind: CHILDREN, notes: [] });
        break;
      case "MemberExpression":
        if (!node.computed && node.object.type === "Identifier" && props?.props.has(node.object.name) && node.property.name === "children") {
          out.push({ node, kind: CHILDREN, notes: [] });
        }
        break;
      case "Literal":
        if ((typeof node.value === "string" && node.value.trim() !== "") || typeof node.value === "number") out.push({ node, kind: TEXT, notes: [] });
        break;
      case "TemplateLiteral":
        if (node.expressions.length > 0 || node.quasis.some((q: AstNode) => q.value.cooked?.trim())) out.push({ node, kind: TEXT, notes: [] });
        break;
      case "LogicalExpression":
        // `cond && <X />`: the left side is a condition; `a ?? <X />` may render either.
        if (node.operator !== "&&") kinds(node.left, module, props, out);
        kinds(node.right, module, props, out);
        break;
      case "ConditionalExpression":
        kinds(node.consequent, module, props, out);
        kinds(node.alternate, module, props, out);
        break;
      case "ArrayExpression":
        for (const e of node.elements) kinds(e, module, props, out);
        break;
      case "CallExpression": {
        const { callee } = node;
        const fn = node.arguments[0];
        const mapping = callee.type === "MemberExpression" && !callee.computed && (callee.property.name === "map" || callee.property.name === "flatMap");
        if (!mapping || !fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) break;
        for (const r of returned(fn)) kinds(r, module, props, out);
        break;
      }
    }
    return out;
  };

  /** The parents an element's children land directly inside, and the note that says how. */
  const parentsOf = (element: AstNode, module: Module): { parents: string[]; note?: string } => {
    const target = targetOf(element, module);
    if (!target) return { parents: [] };
    return "tag" in target ? { parents: [target.tag] } : { parents: target.shape.slots, note: `in <${target.name}>` };
  };

  const shapeOf = (fn: AstNode, module: Module): Shape => {
    const known = shapes.get(fn);
    if (known) return known;
    // Seen before it is worked out: a function component that renders itself adds nothing.
    const shape: Shape = { roots: [], slots: [] };
    shapes.set(fn, shape);
    const props = propsOf(fn.params[0]);
    const roots = new Set<string>();
    for (const r of returned(fn)) for (const f of kinds(r, module, props)) roots.add(f.kind);
    const slots = new Set<string>();
    walk(fn.body, (node) => {
      if (node.type !== "JSXElement") return;
      const inside = (value: AstNode | null | undefined) => kinds(value, module, props).some((f) => f.kind === CHILDREN);
      if (childrenOf(node, props).some(inside)) for (const p of parentsOf(node, module).parents) slots.add(p);
      if (inside(accessoryOf(node, module))) slots.add(ACCESSORY_SLOT);
    });
    shape.roots = [...roots];
    shape.slots = [...slots];
    return shape;
  };

  /** `<Section accessory={..}>`'s value, when the element is a built-in `<Section>`. */
  const accessoryOf = (element: AstNode, module: Module): AstNode | undefined => {
    const target = targetOf(element, module);
    if (!target || !("tag" in target) || target.tag !== "Section") return undefined;
    return element.openingElement.attributes.find((a: AstNode) => a.type === "JSXAttribute" && a.name.name === "accessory")?.value ?? undefined;
  };

  const root = moduleOf(program, options.file === undefined ? undefined : options.file.replace(/\\/g, "/"));
  const problems: PlacementProblem[] = [];
  const reported = new Map<AstNode, Set<string>>();
  const report = (parent: string, found: Found, note?: string) => {
    if (found.kind === CHILDREN) return;
    const error = parent === ACCESSORY_SLOT ? accessoryError(found.kind) : placementError(parent, found.kind);
    if (!error) return;
    const notes = note ? [...found.notes, note] : found.notes;
    const message = notes.length > 0 ? `${error} (${notes.join(", ")})` : error;
    // A child two slots or two paths put under the same parent is reported once.
    const seen = reported.get(found.node) ?? new Set();
    if (seen.has(message)) return;
    reported.set(found.node, seen.add(message));
    problems.push({ node: found.node, message });
  };
  walk(program, (node) => {
    if (node.type !== "JSXElement") return;
    const { parents, note } = parentsOf(node, root);
    for (const child of childrenOf(node, undefined)) {
      for (const found of kinds(child, root, undefined)) for (const parent of parents) report(parent, found, note);
    }
    const accessory = accessoryOf(node, root);
    if (accessory) for (const found of kinds(accessory, root, undefined)) report(ACCESSORY_SLOT, found);
  });
  return problems;
}

/** A module's top-level bindings: built-in tags, imports, and functions that may be function components. */
function moduleOf(program: AstNode, file: string | undefined): Module {
  const module: Module = { file, program, bindings: new Map() };
  const { bindings } = module;
  for (let s of program.body as AstNode[]) {
    if (s.type === "ImportDeclaration") {
      const source: string = s.source.value;
      if (s.importKind === "type") continue;
      for (const spec of s.specifiers as AstNode[]) {
        const local: string = spec.local.name;
        if (spec.type === "ImportNamespaceSpecifier") bindings.set(local, SOURCES.has(source) ? { kind: "tags" } : { kind: "import", source, name: "*", module });
        else if (spec.type === "ImportDefaultSpecifier") bindings.set(local, { kind: "import", source, name: "default", module });
        else if (spec.importKind !== "type") {
          const imported = nameOf(spec.imported);
          if (!SOURCES.has(source)) bindings.set(local, { kind: "import", source, name: imported, module });
          else if (TAGS.includes(imported)) bindings.set(local, { kind: "tag", tag: imported });
        }
      }
      continue;
    }
    if ((s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") && s.declaration) s = s.declaration;
    if (s.type === "FunctionDeclaration" && s.id) bindings.set(s.id.name, { kind: "fn", fn: s, module });
    if (s.type === "VariableDeclaration") {
      for (const d of s.declarations) {
        const init = d.init && unwrap(d.init);
        if (d.id.type === "Identifier" && init && FUNCTIONS.has(init.type)) bindings.set(d.id.name, { kind: "fn", fn: init, module });
      }
    }
  }
  return module;
}

/** The names a declaration exports (`export const A = .., B = ..`, `export function C`). */
function declared(declaration: AstNode): string[] {
  if (declaration.type === "VariableDeclaration") return declaration.declarations.filter((d: AstNode) => d.id.type === "Identifier").map((d: AstNode) => d.id.name);
  return declaration.id ? [declaration.id.name] : [];
}

/** What a function component's parameter calls its children and its props. */
function propsOf(param: AstNode | undefined): Props {
  const props: Props = { children: new Set(), props: new Set() };
  if (param?.type === "AssignmentPattern") param = param.left;
  if (param?.type === "Identifier") props.props.add(param.name);
  if (param?.type === "ObjectPattern") {
    for (const p of param.properties) {
      if (p.type === "RestElement" && p.argument.type === "Identifier") props.props.add(p.argument.name);
      if (p.type !== "Property" || p.computed || nameOf(p.key) !== "children") continue;
      const value = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
      if (value.type === "Identifier") props.children.add(value.name);
    }
  }
  return props;
}

/** An element's children: its JSX children, else a `children` prop, else children a props spread forwards. */
function childrenOf(element: AstNode, props: Props | undefined): AstNode[] {
  const written = element.children.filter((c: AstNode) => c.type !== "JSXText" || c.value.trim() !== "");
  if (written.length > 0) return written;
  const attributes: AstNode[] = element.openingElement.attributes;
  const prop = attributes.find((a) => a.type === "JSXAttribute" && a.name.name === "children");
  if (prop?.value) return [prop.value];
  const forwards = attributes.some((a) => a.type === "JSXSpreadAttribute" && a.argument.type === "Identifier" && props?.props.has(a.argument.name));
  return forwards ? [CHILDREN_NODE] : [];
}

/** What a function returns: its expression body, or every `return` outside nested functions. */
function returned(fn: AstNode): AstNode[] {
  if (fn.body.type !== "BlockStatement") return [fn.body];
  const out: AstNode[] = [];
  walk(fn.body, (node) => {
    if (FUNCTIONS.has(node.type)) return false;
    if (node.type === "ReturnStatement" && node.argument) out.push(node.argument);
    return undefined;
  });
  return out;
}

/** Calls `visit` on every node under `node`; returning false skips a node's children. */
function walk(node: AstNode, visit: (node: AstNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v.type === "string") walk(v, visit);
    } else if (value && typeof value.type === "string") walk(value, visit);
  }
}

function unwrap(node: AstNode): AstNode {
  while (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") node = node.expression;
  return node;
}

/** An identifier's name, or a string literal's value (`import { "a" as b }`). */
function nameOf(node: AstNode): string {
  return node.type === "Identifier" ? node.name : node.value;
}

/**
 * The files a relative import may name, most likely first: `./ui.js` may be `./ui.ts`, and `./ui`
 * any script file or a directory's index. Other specifiers (packages, aliases) name none.
 */
function candidates(from: string, source: string): string[] {
  if (!/^\.\.?\//.test(source) || !from.includes("/")) return [];
  const path = normalize(`${from.slice(0, from.lastIndexOf("/"))}/${source}`);
  const match = /\.([cm]?)(j|t)s(x?)$/.exec(path);
  if (!match) return [...EXTENSIONS.map((e) => path + e), ...EXTENSIONS.map((e) => `${path}/index${e}`)];
  if (match[2] === "t") return [path];
  const stem = path.slice(0, match.index);
  const [, m, , x] = match;
  return [...new Set([`${stem}.${m}ts${x}`, ...(m || x ? [] : [`${stem}.tsx`]), path])];
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "." || (part === "" && out.length > 0)) continue;
    if (part !== "..") out.push(part);
    else if (out.length > 1 || (out.length === 1 && out[0] !== "" && !out[0]!.endsWith(":"))) out.pop();
  }
  return out.join("/");
}
