// Inline Handler hoisting (composurejs ADR 0015). Every onClick / onSelect / onSubmit written as a
// function, in any module, moves to module scope under a stable id, and its site becomes a
// reference bound to the values the closure reads from the functions around it. Captures are found
// syntactically: bindings of enclosing functions (props, locals, loop variables, a command
// handler's c), as the member chains read from them; module-scope bindings are not captured.
import { createHash } from "node:crypto";
import MagicString, { type SourceMap } from "magic-string";
import { parseSync } from "oxc-parser";

type Node = { type: string; start: number; end: number; [key: string]: any };

export class HandlerTransformError extends Error {
  override name = "HandlerTransformError";
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

/** One handler a module ships: its id, where it is, and what it captures (the Handler Lock records these). */
export interface ShippedHandler {
  id: string;
  where: string;
  captures: string[];
}

export interface TransformResult {
  code: string;
  map: SourceMap;
  /** The module's handlers, in source order. */
  handlers: ShippedHandler[];
}

const SKIP_KEYS = new Set(["type", "start", "end", "range", "loc", "typeAnnotation", "returnType", "typeParameters", "typeArguments", "decorators"]);

function children(node: Node): [key: string, child: Node][] {
  const out: [string, Node][] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v.type === "string") out.push([key, v]);
    } else if (value && typeof value.type === "string") out.push([key, value]);
  }
  return out;
}

/** Names a binding pattern declares. */
function patternNames(pattern: Node | null | undefined, out: string[] = []): string[] {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const p of pattern.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      break;
    case "ArrayPattern":
      for (const e of pattern.elements) patternNames(e, out);
      break;
    case "AssignmentPattern":
      patternNames(pattern.left, out);
      break;
    case "RestElement":
      patternNames(pattern.argument, out);
      break;
    case "TSParameterProperty":
      patternNames(pattern.parameter, out);
      break;
  }
  return out;
}

const isFunction = (n: Node) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";

/** A name a block's statement binds to one value: `const go = ..`, `function go() {}`. */
interface Declared {
  kind: string;
  /** The VariableDeclarator or FunctionDeclaration. */
  node: Node;
}

/** Declarations hoisted to the top of a block or function body; `declared` collects the single-name ones. */
function blockDeclarations(statements: Node[], declared?: Map<string, Declared>): string[] {
  const out: string[] = [];
  for (let s of statements) {
    if (s.type === "ExportNamedDeclaration" && s.declaration) s = s.declaration;
    if (s.type === "VariableDeclaration") {
      for (const d of s.declarations) {
        patternNames(d.id, out);
        if (d.id.type === "Identifier") declared?.set(d.id.name, { kind: s.kind, node: d });
      }
    } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) {
      out.push(s.id.name);
      if (s.type === "FunctionDeclaration") declared?.set(s.id.name, { kind: "function", node: s });
    }
  }
  return out;
}

/**
 * Names declared in one scope; `params` are the enclosing function's parameters. A block (or a
 * function's block body) also keeps its `declared` bindings, itself, and the nodes around it.
 */
type Scope = Set<string> & { params?: Set<string>; declared?: Map<string, Declared>; block?: Node; parents?: Node[] };

const unwrap = (expr: Node): Node =>
  expr.type === "ParenthesizedExpression" || expr.type === "TSAsExpression" || expr.type === "TSSatisfiesExpression" || expr.type === "TSNonNullExpression"
    ? unwrap(expr.expression)
    : expr;

/** The function a local declaration holds as written (`const go = (c) => ..`, `function go() {}`), if any. */
const declaredFunction = (d: Declared): Node | undefined => (d.kind === "function" ? d.node : d.node.init && isFunction(unwrap(d.node.init)) ? unwrap(d.node.init) : undefined);

interface Visitor {
  /** Return false to skip the node's children. */
  enter?(node: Node, parents: Node[], scopes: Scope[]): boolean | void;
  reference?(node: Node, parents: Node[], scopes: Scope[]): void;
}

/** Walks `node` tracking lexical scopes; reports identifier references. */
function walk(node: Node, visitor: Visitor, parents: Node[] = [], scopes: Scope[] = []): void {
  if (visitor.enter?.(node, parents, scopes) === false) return;
  const inner = [...parents, node];

  if (isFunction(node)) {
    const scope: Scope = new Set();
    scope.params = new Set(node.params.flatMap((p: Node) => patternNames(p, [])));
    if (node.type === "FunctionExpression" && node.id) scope.add(node.id.name);
    for (const n of scope.params) scope.add(n);
    const body = node.body;
    if (body.type === "BlockStatement") {
      Object.assign(scope, { declared: new Map(), block: body, parents: inner });
      blockDeclarations(body.body, scope.declared).forEach((n) => scope.add(n));
    }
    const next = [...scopes, scope];
    for (const p of node.params) walkPattern(p, visitor, inner, next);
    if (body.type === "BlockStatement") for (const s of body.body) walk(s, visitor, [...inner, body], next);
    else walk(body, visitor, inner, next);
    return;
  }
  if (node.type === "BlockStatement" || node.type === "StaticBlock") {
    const declared = new Map<string, Declared>();
    const next = [...scopes, Object.assign(new Set(blockDeclarations(node.body, declared)), { declared, block: node, parents: inner })];
    for (const s of node.body) walk(s, visitor, inner, next);
    return;
  }
  if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
    const head = node.type === "ForStatement" ? node.init : node.left;
    const scope: Scope = new Set(head?.type === "VariableDeclaration" ? head.declarations.flatMap((d: Node) => patternNames(d.id)) : []);
    const next = [...scopes, scope];
    for (const [, child] of children(node)) walk(child, visitor, inner, next);
    return;
  }
  if (node.type === "CatchClause") {
    const next = [...scopes, new Set(patternNames(node.param))];
    if (node.param) walkPattern(node.param, visitor, inner, next);
    walk(node.body, visitor, inner, next);
    return;
  }
  if (node.type === "VariableDeclarator") {
    walkPattern(node.id, visitor, inner, scopes);
    if (node.init) walk(node.init, visitor, inner, scopes);
    return;
  }
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    // name declared by the enclosing block
  }
  if (node.type === "Identifier") {
    if (isReference(node, parents[parents.length - 1])) visitor.reference?.(node, parents, scopes);
    return;
  }
  if (node.type.startsWith("TS")) {
    // Types are erased: only expressions wrapped in `x as T`, `x!`, `x satisfies T` matter.
    if (node.expression) walk(node.expression, visitor, inner, scopes);
    return;
  }
  if (node.type === "LabeledStatement" || node.type === "BreakStatement" || node.type === "ContinueStatement") {
    if (node.body) walk(node.body, visitor, inner, scopes);
    return;
  }
  for (const [, child] of children(node)) walk(child, visitor, inner, scopes);
}

/** Patterns declare names, but their defaults and computed keys are expressions. */
function walkPattern(pattern: Node | null, visitor: Visitor, parents: Node[], scopes: Scope[]): void {
  if (!pattern) return;
  const inner = [...parents, pattern];
  switch (pattern.type) {
    case "ObjectPattern":
      for (const p of pattern.properties) {
        if (p.type === "RestElement") walkPattern(p.argument, visitor, inner, scopes);
        else {
          if (p.computed) walk(p.key, visitor, inner, scopes);
          walkPattern(p.value, visitor, [...inner, p], scopes);
        }
      }
      break;
    case "ArrayPattern":
      for (const e of pattern.elements) walkPattern(e, visitor, inner, scopes);
      break;
    case "AssignmentPattern":
      walkPattern(pattern.left, visitor, inner, scopes);
      walk(pattern.right, visitor, inner, scopes);
      break;
    case "RestElement":
      walkPattern(pattern.argument, visitor, inner, scopes);
      break;
    case "TSParameterProperty":
      walkPattern(pattern.parameter, visitor, inner, scopes);
      break;
    default:
      if (pattern.type !== "Identifier") walk(pattern, visitor, parents, scopes);
  }
}

function isReference(node: Node, parent: Node | undefined): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case "MemberExpression":
      return parent.object === node || parent.computed;
    case "Property":
      return parent.value === node || (parent.computed && parent.key === node);
    case "MethodDefinition":
    case "PropertyDefinition":
    case "AccessorProperty":
      return parent.computed && parent.key === node;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return false;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;
  }
  return true;
}

const findScope = (scopes: Scope[], name: string) => {
  for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i]!.has(name)) return i;
  return -1;
};

/** `item.id.length` read from `item`: the longest plain member chain, not counting a called method. */
function memberChain(id: Node, parents: Node[]): string[] {
  const path = [id.name as string];
  let current = id;
  for (let i = parents.length - 1; i >= 0; i--) {
    const parent = parents[i]!;
    if (parent.type !== "MemberExpression" || parent.object !== current || parent.computed || parent.property.type !== "Identifier") break;
    const grand = parents[i - 1];
    if (grand && grand.type === "CallExpression" && grand.callee === parent) break;
    if (grand && (grand.type === "AssignmentExpression" || grand.type === "UpdateExpression")) break;
    path.push(parent.property.name);
    current = parent;
  }
  return path;
}

const HANDLER_ATTRS = new Set(["onClick", "onSelect", "onSubmit"]);
/** Ids given with named(); generated ids start with `_`, so the two never collide. */
const NAMED_ID = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,31}$/;

interface Site {
  /** What the handler reference replaces: the inline function, the whole `named(..)` call, or a module-level name. */
  replace: Node;
  closure: Node;
  /** A module-level or imported name: wrapped when it holds a function, passed on when it already holds a reference. */
  reference?: true;
  /** A local declaration an `on*` prop names, tagged where it is declared; `block` (a function declaration's) is where the tag goes. */
  local?: { name: string; block?: Node };
  /** The id from named(), else generated. */
  name: string | undefined;
  owner: string;
  attr: string;
  /** Member chains of enclosing-function bindings the closure reads (`count`, `item.id`). */
  locals: string[];
}

/** The module's ESTree program; undefined when it does not parse (the real compiler reports it). */
export function parseModule(code: string, id: string): Node | undefined {
  const { program, errors } = parseSync(id, code);
  return errors.length > 0 ? undefined : (program as unknown as Node);
}

export interface TransformOptions {
  /** Generated ids hash the module path relative to this (Vite's root). */
  root?: string;
}

/**
 * Hoists every Inline Handler in one module (ADR 0015): `onClick` / `onSelect` / `onSubmit`
 * written as a function, and `named("id", fn)`. Each becomes a module-level
 * `__composure_handler(id, captures, make)`, and its site becomes `ref.bind([captured values])`.
 * Undefined when the module has none.
 */
export function transformHandlers(
  code: string,
  id: string,
  options: TransformOptions = {},
  parse: () => Node | undefined = () => parseModule(code, id),
): TransformResult | undefined {
  if (!/\bon(?:Click|Select|Submit)\b|\bnamed\s*\(/.test(code)) return undefined;
  const program = parse();
  if (!program) return undefined;

  const namedLocals = new Set<string>();
  const namespaces = new Set<string>();
  let lastImport: Node | undefined;
  for (const s of program.body as Node[]) {
    if (s.type !== "ImportDeclaration") continue;
    lastImport = s;
    if (s.source.value !== "composurejs" || s.importKind === "type") continue;
    for (const spec of s.specifiers) {
      if (spec.type === "ImportSpecifier" && (spec.imported.name ?? spec.imported.value) === "named") namedLocals.add(spec.local.name);
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name);
    }
  }
  const isNamed = (node: Node) =>
    node.type === "CallExpression" &&
    ((node.callee.type === "Identifier" && namedLocals.has(node.callee.name)) ||
      (node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.object.type === "Identifier" &&
        namespaces.has(node.callee.object.name) &&
        node.callee.property.name === "named"));

  const sites: Site[] = [];
  const tagged = new Set<Node>();
  /** `onClick={go}` naming a local: its declaration is tagged once, however many props name it. */
  const localSite = (leaf: Node, scopes: Scope[], at: number, attr: string) => {
    const scope = scopes[at]!;
    const declared = scope.declared?.get(leaf.name);
    if (declared?.kind === "const" && declared.node.init && isNamed(unwrap(declared.node.init))) return;
    const fn = declared && declaredFunction(declared);
    if (!fn) {
      throw new HandlerTransformError(
        `${attr}={${leaf.name}}: ${leaf.name} is a local variable that does not hold a function written there, so it cannot be hoisted. Write the handler inline, as a local const or function, at module scope, or use named("id", ..)`,
        leaf.start,
      );
    }
    if (declared.kind !== "const" && declared.kind !== "function") {
      throw new HandlerTransformError(`${attr}={${leaf.name}}: ${leaf.name} is declared with ${declared.kind}; declare the handler with const`, leaf.start);
    }
    if (tagged.has(fn)) return;
    tagged.add(fn);
    const base = ownerOf(scope.parents!);
    sites.push({
      replace: fn,
      closure: fn,
      local: declared.kind === "function" ? { name: leaf.name, block: scope.block! } : { name: leaf.name },
      name: undefined,
      owner: base === "(module)" ? leaf.name : `${base}.${leaf.name}`,
      attr: "local",
      locals: captureLocals(fn, scopes.slice(0, at + 1), leaf.name, leaf.name),
    });
  };
  walk(program, {
    enter(node, parents, scopes) {
      if (node.type === "JSXAttribute" && node.name.type === "JSXIdentifier" && HANDLER_ATTRS.has(node.name.name) && node.value?.type === "JSXExpressionContainer") {
        const attr: string = node.name.name;
        const owner = ownerOf(parents);
        for (const leaf of handlerLeaves(node.value.expression)) {
          if (isFunction(leaf)) {
            sites.push({ replace: leaf, closure: leaf, name: undefined, owner, attr, locals: captureLocals(leaf, scopes, attr) });
          } else if (leaf.type === "Identifier") {
            const at = findScope(scopes, leaf.name);
            // Module scope, an import or a global: wrapped as a handler with no captures.
            if (at < 0) {
              if (leaf.name !== "undefined") sites.push({ replace: leaf, closure: leaf, reference: true, name: undefined, owner, attr, locals: [] });
            }
            // A parameter (a handler prop passed through a wrapper component) already holds a reference.
            else if (!scopes[at]!.params?.has(leaf.name)) localSite(leaf, scopes, at, attr);
          } else if (leaf.type === "CallExpression" && !isNamed(leaf)) {
            throw new HandlerTransformError(
              `${attr}={${code.slice(leaf.callee.start, leaf.callee.end)}(..)}: a handler made by a call cannot be hoisted. Write it inline, define it at module scope, or use named("id", ..)`,
              leaf.start,
            );
          }
        }
        return;
      }
      if (isNamed(node)) {
        const [nameArg, fn] = node.arguments as Node[];
        const name =
          nameArg?.type === "Literal" && typeof nameArg.value === "string"
            ? nameArg.value
            : nameArg?.type === "TemplateLiteral" && nameArg.expressions.length === 0
              ? (nameArg.quasis[0].value.cooked as string)
              : undefined;
        if (name === undefined) throw new HandlerTransformError("named() needs a string literal id", node.start);
        if (!NAMED_ID.test(name)) throw new HandlerTransformError(`named("${name}", ..): ids are 1-32 letters, digits, "_" or "-", not starting with "_"`, node.start);
        if (!fn || !isFunction(fn)) throw new HandlerTransformError(`named("${name}", ..) needs the handler written inline`, node.start);
        if (sites.some((s) => s.name === name)) throw new HandlerTransformError(`named("${name}") is used twice in this module`, node.start);
        sites.push({ replace: node, closure: fn, name, owner: ownerOf(parents), attr: "named", locals: captureLocals(fn, scopes, `named("${name}")`) });
      }
    },
  });
  if (sites.length === 0) return undefined;

  const file = relativePath(id, options.root);
  const ordinals = new Map<string, number>();
  const ids = sites.map((site) => {
    // A local counts apart from the handlers in its body, which share its owner.
    const key = site.local ? `${site.owner}|local` : site.owner;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    return (
      site.name ??
      `_${createHash("sha256")
        .update(`${file}|${site.owner}|${ordinal}|${site.attr}|${site.locals.join(",")}`)
        .digest("base64url")
        .slice(0, 7)}`
    );
  });

  // Innermost first, so a handler that returns markup with handlers carries them rewritten. A local
  // stays where it is declared, tagged with its reference; its Captures are read when it renders.
  const s = new MagicString(code);
  const order = sites.map((_, i) => i).sort((a, b) => sites[b]!.replace.start - sites[a]!.replace.start);
  const decls: string[] = [];
  for (const i of order) {
    const site = sites[i]!;
    const ref = `__composure_h${i}`;
    const closure = s.slice(site.closure.start, site.closure.end);
    const bound = `${ref}.bind([${site.locals.join(", ")}])`;
    const values = `() => [${site.locals.join(", ")}]`;
    if (site.local?.block) s.appendLeft(site.local.block.start + 1, ` ${ref}.local(${site.local.name}, ${values});`);
    else if (site.local) s.overwrite(site.replace.start, site.replace.end, `${ref}.local(${closure}, ${values})`);
    else s.overwrite(site.replace.start, site.replace.end, site.reference ? `(typeof ${closure} === "function" ? ${bound} : ${closure})` : bound);
    const roots = [...new Set(site.locals.map((path) => path.split(".")[0]!))];
    const where = `${file}: ${site.owner}`;
    decls[i] =
      `const ${ref} = __composure_handler(${JSON.stringify(ids[i])}, ${JSON.stringify(site.locals)}, (${roots.length > 0 ? `{ ${roots.join(", ")} }` : ""}) => (${closure}), ${JSON.stringify(where)});`;
  }
  const header = `\nimport { __handler as __composure_handler } from "composurejs";\n${decls.join("\n")}\n`;
  if (lastImport) s.appendLeft(lastImport.end, header);
  else s.prepend(header);
  const handlers = sites.map((site, i) => ({ id: ids[i]!, where: `${file}: ${site.owner}`, captures: site.locals }));
  return { code: s.toString(), map: s.generateMap({ hires: true, source: id, includeContent: true }), handlers };
}

/**
 * The expressions a handler prop can take its value from: both branches of `?:`, the right side of
 * `&&`, both sides of `||` and `??`, through parentheses and type assertions.
 */
function handlerLeaves(expr: Node): Node[] {
  switch (expr.type) {
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return handlerLeaves(expr.expression);
    case "ConditionalExpression":
      return [...handlerLeaves(expr.consequent), ...handlerLeaves(expr.alternate)];
    case "LogicalExpression":
      return expr.operator === "&&" ? handlerLeaves(expr.right) : [...handlerLeaves(expr.left), ...handlerLeaves(expr.right)];
  }
  return [expr];
}

/** `Counter`, `cookie.handler`, `Shop.render`: the named declarations around a handler. */
function ownerOf(parents: Node[]): string {
  const names: string[] = [];
  for (const p of parents) {
    if ((p.type === "FunctionDeclaration" || p.type === "ClassDeclaration" || p.type === "FunctionExpression") && p.id) names.push(p.id.name);
    else if (p.type === "VariableDeclarator" && p.id.type === "Identifier") names.push(p.id.name);
    else if ((p.type === "Property" || p.type === "MethodDefinition" || p.type === "PropertyDefinition") && !p.computed) names.push(String(p.key.name ?? p.key.value));
    else if (p.type === "ExportDefaultDeclaration") names.push("default");
  }
  return names.join(".") || "(module)";
}

export function relativePath(id: string, root: string | undefined): string {
  const file = id.replace(/\\/g, "/");
  const base = root?.replace(/\\/g, "/").replace(/\/?$/, "/");
  return base && file.startsWith(base) ? file.slice(base.length) : file;
}

function rootOfJsxMember(name: Node): Node | undefined {
  let at = name;
  while (at.type === "JSXMemberExpression") at = at.object;
  return at;
}

/**
 * What a closure reads from the functions around it: shortest member chains, roots read bare whole.
 * `self` is the name of a local handler, which may not read itself.
 */
function captureLocals(closure: Node, scopes: Scope[], what: string, self?: string): string[] {
  const chains = new Map<string, string[]>();
  walk(
    closure,
    {
      // A tag is a reference too, but a component cannot travel in a custom_id.
      enter(node, _parents, inner) {
        if (node.type !== "JSXOpeningElement") return;
        const root = node.name.type === "JSXMemberExpression" ? rootOfJsxMember(node.name) : node.name;
        if (root?.type !== "JSXIdentifier" || !/^[A-Z]/.test(root.name)) return;
        const at = findScope(inner, root.name);
        if (at >= 0 && at < scopes.length) {
          throw new HandlerTransformError(
            `<${root.name}> is defined inside a function, but the ${what} handler rendering it is hoisted to module scope: define ${root.name} at module scope`,
            node.start,
          );
        }
      },
      reference(node, parents, inner) {
        const at = findScope(inner, node.name);
        // Declared in the closure itself, or module scope / global: not a capture.
        if (at < 0 || at >= scopes.length) return;
        const declared = inner[at]!.declared?.get(node.name);
        if (declared && declaredFunction(declared)) {
          throw new HandlerTransformError(
            node.name === self
              ? `${self} is a local handler that names itself, but it is hoisted to module scope, where ${self} is out of reach: render a component that places it`
              : `The ${what} handler reads ${node.name}, a function declared inside a function, but the handler is hoisted to module scope: declare ${node.name} inside the handler, or at module scope`,
            node.start,
          );
        }
        const list = chains.get(node.name) ?? [];
        list.push(memberChain(node, parents).join("."));
        chains.set(node.name, list);
      },
    },
    [],
    scopes,
  );
  const locals: string[] = [];
  for (const list of chains.values()) {
    const kept: string[] = [];
    for (const path of [...new Set(list)].sort((a, b) => a.length - b.length)) if (!kept.some((k) => path === k || path.startsWith(`${k}.`))) kept.push(path);
    locals.push(...kept);
  }
  return locals;
}
