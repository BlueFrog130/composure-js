// `jsxImportSource: "composurejs"` resolves here. No virtual DOM: built-in tags are functions
// that return nodes, and user components (Views) are called as they are met (ADR 0004).
import { type Child, type ElementNode, createNode } from "./jsx/node.ts"

type Component = (props: any) => Child

export function jsx(type: Component | string, props: Record<string, unknown>, _key?: unknown): JSX.Element {
  if (typeof type === "string") return createNode(type, props)
  return type(props) as JSX.Element
}

export { jsx as jsxs }

export function Fragment(props: { children?: Child }): JSX.Element {
  return createNode("Fragment", props)
}

export declare namespace JSX {
  type Element = ElementNode | Promise<ElementNode>
  type ElementType = string | Component
  interface ElementChildrenAttribute {
    children: {}
  }
  interface IntrinsicElements {
    /** A line break inside `<Text>`; JSX itself drops newlines. */
    br: {}
  }
}
