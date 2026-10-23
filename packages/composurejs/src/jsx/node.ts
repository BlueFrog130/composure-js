// The tree JSX builds (ADR 0004): tagged nodes, turned into Discord JSON by render.

const NODE = Symbol.for("composurejs.node")

/** A built-in tag with its props, as JSX produced it. */
export interface ElementNode {
  readonly [NODE]: true
  readonly tag: string
  readonly props: Readonly<Record<string, unknown>>
}

/** Anything JSX accepts as a child. Falsy values (except 0) render nothing. */
export type Child = ElementNode | string | number | bigint | boolean | null | undefined | Iterable<Child> | Promise<Child>

export function createNode(tag: string, props: Record<string, unknown>): ElementNode {
  return { [NODE]: true, tag, props }
}

export function isNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && (value as Partial<ElementNode>)[NODE] === true
}
