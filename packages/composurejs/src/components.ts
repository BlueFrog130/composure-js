// Built-in tags (ADR 0004). Each props interface is the tag's reference: document every attribute.
// Placement and Discord's limits are checked by render, not by types.
import type { JSX } from "./jsx-runtime.ts"
import { type Child, createNode } from "./jsx/node.ts"
import type { ClickHandler, HandlerRef, SelectHandler, SubmitHandler } from "./handlers.ts"
import type { Choices } from "./options.ts"

const UPLOAD = Symbol.for("composurejs.upload")

/** A file sent with the message, created with {@link upload}. */
export interface Upload {
  readonly [UPLOAD]: true
  /** The attachment's filename; `attachment://<name>` refers to it. */
  readonly name: string
  readonly data: Blob | ArrayBuffer | Uint8Array | string
  readonly contentType: string | undefined
  /** Alt text. */
  readonly description: string | undefined
}

/**
 * A file to send with the message. Pass it as `src` to `<File>`, `<Thumbnail>` or `<Item>`, which
 * attach it and point at `attachment://<name>` themselves. Names may use letters, digits, `_`, `-`, `.`.
 */
export function upload(name: string, data: Upload["data"], options: { contentType?: string; description?: string } = {}): Upload {
  return { [UPLOAD]: true, name, data, contentType: options.contentType, description: options.description }
}

export function isUpload(value: unknown): value is Upload {
  return typeof value === "object" && value !== null && UPLOAD in value
}

/** `"👍"`, a custom emoji as `"<:name:id>"` / `"<a:name:id>"`, or its parts. */
export type Emoji = string | { id?: string; name?: string; animated?: boolean }

interface Base {
  /** Optional numeric identifier, unique within the message; Discord assigns one if unset. */
  id?: number
}

// ---- Message root --------------------------------------------------------------------------

export interface AllowedMentions {
  /** Kinds of mention parsed from the text. Default: whatever Discord defaults to (all). */
  parse?: ("users" | "roles" | "everyone")[]
  /** Users that may be pinged (max 100); not with `parse: ["users"]`. */
  users?: string[]
  /** Roles that may be pinged (max 100); not with `parse: ["roles"]`. */
  roles?: string[]
  /** Ping the author of the replied-to message. */
  repliedUser?: boolean
}

export interface MessageProps {
  /** Only the invoking user sees it. Decided on the first answer; edits cannot change it. */
  ephemeral?: boolean
  /** Who the message may ping; `{ parse: [] }` pings nobody. */
  allowedMentions?: AllowedMentions
  /** Sends without a push or desktop notification. */
  suppressNotifications?: boolean
  children?: Child
}

/** The whole message, when it needs message-level settings. Only at the root of a View. */
export function Message(props: MessageProps): JSX.Element {
  return createNode("Message", { ...props })
}

// ---- Layout --------------------------------------------------------------------------------

export interface ContainerProps extends Base {
  /** Left border color, as `0xRRGGBB`. */
  accentColor?: number
  /** Blur the whole container until clicked. */
  spoiler?: boolean
  /** Anything a message holds except another `<Container>`. */
  children?: Child
}

/** A Container: groups components behind a colored border, like an embed. Cannot nest. */
export function Container(props: ContainerProps): JSX.Element {
  return createNode("Container", { ...props })
}

export interface SectionProps extends Base {
  /** Required. A `<Button>` or `<Thumbnail>` shown beside the text. */
  accessory: JSX.Element
  /** 1-3 blocks of text: `<Text>` or bare text. */
  children?: Child
}

/** Text with an accessory (button or thumbnail) beside it. */
export function Section(props: SectionProps): JSX.Element {
  return createNode("Section", { ...props })
}

export interface TextProps extends Base {
  /** The markdown, instead of children. */
  content?: string
  /**
   * Markdown text; adjacent strings and `{expr}` join into one Text Display. JSX drops
   * newlines and indentation, so use one `<Text>` per markdown block, `<br />` for a line
   * break, or `` {md`..`} `` for raw multi-line markdown.
   */
  children?: Child
}

/** A Text Display: one block of markdown. */
export function Text(props: TextProps): JSX.Element {
  return createNode("Text", { ...props })
}

export interface SeparatorProps extends Base {
  /** Draw a line; `false` leaves only space. Default true. */
  divider?: boolean
  /** Default `"small"`. */
  spacing?: "small" | "large"
}

/** Vertical space, with or without a line. */
export function Separator(props: SeparatorProps): JSX.Element {
  return createNode("Separator", { ...props })
}

export interface RowProps extends Base {
  /** Up to 5 `<Button>`s, or one select. */
  children?: Child
}

/** An Action Row: a line of buttons, or one select. */
export function Row(props: RowProps): JSX.Element {
  return createNode("Row", { ...props })
}

// ---- Media ---------------------------------------------------------------------------------

/** An image or file: a URL, `attachment://<name>`, or an {@link Upload} sent with the message. */
export type Media = string | Upload

export interface ThumbnailProps extends Base {
  /** Required. The image. */
  src: Media
  /** Alt text; max 1024 characters. */
  description?: string
  spoiler?: boolean
}

/** A small image, as a `<Section>` accessory. */
export function Thumbnail(props: ThumbnailProps): JSX.Element {
  return createNode("Thumbnail", { ...props })
}

export interface GalleryProps extends Base {
  /** 1-10 `<Item>`s. */
  children?: Child
}

/** A Media Gallery: a grid of images and videos. */
export function Gallery(props: GalleryProps): JSX.Element {
  return createNode("Gallery", { ...props })
}

export interface ItemProps {
  /** Required. The image or video. */
  src: Media
  /** Alt text; max 1024 characters. */
  description?: string
  spoiler?: boolean
}

/** One image or video in a `<Gallery>`. */
export function Item(props: ItemProps): JSX.Element {
  return createNode("Item", { ...props })
}

export interface FileProps extends Base {
  /** Required. An {@link Upload}, or `attachment://<name>` of a file attached otherwise. */
  src: Upload | `attachment://${string}`
  spoiler?: boolean
}

/** A file attached to the message, shown as a download. */
export function File(props: FileProps): JSX.Element {
  return createNode("File", { ...props })
}

// ---- Interactive ---------------------------------------------------------------------------

export interface ButtonProps extends Base {
  /** Default `"secondary"` (grey). Link and premium buttons take their style from `url` / `skuId`. */
  style?: "primary" | "secondary" | "success" | "danger"
  /** Routes the click to whatever handles this `custom_id`; max 100 characters. */
  customId?: string
  /**
   * Answers the click: `onClick={(c) => <Counter count={count + 1} />}`. Returned markup updates the
   * clicked message; `c.reply(..)` / `c.ephemeral(..)` answer with a new one. Reads of the
   * component's props and locals travel in the `custom_id` (ADR 0015). Instead of `customId`.
   */
  onClick?: ClickHandler | HandlerRef
  /** A link button opening this URL (max 512 characters); no `customId`. */
  url?: string
  /** A premium button offering this SKU; no label, emoji or `customId`. */
  skuId?: string
  /** The label, instead of children; max 80 characters. */
  label?: string
  /** Shown before the label. */
  emoji?: Emoji
  disabled?: boolean
  /** The label as text. */
  children?: Child
}

/** A Button, in a `<Row>` or as a `<Section>` accessory. */
export function Button(props: ButtonProps): JSX.Element {
  return createNode("Button", { ...props })
}

interface SelectBase extends Base {
  /** Routes the selection to whatever handles this `custom_id`; max 100 characters. */
  customId?: string
  /** Answers the selection in a message: `onSelect={(c, values: Topping[]) => ..}`. Instead of `customId`. */
  onSelect?: SelectHandler | HandlerRef
  /** In a modal: the key of this select's values in `onSubmit`. */
  name?: string
  /** Shown while nothing is selected; max 150 characters. */
  placeholder?: string
  /** Fewest selections, 0-25. Default 1. */
  minValues?: number
  /** Most selections, 1-25. Default 1. */
  maxValues?: number
  /** Messages only. */
  disabled?: boolean
  /** Modals only. Default true. */
  required?: boolean
}

export interface StringSelectProps extends SelectBase {
  /** Options from shared Choices, before any `<Option>` children. */
  options?: Choices<string>
  /** `<Option>`s; 1-25 in all. */
  children?: Child
}

/** A select of fixed options. */
export function StringSelect(props: StringSelectProps): JSX.Element {
  return createNode("StringSelect", { ...props })
}

export interface OptionProps {
  /** Required. What is submitted when chosen; max 100 characters. */
  value: string
  /** The label, instead of children; max 100 characters. */
  label?: string
  /** A second line under the label; max 100 characters. */
  description?: string
  /** Selects only. */
  emoji?: Emoji
  /** Chosen initially. */
  default?: boolean
  children?: Child
}

/** One option of a `<StringSelect>`, `<RadioGroup>` or `<CheckboxGroup>`. */
export function Option(props: OptionProps): JSX.Element {
  return createNode("Option", { ...props })
}

export interface EntitySelectProps extends SelectBase {
  /** Ids preselected. */
  defaultValues?: string[]
}

/** A select of the server's users. */
export function UserSelect(props: EntitySelectProps): JSX.Element {
  return createNode("UserSelect", { ...props })
}

/** A select of the server's roles. */
export function RoleSelect(props: EntitySelectProps): JSX.Element {
  return createNode("RoleSelect", { ...props })
}

export interface MentionableSelectProps extends SelectBase {
  /** Preselected users and roles. */
  defaultValues?: { id: string; type: "user" | "role" }[]
}

/** A select of users and roles. */
export function MentionableSelect(props: MentionableSelectProps): JSX.Element {
  return createNode("MentionableSelect", { ...props })
}

export interface ChannelSelectProps extends EntitySelectProps {
  /** The kinds of channel offered (`ChannelType` numbers). */
  channelTypes?: number[]
}

/** A select of the server's channels. */
export function ChannelSelect(props: ChannelSelectProps): JSX.Element {
  return createNode("ChannelSelect", { ...props })
}

// ---- Modals --------------------------------------------------------------------------------

export interface ModalProps {
  /** Required. Shown at the top; max 45 characters. */
  title: string
  /** Routes the submit to whatever handles this `custom_id`; max 100 characters. */
  customId?: string
  /** Answers the submit: `onSubmit={(c, v: { reason: string }) => ..}`, values keyed by input `name`. Instead of `customId`. */
  onSubmit?: SubmitHandler | HandlerRef
  /** 1-5 `<Label>`s and `<Text>`s. */
  children?: Child
}

/** A modal form. Only at the root of a View; answering with it opens it. */
export function Modal(props: ModalProps): JSX.Element {
  return createNode("Modal", { ...props })
}

export interface LabelProps extends Base {
  /** Required. The field's title; max 45 characters. */
  text: string
  /** Under the title; max 100 characters. */
  description?: string
  /** Exactly one input. */
  children?: Child
}

/** A titled field in a `<Modal>`, around exactly one input. */
export function Label(props: LabelProps): JSX.Element {
  return createNode("Label", { ...props })
}

export interface TextInputProps extends Base {
  /** Required. The key of this input's value in `onSubmit` (and its `custom_id`). */
  name: string
  /** Multi-line. Default single-line. */
  paragraph?: boolean
  /** 0-4000. */
  minLength?: number
  /** 1-4000. */
  maxLength?: number
  /** Shown while empty; max 100 characters. */
  placeholder?: string
  /** Prefilled text; max 4000 characters. */
  value?: string
  /** Default true. */
  required?: boolean
}

/** A text field, in a `<Label>`. */
export function TextInput(props: TextInputProps): JSX.Element {
  return createNode("TextInput", { ...props })
}

export interface RadioGroupProps extends Base {
  /** Required. The key of this input's value in `onSubmit`. */
  name: string
  /** Options from shared Choices, before any `<Option>` children. */
  options?: Choices<string>
  /** Default true. */
  required?: boolean
  /** `<Option>`s. */
  children?: Child
}

/** Pick one of several options, in a `<Label>`. */
export function RadioGroup(props: RadioGroupProps): JSX.Element {
  return createNode("RadioGroup", { ...props })
}

export interface CheckboxGroupProps extends Base {
  /** Required. The key of this input's value in `onSubmit`. */
  name: string
  options?: Choices<string>
  /** 0-10. */
  minValues?: number
  /** 1-10. */
  maxValues?: number
  /** Default true. */
  required?: boolean
  children?: Child
}

/** Pick any of several options, in a `<Label>`. */
export function CheckboxGroup(props: CheckboxGroupProps): JSX.Element {
  return createNode("CheckboxGroup", { ...props })
}

export interface CheckboxProps extends Base {
  /** Required. The key of this input's value in `onSubmit`. */
  name: string
  /** Checked initially. */
  default?: boolean
}

/** One yes/no box, in a `<Label>`. Never required. */
export function Checkbox(props: CheckboxProps): JSX.Element {
  return createNode("Checkbox", { ...props })
}

export interface FileUploadProps extends Base {
  /** Required. The key of this input's value in `onSubmit`. */
  name: string
  /** 0-10. */
  minValues?: number
  /** 1-10. */
  maxValues?: number
  /** Up to 10 of `"image"`, `"video"`, `"audio"`, or extensions like `".pdf"`. */
  fileTypes?: string[]
  /** Default true. */
  required?: boolean
}

/** Upload files, in a `<Label>`. */
export function FileUpload(props: FileUploadProps): JSX.Element {
  return createNode("FileUpload", { ...props })
}

// ---- Text helpers --------------------------------------------------------------------------

/**
 * Raw multi-line markdown: keeps newlines, removes the indentation common to all lines and
 * blank first/last lines. `{md`..`}` inside `<Text>`, where JSX would collapse lines.
 */
export function md(strings: TemplateStringsArray, ...values: unknown[]): string {
  // Dedent the literal parts only, so interpolated values cannot change the indentation.
  const HOLE = "\u0000"
  const raw = strings.join(HOLE)
  const lines = raw.replace(/^[ \t]*\r?\n/, "").replace(/\r?\n[ \t]*$/, "").split(/\r?\n/)
  const indent = Math.min(...lines.filter((l) => l.trim() !== "").map((l) => l.match(/^[ \t]*/)![0].length))
  let i = 0
  return lines
    .map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
    .join("\n")
    .replaceAll(HOLE, () => String(values[i++]))
}
