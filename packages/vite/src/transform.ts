// Inline Handler hoisting (composurejs ADR 0005). For each `view(prefix, { render(props, on) })`
// imported from composurejs, every `on("name", closure)` in render becomes
// `on.$("name", [locals])`, and the closure moves to a `handlers` entry on the same config:
//
//   name: { props: [[local, prop]..], locals: ["item.id"..], make: ({ ..captures }) => closure }
//
// Captures are found syntactically: identifiers the closure reads that are bound in render
// (Props, locals, loop variables), but not module-scope ones. A Prop is captured whole (core
// encodes it with its Codec); a local is captured as the member chains read from it.
import MagicString, { type SourceMap } from "magic-string"
import { parseSync } from "oxc-parser"

type Node = { type: string; start: number; end: number; [key: string]: any }

export class ViewTransformError extends Error {
  override name = "ViewTransformError"
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

interface Hoisted {
  name: string
  call: Node
  closure: Node
  props: [local: string, prop: string][]
  locals: string[]
}

/** Rewrites the Views in one module; undefined when there is nothing to do. */
export function transformViews(code: string, id: string): TransformResult | undefined {
  if (!code.includes("composurejs") || !/\bview\b/.test(code) || !/\bon\b/.test(code)) return undefined
  const { program, errors } = parseSync(id, code)
  if (errors.length > 0) return undefined // let the real compiler report it

  const viewNames = new Set<string>()
  const namespaces = new Set<string>()
  for (const s of program.body as Node[]) {
    if (s.type !== "ImportDeclaration" || s.source.value !== "composurejs" || s.importKind === "type") continue
    for (const spec of s.specifiers) {
      if (spec.type === "ImportSpecifier" && (spec.imported.name ?? spec.imported.value) === "view") viewNames.add(spec.local.name)
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name)
    }
  }
  if (viewNames.size === 0 && namespaces.size === 0) return undefined

  const s = new MagicString(code)
  let changed = false
  walk(program as unknown as Node, {
    enter(node) {
      if (node.type !== "CallExpression") return
      const callee = node.callee
      const isView =
        (callee.type === "Identifier" && viewNames.has(callee.name)) ||
        (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && namespaces.has(callee.object.name) && callee.property.name === "view")
      const config = node.arguments[1]
      if (!isView || config?.type !== "ObjectExpression") return
      if (hoistView(code, s, config)) changed = true
    },
  })
  return changed ? { code: s.toString(), map: s.generateMap({ hires: true, source: id, includeContent: true }) } : undefined
}

function propertyNamed(object: Node, name: string): Node | undefined {
  return object.properties.find((p: Node) => p.type === "Property" && !p.computed && (p.key.name ?? p.key.value) === name)
}

/** Hoists one View's Inline Handlers; true if it had any. */
function hoistView(code: string, s: MagicString, config: Node): boolean {
  const renderProp = propertyNamed(config, "render")
  const render = renderProp?.value
  if (!render || !isFunction(render)) return false
  const onParam = render.params[1]
  if (onParam?.type !== "Identifier") return false
  const onName: string = onParam.name
  if (propertyNamed(config, "handlers")) throw new ViewTransformError("A View's handlers are written by @composurejs/vite; remove the handlers property", config.start)

  // Which render bindings are Props: `{ title, likes: l }` destructuring, or a `props` identifier.
  const propsParam: Node | undefined = render.params[0]
  const propLocals = new Map<string, string>()
  let propsObject: string | undefined
  if (propsParam?.type === "Identifier") propsObject = propsParam.name
  else if (propsParam?.type === "ObjectPattern") {
    for (const p of propsParam.properties) {
      if (p.type !== "Property" || p.computed) continue
      const value = p.value.type === "AssignmentPattern" ? p.value.left : p.value
      if (value.type === "Identifier") propLocals.set(value.name, p.key.name ?? p.key.value)
    }
  }

  const hoisted: Hoisted[] = []
  walk(render, {
    enter(node, _parents, scopes) {
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== onName) return
      // `on` must still be render's parameter here, not a shadowing binding.
      if (findScope(scopes, onName) !== 0) return
      const [nameArg, closure] = node.arguments as Node[]
      const name =
        nameArg?.type === "Literal" && typeof nameArg.value === "string" ? nameArg.value
        : nameArg?.type === "TemplateLiteral" && nameArg.expressions.length === 0 ? nameArg.quasis[0].value.cooked
        : undefined
      if (name === undefined) throw new ViewTransformError(`${onName}() needs a string literal handler name`, node.start)
      if (!closure || (closure.type !== "ArrowFunctionExpression" && closure.type !== "FunctionExpression")) {
        throw new ViewTransformError(`${onName}("${name}", ..) needs the handler written inline as a function, so it can be hoisted`, node.start)
      }
      if (hoisted.some((h) => h.name === name)) throw new ViewTransformError(`Handler name "${name}" is used twice in one View`, node.start)
      hoisted.push({ name, call: node, closure, ...captures(closure, scopes, onName, propLocals, propsObject) })
      return false
    },
  })
  if (hoisted.length === 0) return false

  for (const h of hoisted) {
    s.overwrite(h.call.start, h.call.end, `${onName}.$(${JSON.stringify(h.name)}, [${h.locals.join(", ")}])`)
  }
  const entries = hoisted.map((h) => {
    const roots = [...new Set([...h.props.map(([local]) => local), ...h.locals].map((path) => path.split(".")[0]!))]
    const params = roots.length > 0 ? `{ ${roots.join(", ")} }` : "_"
    return `${JSON.stringify(h.name)}: { props: ${JSON.stringify(h.props)}, locals: ${JSON.stringify(h.locals)}, make: (${params}) => (${code.slice(h.closure.start, h.closure.end)}) }`
  })
  const last = config.properties[config.properties.length - 1]
  s.appendLeft(last.end, `, handlers: { ${entries.join(", ")} }`)
  return true
}

function captures(closure: Node, renderScopes: Scope[], onName: string, propLocals: Map<string, string>, propsObject: string | undefined): Pick<Hoisted, "props" | "locals"> {
  const props = new Map<string, string>()
  const chains = new Map<string, string[][]>()
  walk(
    closure,
    {
      enter(node) {
        if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === onName) {
          throw new ViewTransformError(`${onName}() cannot be called inside a handler`, node.start)
        }
      },
      reference(node, parents, scopes) {
        const at = findScope(scopes, node.name)
        // Declared in the closure itself (at >= renderScopes.length), or module scope / global (-1).
        if (at < 0 || at >= renderScopes.length) return
        const chain = memberChain(node, parents)
        if (propLocals.has(node.name) && at === 0) props.set(node.name, propLocals.get(node.name)!)
        else if (propsObject === node.name && at === 0) {
          // `props.title` captures one Prop, as path `props.title`; bare `props` captures all.
          if (chain.length > 1) props.set(`${node.name}.${chain[1]}`, chain[1]!)
          else props.set(node.name, "*")
        } else {
          const list = chains.get(node.name) ?? []
          list.push(chain)
          chains.set(node.name, list)
        }
      },
    },
    [],
    renderScopes,
  )

  // Whole-Props capture covers the per-Prop ones.
  const all = propsObject !== undefined && props.get(propsObject) === "*"
  const propEntries = [...props.entries()].filter(([local]) => !all || local === propsObject).map(([local, prop]) => [local, prop] as [string, string])

  const locals: string[] = []
  for (const list of chains.values()) {
    // A bare read captures the root; otherwise keep the shortest chains that cover the others.
    const sorted = list.map((c) => c.join(".")).sort((a, b) => a.length - b.length)
    const kept: string[] = []
    for (const path of sorted) if (!kept.some((k) => path === k || path.startsWith(`${k}.`))) kept.push(path)
    locals.push(...kept)
  }
  return { props: propEntries, locals }
}
