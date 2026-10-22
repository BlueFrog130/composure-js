// Placement rules for the static checks (ADR 0023): which built-in tags may go directly inside
// which. The render walk enforces the same rules when a View renders; test/placement.test.tsx renders
// every pair against this table so the two cannot drift. `checkPlacement` walks an ESTree program
// (oxc's in @composurejs/vite, ESLint's or oxlint's in @composurejs/eslint-plugin).

export const SELECTS: readonly string[] = ["StringSelect", "UserSelect", "RoleSelect", "MentionableSelect", "ChannelSelect"]
export const INPUTS: readonly string[] = [...SELECTS, "TextInput", "RadioGroup", "CheckboxGroup", "Checkbox", "FileUpload"]

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
]

/** A text child (a string that is not only whitespace), or `<br />`. */
export const TEXT = "#text"

export interface Placement {
  /** What may go directly inside: tags, and {@link TEXT}. */
  children: readonly string[]
  /** The reason a child cannot go inside, where it says more than "cannot go inside". */
  hints?: Readonly<Record<string, string>>
}

const BLOCKS = [TEXT, "Text", "Section", "Row", "Gallery", "Separator", "File"]
const ACCESSORY_HINT = "goes in <Section accessory={..}>, not inside <Section>"

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
}

/** What `<Section accessory={..}>` takes. */
export const ACCESSORY: readonly string[] = ["Button", "Thumbnail"]

const ROOTS = new Set(["Message", "Modal"])

/**
 * Why `child` cannot go directly inside `parent`, or undefined when it can (or no rule applies).
 * `child` is a tag, `"br"`, or {@link TEXT}.
 */
export function placementError(parent: string, child: string): string | undefined {
  const rules = PLACEMENT[parent]
  if (!rules || rules.children.includes(child === "br" ? TEXT : child)) return undefined
  const what = child === TEXT ? "text" : `<${child}>`
  if (ROOTS.has(child)) return `${what} can only be the root of a View`
  const hint = rules.hints?.[child]
  return `${what} ${hint ?? `cannot go ${parent === "Message" ? "at the top of a message" : `inside <${parent}>`}`}`
}

/** Why `child` cannot be a `<Section>` accessory, or undefined when it can. */
export function accessoryError(child: string): string | undefined {
  if (ACCESSORY.includes(child)) return undefined
  if (child === TEXT) return "<Section> needs exactly one accessory: a <Button> or <Thumbnail>"
  return `<${child}> cannot be a <Section> accessory; use a <Button> or <Thumbnail>`
}

// ---- The static check ----------------------------------------------------------------------

/** An ESTree node, as oxc, espree and typescript-eslint produce them. */
export interface AstNode {
  type: string
  [key: string]: any
}

export interface PlacementProblem {
  /** The misplaced child: a JSX element, text, or expression. */
  node: AstNode
  message: string
}

const SOURCES = new Set(["composurejs", "composurejs/components"])
// `parent` is the cycle ESLint adds; the rest are positions and types.
const SKIP = new Set(["parent", "loc", "range", "start", "end", "tokens", "comments", "typeAnnotation", "returnType", "typeParameters", "typeArguments"])

/**
 * Finds built-in tags written directly inside a parent that cannot hold them, in one module.
 * Tags count when imported from `composurejs` or `composurejs/components` (renamed, or as a
 * namespace). Children are followed through fragments, `&&` / `||` / `??`, `? :`, arrays and
 * `.map(..)` callbacks; anything else (a component call, a variable) is left to the render walk.
 */
export function checkPlacement(program: AstNode): PlacementProblem[] {
  const tags = new Map<string, string>()
  const namespaces = new Set<string>()
  for (const s of program.body as AstNode[]) {
    if (s.type !== "ImportDeclaration" || !SOURCES.has(s.source.value) || s.importKind === "type") continue
    for (const spec of s.specifiers as AstNode[]) {
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name)
      if (spec.type !== "ImportSpecifier" || spec.importKind === "type") continue
      const imported: string = spec.imported.name ?? spec.imported.value
      if (TAGS.includes(imported)) tags.set(spec.local.name, imported)
    }
  }
  if (tags.size === 0 && namespaces.size === 0) return []

  const tagOf = (element: AstNode): string | undefined => {
    const name = element.openingElement.name
    if (name.type === "JSXIdentifier") return name.name === "br" ? "br" : tags.get(name.name)
    if (name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier" && namespaces.has(name.object.name) && TAGS.includes(name.property.name)) {
      return name.property.name
    }
    return undefined
  }

  /** The children an expression evaluates to that can be told statically. */
  const kinds = (node: AstNode | null | undefined, out: [AstNode, string][] = []): [AstNode, string][] => {
    if (!node) return out
    switch (node.type) {
      case "JSXElement": {
        const tag = tagOf(node)
        if (tag) out.push([node, tag])
        break
      }
      case "JSXFragment":
        for (const c of node.children) kinds(c, out)
        break
      case "JSXText":
        if (node.value.trim() !== "") out.push([node, TEXT])
        break
      case "JSXExpressionContainer":
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
        kinds(node.expression, out)
        break
      case "Literal":
        if ((typeof node.value === "string" && node.value.trim() !== "") || typeof node.value === "number") out.push([node, TEXT])
        break
      case "TemplateLiteral":
        if (node.expressions.length > 0 || node.quasis.some((q: AstNode) => q.value.cooked?.trim())) out.push([node, TEXT])
        break
      case "LogicalExpression":
        // `cond && <X />`: the left side is a condition; `a ?? <X />` may render either.
        if (node.operator !== "&&") kinds(node.left, out)
        kinds(node.right, out)
        break
      case "ConditionalExpression":
        kinds(node.consequent, out)
        kinds(node.alternate, out)
        break
      case "ArrayExpression":
        for (const e of node.elements) kinds(e, out)
        break
      case "CallExpression": {
        const { callee } = node
        const fn = node.arguments[0]
        const mapping = callee.type === "MemberExpression" && !callee.computed && (callee.property.name === "map" || callee.property.name === "flatMap")
        if (!mapping || !fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) break
        if (fn.body.type !== "BlockStatement") kinds(fn.body, out)
        else for (const s of fn.body.body) if (s.type === "ReturnStatement") kinds(s.argument, out)
        break
      }
    }
    return out
  }

  const problems: PlacementProblem[] = []
  const visit = (node: AstNode): void => {
    if (node.type === "JSXElement") {
      const parent = tagOf(node)
      if (parent) {
        for (const child of node.children) {
          for (const [at, kind] of kinds(child)) {
            const message = placementError(parent, kind)
            if (message) problems.push({ node: at, message })
          }
        }
        if (parent === "Section") {
          for (const attr of node.openingElement.attributes) {
            if (attr.type !== "JSXAttribute" || attr.name.name !== "accessory") continue
            for (const [at, kind] of kinds(attr.value)) {
              const message = accessoryError(kind)
              if (message) problems.push({ node: at, message })
            }
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (SKIP.has(key)) continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const v of value) if (v && typeof v.type === "string") visit(v)
      } else if (value && typeof value.type === "string") visit(value)
    }
  }
  visit(program)
  return problems
}
