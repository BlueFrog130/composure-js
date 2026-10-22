// Built-in tags (ADR 0004). Each props interface is the tag's reference: document every attribute.
import type { JSX } from "./jsx-runtime.ts"
import { type Child, createNode } from "./jsx/node.ts"

export interface TextProps {
  /**
   * Markdown text; adjacent strings and `{expr}` join into one Text Display. JSX drops
   * newlines, so use one `<Text>` per markdown block or `<br />` for a line break.
   */
  children?: Child
}

/** A Text Display: one block of markdown. */
export function Text(props: TextProps): JSX.Element {
  return createNode("Text", { ...props })
}

export interface ContainerProps {
  /** Left border color, as `0xRRGGBB`. */
  accentColor?: number
  /** Blur the whole container until clicked. */
  spoiler?: boolean
  children?: Child
}

/** A Container: groups components behind a colored border, like an embed. Cannot nest. */
export function Container(props: ContainerProps): JSX.Element {
  return createNode("Container", { ...props })
}
