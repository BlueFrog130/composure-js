// The one validation walk (ADR 0004): flattens the tree, checks placement and Limits, and
// emits Discord's component JSON.
import type { APIComponentInContainer, APIMessageTopLevelComponent } from "discord-api-types/v10"
import { ComponentType, MessageFlags } from "../discord.ts"
import { RenderError } from "../errors.ts"
import { type Child, type ElementNode, isNode } from "./node.ts"

export const LIMITS = {
  components: 40,
  textLength: 4000,
} as const

export interface RenderedMessage {
  flags: number
  components: APIMessageTopLevelComponent[]
}

interface Walk {
  components: number
  textLength: number
}

type Flat = ElementNode | string

/** Renders a View into a Components V2 message body. */
export async function renderMessage(view: Child): Promise<RenderedMessage> {
  const walk: Walk = { components: 0, textLength: 0 }
  const components = (await renderList(await flatten(view), undefined, walk)) as APIMessageTopLevelComponent[]
  if (components.length === 0) throw new RenderError("The View renders no components")
  if (walk.components > LIMITS.components) {
    throw new RenderError(`A message can hold at most ${LIMITS.components} components, this View has ${walk.components}`)
  }
  if (walk.textLength > LIMITS.textLength) {
    throw new RenderError(`A message can hold at most ${LIMITS.textLength} characters of text, this View has ${walk.textLength}`)
  }
  return { flags: MessageFlags.IsComponentsV2, components }
}

async function flatten(child: Child, out: Flat[] = []): Promise<Flat[]> {
  if (child === null || child === undefined || typeof child === "boolean") return out
  if (typeof child === "string") out.push(child)
  else if (typeof child === "number" || typeof child === "bigint") out.push(String(child))
  else if (child instanceof Promise) await flatten((await (child as Promise<unknown>)) as Child, out)
  else if (isNode(child)) {
    if (child.tag === "Fragment") await flatten(child.props.children as Child, out)
    else out.push(child)
  } else for (const c of child) await flatten(c, out)
  return out
}

const label = (tag: string) => `<${tag}>`

async function renderList(children: Flat[], parent: string | undefined, walk: Walk): Promise<APIComponentInContainer[] | APIMessageTopLevelComponent[]> {
  const out: (APIComponentInContainer | APIMessageTopLevelComponent)[] = []
  let text: string | undefined
  const flushText = () => {
    if (text !== undefined && text.trim() !== "") out.push(textDisplay(text, walk))
    text = undefined
  }

  for (const child of children) {
    // Bare text in a component list joins into one Text Display, as inside <Text>.
    if (typeof child === "string" || child.tag === "br") {
      text = (text ?? "") + (typeof child === "string" ? child : "\n")
      continue
    }
    flushText()
    switch (child.tag) {
      case "Text":
        out.push(textDisplay(await renderText(child), walk))
        break
      case "Container": {
        if (parent === "Container") throw new RenderError(`${label("Container")} cannot go inside ${label("Container")}`)
        walk.components++
        const { accentColor, spoiler } = child.props as { accentColor?: number; spoiler?: boolean }
        out.push({
          type: ComponentType.Container as 17,
          components: (await renderList(await flatten(child.props.children as Child), "Container", walk)) as APIComponentInContainer[],
          ...(accentColor !== undefined && { accent_color: accentColor }),
          ...(spoiler !== undefined && { spoiler }),
        })
        break
      }
      default:
        throw new RenderError(`${label(child.tag)} cannot go ${parent ? `inside ${label(parent)}` : "at the top of a message"}`)
    }
  }
  flushText()
  return out
}

function textDisplay(content: string, walk: Walk): APIComponentInContainer {
  walk.components++
  walk.textLength += content.length
  return { type: ComponentType.TextDisplay as 10, content }
}

async function renderText(node: ElementNode): Promise<string> {
  let out = ""
  for (const child of await flatten(node.props.children as Child)) {
    if (typeof child === "string") out += child
    else if (child.tag === "br") out += "\n"
    else throw new RenderError(`${label(child.tag)} cannot go inside ${label(node.tag)}`)
  }
  return out
}
