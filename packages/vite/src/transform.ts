// Inline Handler hoisting (composurejs ADR 0015). Every onClick / onSelect / onSubmit written as a
// function, in any module, moves to module scope under a stable id, and its site becomes a
// reference bound to the values the closure reads from the functions around it. Captures are found
// syntactically: bindings of enclosing functions (props, locals, loop variables, a command
// handler's c), as the member chains read from them; module-scope bindings are not captured.
import { createHash } from "node:crypto"
import MagicString, { type SourceMap } from "magic-string"
import { parseSync } from "oxc-parser"

type Node = { type: string; start: number; end: number; [key: string]: any }

export class HandlerTransformError extends Error {
  override name = "HandlerTransformError"
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message)
  }
}

export interface TransformResult {
  code: string
  map: SourceMap
}

const SKIP_KEYS = new Set(["type", "start", "end", "range", "loc", "typeAnnotation", "returnType", "typeParameters", "typeArguments", "decorators"])

function children(node: Node): [key: string, child: Node][] {
  const out: [string, Node][] = []
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v.type === "string") out.push([key, v])
    } else if (value && typeof value.type === "string") out.push([key, value])
  }
  return out
}

/** Names a binding pattern declares. */
function patternNames(pattern: Node | null | undefined, out: string[] = []): string[] {
  if (!pattern) return out
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name)
      break
    case "ObjectPattern":
      for (const p of pattern.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out)
      break
    case "ArrayPattern":
      for (const e of pattern.elements) patternNames(e, out)
      break
    case "AssignmentPattern":
      patternNames(pattern.left, out)
      break
    case "RestElement":
      patternNames(pattern.argument, out)
      break
    case "TSParameterProperty":
      patternNames(pattern.parameter, out)
      break
  }
  return out
}

const isFunction = (n: Node) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression"

/** Declarations hoisted to the top of a block or function body. */
function blockDeclarations(statements: Node[]): string[] {
  const out: string[] = []
  for (let s of statements) {
    if (s.type === "ExportNamedDeclaration" && s.declaration) s = s.declaration
    if (s.type === "VariableDeclaration") for (const d of s.declarations) patternNames(d.id, out)
    else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.push(s.id.name)
  }
  return out
}

type Scope = Set<string>

interface Visitor {
  /** Return false to skip the node's children. */
  enter?(node: Node, parents: Node[], scopes: Scope[]): boolean | void
  reference?(node: Node, parents: Node[], scopes: Scope[]): void
}

/** Walks `node` tracking lexical scopes; reports identifier references. */
function walk(node: Node, visitor: Visitor, parents: Node[] = [], scopes: Scope[] = []): void {
  if (visitor.enter?.(node, parents, scopes) === false) return
  const inner = [...parents, node]

  if (isFunction(node)) {
    const scope: Scope = new Set()
    if (node.type === "FunctionExpression" && node.id) scope.add(node.id.name)
    for (const p of node.params) patternNames(p, []).forEach((n) => scope.add(n))
    const body = node.body
    if (body.type === "BlockStatement") blockDeclarations(body.body).forEach((n) => scope.add(n))
    const next = [...scopes, scope]
    for (const p of node.params) walkPattern(p, visitor, inner, next)
    if (body.type === "BlockStatement") for (const s of body.body) walk(s, visitor, [...inner, body], next)
    else walk(body, visitor, inner, next)
    return
  }
  if (node.type === "BlockStatement" || node.type === "StaticBlock") {
    const next = [...scopes, new Set(blockDeclarations(node.body))]
    for (const s of node.body) walk(s, visitor, inner, next)
    return
  }
  if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
    const head = node.type === "ForStatement" ? node.init : node.left
    const scope: Scope = new Set(head?.type === "VariableDeclaration" ? head.declarations.flatMap((d: Node) => patternNames(d.id)) : [])
    const next = [...scopes, scope]
    for (const [, child] of children(node)) walk(child, visitor, inner, next)
    return
  }
  if (node.type === "CatchClause") {
    const next = [...scopes, new Set(patternNames(node.param))]
    if (node.param) walkPattern(node.param, visitor, inner, next)
    walk(node.body, visitor, inner, next)
    return
  }
  if (node.type === "VariableDeclarator") {
    walkPattern(node.id, visitor, inner, scopes)
    if (node.init) walk(node.init, visitor, inner, scopes)
    return
  }
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    // name declared by the enclosing block
  }
  if (node.type === "Identifier") {
    if (isReference(node, parents[parents.length - 1])) visitor.reference?.(node, parents, scopes)
    return
  }
  if (node.type.startsWith("TS")) {
    // Types are erased: only expressions wrapped in `x as T`, `x!`, `x satisfies T` matter.
    if (node.expression) walk(node.expression, visitor, inner, scopes)
    return
  }
  if (node.type === "LabeledStatement" || node.type === "BreakStatement" || node.type === "ContinueStatement") {
    if (node.body) walk(node.body, visitor, inner, scopes)
    return
  }
  for (const [, child] of children(node)) walk(child, visitor, inner, scopes)
}

/** Patterns declare names, but their defaults and computed keys are expressions. */
function walkPattern(pattern: Node | null, visitor: Visitor, parents: Node[], scopes: Scope[]): void {
  if (!pattern) return
  const inner = [...parents, pattern]
  switch (pattern.type) {
    case "ObjectPattern":
      for (const p of pattern.properties) {
        if (p.type === "RestElement") walkPattern(p.argument, visitor, inner, scopes)
        else {
          if (p.computed) walk(p.key, visitor, inner, scopes)
          walkPattern(p.value, visitor, [...inner, p], scopes)
        }
      }
      break
    case "ArrayPattern":
      for (const e of pattern.elements) walkPattern(e, visitor, inner, scopes)
      break
    case "AssignmentPattern":
      walkPattern(pattern.left, visitor, inner, scopes)
      walk(pattern.right, visitor, inner, scopes)
      break
    case "RestElement":
      walkPattern(pattern.argument, visitor, inner, scopes)
      break
    case "TSParameterProperty":
      walkPattern(pattern.parameter, visitor, inner, scopes)
      break
    default:
      if (pattern.type !== "Identifier") walk(pattern, visitor, parents, scopes)
  }
}

function isReference(node: Node, parent: Node | undefined): boolean {
  if (!parent) return true
  switch (parent.type) {
    case "MemberExpression":
      return parent.object === node || parent.computed
    case "Property":
      return parent.value === node || (parent.computed && parent.key === node)
    case "MethodDefinition":
    case "PropertyDefinition":
    case "AccessorProperty":
      return parent.computed && parent.key === node
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return false
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node
  }
  return true
}

const findScope = (scopes: Scope[], name: string) => {
  for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i]!.has(name)) return i
  return -1
}

/** `item.id.length` read from `item`: the longest plain member chain, not counting a called method. */
function memberChain(id: Node, parents: Node[]): string[] {
  const path = [id.name as string]
  let current = id
  for (let i = parents.length - 1; i >= 0; i--) {
    const parent = parents[i]!
    if (parent.type !== "MemberExpression" || parent.object !== current || parent.computed || parent.property.type !== "Identifier") break
    const grand = parents[i - 1]
    if (grand && grand.type === "CallExpression" && grand.callee === parent) break
    if (grand && (grand.type === "AssignmentExpression" || grand.type === "UpdateExpression")) break
    path.push(parent.property.name)
    current = parent
  }
  return path
}

const HANDLER_ATTRS = new Set(["onClick", "onSelect", "onSubmit"])
/** Ids given with named(); generated ids start with `_`, so the two never collide. */
const NAMED_ID = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,31}$/

interface Site {
  /** What the handler reference replaces: the inline function, or the whole `named(..)` call. */
  replace: Node
  closure: Node
  /** The id from named(), else generated. */
  name: string | undefined
  owner: string
  attr: string
  /** Member chains of enclosing-function bindings the closure reads (`count`, `item.id`). */
  locals: string[]
}

/** The module's ESTree program; undefined when it does not parse (the real compiler reports it). */
export function parseModule(code: string, id: string): Node | undefined {
  const { program, errors } = parseSync(id, code)
  return errors.length > 0 ? undefined : (program as unknown as Node)
}

export interface TransformOptions {
  /** Generated ids hash the module path relative to this (Vite's root). */
  root?: string
}

/**
 * Hoists every Inline Handler in one module (ADR 0015): `onClick` / `onSelect` / `onSubmit`
 * written as a function, and `named("id", fn)`. Each becomes a module-level
 * `__composure_handler(id, captures, make)`, and its site becomes `ref.bind([captured values])`.
 * Undefined when the module has none.
 */
export function transformHandlers(code: string, id: string, options: TransformOptions = {}, parse: () => Node | undefined = () => parseModule(code, id)): TransformResult | undefined {
  if (!/\bon(?:Click|Select|Submit)\b|\bnamed\s*\(/.test(code)) return undefined
  const program = parse()
  if (!program) return undefined

  const namedLocals = new Set<string>()
  const namespaces = new Set<string>()
  let lastImport: Node | undefined
  for (const s of program.body as Node[]) {
    if (s.type !== "ImportDeclaration") continue
    lastImport = s
    if (s.source.value !== "composurejs" || s.importKind === "type") continue
    for (const spec of s.specifiers) {
      if (spec.type === "ImportSpecifier" && (spec.imported.name ?? spec.imported.value) === "named") namedLocals.add(spec.local.name)
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name)
    }
  }
  const isNamed = (node: Node) =>
    node.type === "CallExpression" &&
    ((node.callee.type === "Identifier" && namedLocals.has(node.callee.name)) ||
      (node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.object.type === "Identifier" && namespaces.has(node.callee.object.name) && node.callee.property.name === "named"))

  const sites: Site[] = []
  walk(program, {
    enter(node, parents, scopes) {
      if (node.type === "JSXAttribute" && node.name.type === "JSXIdentifier" && HANDLER_ATTRS.has(node.name.name) && node.value?.type === "JSXExpressionContainer") {
        const expr: Node = node.value.expression
        if (isFunction(expr)) {
          sites.push({ replace: expr, closure: expr, name: undefined, owner: ownerOf(parents), attr: node.name.name, locals: captureLocals(expr, scopes, node.name.name) })
        } else if (expr.type === "Identifier" && findScope(scopes, expr.name) >= 0) {
          throw new HandlerTransformError(`${node.name.name}={${expr.name}}: write the handler inline, so it can be hoisted with what it captures (or use named("id", ..))`, expr.start)
        }
        return
      }
      if (isNamed(node)) {
        const [nameArg, fn] = node.arguments as Node[]
        const name =
          nameArg?.type === "Literal" && typeof nameArg.value === "string" ? nameArg.value
          : nameArg?.type === "TemplateLiteral" && nameArg.expressions.length === 0 ? (nameArg.quasis[0].value.cooked as string)
          : undefined
        if (name === undefined) throw new HandlerTransformError("named() needs a string literal id", node.start)
        if (!NAMED_ID.test(name)) throw new HandlerTransformError(`named("${name}", ..): ids are 1-32 letters, digits, "_" or "-", not starting with "_"`, node.start)
        if (!fn || !isFunction(fn)) throw new HandlerTransformError(`named("${name}", ..) needs the handler written inline`, node.start)
        if (sites.some((s) => s.name === name)) throw new HandlerTransformError(`named("${name}") is used twice in this module`, node.start)
        sites.push({ replace: node, closure: fn, name, owner: ownerOf(parents), attr: "named", locals: captureLocals(fn, scopes, `named("${name}")`) })
      }
    },
  })
  if (sites.length === 0) return undefined

  const file = relativePath(id, options.root)
  const ordinals = new Map<string, number>()
  const ids = sites.map((site) => {
    const ordinal = ordinals.get(site.owner) ?? 0
    ordinals.set(site.owner, ordinal + 1)
    return site.name ?? `_${createHash("sha256").update(`${file}|${site.owner}|${ordinal}|${site.attr}|${site.locals.join(",")}`).digest("base64url").slice(0, 7)}`
  })

  // Innermost first, so a handler that returns markup with handlers carries them rewritten.
  const s = new MagicString(code)
  const order = sites.map((_, i) => i).sort((a, b) => sites[b]!.replace.start - sites[a]!.replace.start)
  const decls: string[] = []
  for (const i of order) {
    const site = sites[i]!
    const ref = `__composure_h${i}`
    const closure = s.slice(site.closure.start, site.closure.end)
    s.overwrite(site.replace.start, site.replace.end, `${ref}.bind([${site.locals.join(", ")}])`)
    const roots = [...new Set(site.locals.map((path) => path.split(".")[0]!))]
    const where = `${file}: ${site.owner}`
    decls[i] = `const ${ref} = __composure_handler(${JSON.stringify(ids[i])}, ${JSON.stringify(site.locals)}, (${roots.length > 0 ? `{ ${roots.join(", ")} }` : ""}) => (${closure}), ${JSON.stringify(where)});`
  }
  const header = `\nimport { __handler as __composure_handler } from "composurejs";\n${decls.join("\n")}\n`
  if (lastImport) s.appendLeft(lastImport.end, header)
  else s.prepend(header)
  return { code: s.toString(), map: s.generateMap({ hires: true, source: id, includeContent: true }) }
}

/** `Counter`, `cookie.handler`, `Shop.render`: the named declarations around a handler. */
function ownerOf(parents: Node[]): string {
  const names: string[] = []
  for (const p of parents) {
    if ((p.type === "FunctionDeclaration" || p.type === "ClassDeclaration" || p.type === "FunctionExpression") && p.id) names.push(p.id.name)
    else if (p.type === "VariableDeclarator" && p.id.type === "Identifier") names.push(p.id.name)
    else if ((p.type === "Property" || p.type === "MethodDefinition" || p.type === "PropertyDefinition") && !p.computed) names.push(String(p.key.name ?? p.key.value))
    else if (p.type === "ExportDefaultDeclaration") names.push("default")
  }
  return names.join(".") || "(module)"
}

export function relativePath(id: string, root: string | undefined): string {
  const file = id.replace(/\\/g, "/")
  const base = root?.replace(/\\/g, "/").replace(/\/?$/, "/")
  return base && file.startsWith(base) ? file.slice(base.length) : file
}

function rootOfJsxMember(name: Node): Node | undefined {
  let at = name
  while (at.type === "JSXMemberExpression") at = at.object
  return at
}

/** What a closure reads from the functions around it: shortest member chains, roots read bare whole. */
function captureLocals(closure: Node, scopes: Scope[], what: string): string[] {
  const chains = new Map<string, string[]>()
  walk(
    closure,
    {
      // A tag is a reference too, but a component cannot travel in a custom_id.
      enter(node, _parents, inner) {
        if (node.type !== "JSXOpeningElement") return
        const root = node.name.type === "JSXMemberExpression" ? rootOfJsxMember(node.name) : node.name
        if (root?.type !== "JSXIdentifier" || !/^[A-Z]/.test(root.name)) return
        const at = findScope(inner, root.name)
        if (at >= 0 && at < scopes.length) {
          throw new HandlerTransformError(`<${root.name}> is defined inside a function, but the ${what} handler rendering it is hoisted to module scope: define ${root.name} at module scope`, node.start)
        }
      },
      reference(node, parents, inner) {
        const at = findScope(inner, node.name)
        // Declared in the closure itself, or module scope / global: not a capture.
        if (at < 0 || at >= scopes.length) return
        const list = chains.get(node.name) ?? []
        list.push(memberChain(node, parents).join("."))
        chains.set(node.name, list)
      },
    },
    [],
    scopes,
  )
  const locals: string[] = []
  for (const list of chains.values()) {
    const kept: string[] = []
    for (const path of [...new Set(list)].sort((a, b) => a.length - b.length)) if (!kept.some((k) => path === k || path.startsWith(`${k}.`))) kept.push(path)
    locals.push(...kept)
  }
  return locals
}
