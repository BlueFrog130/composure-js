// The one validation walk (ADR 0004): flattens the tree, checks placement and Discord's Limits,
// collects Uploads, and emits component JSON. Every error names the rule and the tags involved.
import type { APIMessageTopLevelComponent, APIModalInteractionResponseCallbackData } from "discord-api-types/v10";
import { type AllowedMentions, type Emoji, isUpload, type Upload } from "../components.ts";
import { MessageFlags } from "../discord.ts";
import { prefixOf, withRoute } from "../codec.ts";
import { localRef, uncompiledHandler } from "../handlers.ts";
import { RenderError } from "../errors.ts";
import type { Choices } from "../options.ts";
import { INPUTS, SELECTS } from "../placement.ts";
import { type Child, type ElementNode, isNode } from "./node.ts";

/** Discord's limits, checked before it sees a message. */
export const LIMITS = {
  components: 40,
  textLength: 4000,
  rowButtons: 5,
  selectOptions: 25,
  groupOptions: 10,
  customId: 100,
  buttonLabel: 80,
  url: 512,
  optionText: 100,
  placeholder: 150,
  sectionTexts: 3,
  galleryItems: 10,
  mediaDescription: 1024,
  files: 10,
  modalTitle: 45,
  modalComponents: 5,
  labelText: 45,
  labelDescription: 100,
  inputPlaceholder: 100,
  inputLength: 4000,
} as const;

export interface MessageData {
  flags: number;
  components: APIMessageTopLevelComponent[];
  allowed_mentions?: Record<string, unknown>;
}

export type ModalData = APIModalInteractionResponseCallbackData;

export interface RenderedMessage {
  kind: "message";
  data: MessageData;
  /** Files to send with the message, in attachment order. */
  files: Upload[];
}

export interface RenderedModal {
  kind: "modal";
  data: ModalData;
}

export type Rendered = RenderedMessage | RenderedModal;

type Json = Record<string, unknown>;
type Flat = ElementNode | string;

const UPLOAD_NAME = /^[\w.-]+$/;

const tag = (name: string) => `<${name}>`;

/** A `custom_id` for an error message: its routing prefix only, since errors are logged and the rest is Custom ID State. */
const idOf = (customId: string) => {
  const [prefix, rest] = prefixOf(customId);
  return `"${prefix}${rest === undefined ? "" : ":…"}"`;
};

/** Where a Form (forms.ts) keeps its renderer: looked up, not imported, so bots without Forms do not bundle them. */
const FORM = Symbol.for("composurejs.form");

class Walk {
  components = 0;
  textLength = 0;
  readonly customIds = new Map<string, string>();
  readonly files = new Map<string, Upload>();
  /** Rendering a Form's Labels, whose input names carry how they decode. */
  inForm = false;
  constructor(
    readonly modal: boolean,
    /** The Owning Route handlers rendered here are marked with. */
    readonly route: string | undefined,
  ) {}

  /** Counts a component toward the 40. */
  add<T extends Json>(json: T): T {
    this.components++;
    return json;
  }

  customId(value: unknown, owner: string, register = true): string {
    if (typeof value !== "string" || value === "") throw new RenderError(`${tag(owner)} needs a customId`);
    if (value.length > LIMITS.customId) {
      throw new RenderError(
        `${tag(owner)} custom_id is ${value.length} characters; the limit is ${LIMITS.customId}. Carry an id and load the rest instead (custom_id ${idOf(value)})`,
      );
    }
    const first = this.customIds.get(value);
    if (first) throw new RenderError(`custom_id ${idOf(value)} is used twice in one ${this.modal ? "modal" : "message"} (${tag(first)} and ${tag(owner)})`);
    if (register) this.customIds.set(value, owner);
    return value;
  }

  /** A media URL; Uploads are attached and referenced as `attachment://<name>`. */
  media(src: unknown, owner: string): string {
    if (isUpload(src)) {
      if (!UPLOAD_NAME.test(src.name)) throw new RenderError(`Upload name "${src.name}" in ${tag(owner)} may only use letters, digits, "_", "-" and "."`);
      const existing = this.files.get(src.name);
      if (existing && existing !== src) throw new RenderError(`Two different Uploads are named "${src.name}"`);
      this.files.set(src.name, src);
      return `attachment://${src.name}`;
    }
    if (typeof src !== "string" || src === "") throw new RenderError(`${tag(owner)} needs a src`);
    return src;
  }
}

export interface RenderOptions {
  /** The Owning Route (ADR 0026): its key is added to the `custom_id` of every handler rendered. */
  route?: string | undefined;
}

/** Renders a View: a Components V2 message, or a modal when its root is `<Modal>`. */
export async function render(view: Child, options: RenderOptions = {}): Promise<Rendered> {
  const roots = await flatten(view);
  const only = roots.length === 1 ? roots[0] : undefined;
  if (typeof only === "object" && only.tag === "Modal") {
    return { kind: "modal", data: await renderModal(only, options.route) };
  }

  const walk = new Walk(false, options.route);
  const message = typeof only === "object" && only.tag === "Message" ? only : undefined;
  const children = message ? await flatten(message.props.children as Child) : roots;
  const components = (await renderBlocks(children, undefined, walk)) as unknown as APIMessageTopLevelComponent[];
  if (components.length === 0) throw new RenderError("The View renders no components");
  if (walk.components > LIMITS.components) throw new RenderError(`A message can hold at most ${LIMITS.components} components, this View has ${walk.components}`);
  if (walk.textLength > LIMITS.textLength) throw new RenderError(`A message can hold at most ${LIMITS.textLength} characters of text, this View has ${walk.textLength}`);
  if (walk.files.size > LIMITS.files) throw new RenderError(`A message can carry at most ${LIMITS.files} files, this View has ${walk.files.size}`);

  const props = (message?.props ?? {}) as { ephemeral?: boolean; suppressNotifications?: boolean; allowedMentions?: AllowedMentions };
  let flags: number = MessageFlags.IsComponentsV2;
  if (props.ephemeral) flags |= MessageFlags.Ephemeral;
  if (props.suppressNotifications) flags |= MessageFlags.SuppressNotifications;
  const data: MessageData = { flags, components };
  if (props.allowedMentions) data.allowed_mentions = allowedMentions(props.allowedMentions);
  return { kind: "message", data, files: [...walk.files.values()] };
}

/** Renders a View that must be a message. */
export async function renderMessage(view: Child, options: RenderOptions = {}): Promise<RenderedMessage> {
  const rendered = await render(view, options);
  if (rendered.kind !== "message") throw new RenderError("A <Modal> cannot be sent as a message");
  return rendered;
}

async function flatten(child: Child, out: Flat[] = []): Promise<Flat[]> {
  if (child === null || child === undefined || typeof child === "boolean") return out;
  if (typeof child === "string") out.push(child);
  else if (typeof child === "number" || typeof child === "bigint") out.push(String(child));
  else if (child instanceof Promise) await flatten((await (child as Promise<unknown>)) as Child, out);
  else if (isNode(child)) {
    if (child.tag === "Fragment") await flatten(child.props.children as Child, out);
    else out.push(child);
  } else for (const c of child) await flatten(c, out);
  return out;
}

const childrenOf = (node: ElementNode) => flatten(node.props.children as Child);

function misplaced(child: Flat, parent: string | undefined): RenderError {
  const what = typeof child === "string" ? "text" : tag(child.tag);
  if (typeof child !== "string" && (child.tag === "Message" || child.tag === "Modal")) {
    return new RenderError(`${what} can only be the root of a View`);
  }
  return new RenderError(`${what} cannot go ${parent ? `inside ${tag(parent)}` : "at the top of a message"}`);
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new RenderError(message);
}

function checkText(owner: string, field: string, value: string | undefined, max: number, min = 0): void {
  if (value === undefined) return;
  check(value.length >= min, `${tag(owner)} ${field} must not be empty`);
  check(value.length <= max, `${tag(owner)} ${field} is ${value.length} characters; the limit is ${max}`);
}

/** Joins text children (strings and `<br />`), rejecting any other tag. */
async function textOf(node: ElementNode, field = "children"): Promise<string> {
  let out = "";
  for (const child of await flatten(node.props[field] as Child)) {
    if (typeof child === "string") out += child;
    else if (child.tag === "br") out += "\n";
    else throw misplaced(child, node.tag);
  }
  return out;
}

/** Bare text and `<br />` between blocks join into one Text Display. */
async function renderBlocks(children: Flat[], parent: "Container" | undefined, walk: Walk): Promise<Json[]> {
  const out: Json[] = [];
  let text: string | undefined;
  const flush = () => {
    if (text !== undefined && text.trim() !== "") out.push(textDisplay(text, walk));
    text = undefined;
  };
  for (const child of children) {
    if (typeof child === "string" || child.tag === "br") {
      text = (text ?? "") + (typeof child === "string" ? child : "\n");
      continue;
    }
    flush();
    switch (child.tag) {
      case "Text":
        out.push(await renderText(child, walk));
        break;
      case "Container":
        if (parent === "Container") throw misplaced(child, parent);
        out.push(await renderContainer(child, walk));
        break;
      case "Section":
        out.push(await renderSection(child, walk));
        break;
      case "Row":
        out.push(await renderRow(child, walk));
        break;
      case "Gallery":
        out.push(await renderGallery(child, walk));
        break;
      case "Separator":
        out.push(renderSeparator(child, walk));
        break;
      case "File":
        out.push(renderFile(child, walk));
        break;
      default:
        throw misplaced(child, parent);
    }
  }
  flush();
  return out;
}

function textDisplay(content: string, walk: Walk, id?: unknown): Json {
  walk.textLength += content.length;
  return walk.add({ type: 10, ...withId(id), content });
}

async function renderText(node: ElementNode, walk: Walk): Promise<Json> {
  const content = typeof node.props.content === "string" ? node.props.content : await textOf(node);
  check(content.trim() !== "", "<Text> is empty; Discord rejects empty text");
  return textDisplay(content, walk, node.props.id);
}

const withId = (id: unknown) => (typeof id === "number" ? { id } : {});

async function renderContainer(node: ElementNode, walk: Walk): Promise<Json> {
  const { accentColor, spoiler, id } = node.props as { accentColor?: number; spoiler?: boolean; id?: number };
  const json = walk.add({ type: 17, ...withId(id) } as Json);
  json.components = await renderBlocks(await childrenOf(node), "Container", walk);
  check((json.components as Json[]).length > 0, "<Container> is empty");
  if (accentColor !== undefined) json.accent_color = accentColor;
  if (spoiler !== undefined) json.spoiler = spoiler;
  return json;
}

async function renderSection(node: ElementNode, walk: Walk): Promise<Json> {
  const json = walk.add({ type: 9, ...withId(node.props.id) } as Json);
  const texts: Json[] = [];
  let text: string | undefined;
  const flush = () => {
    if (text !== undefined && text.trim() !== "") texts.push(textDisplay(text, walk));
    text = undefined;
  };
  for (const child of await childrenOf(node)) {
    if (typeof child === "string" || child.tag === "br") {
      text = (text ?? "") + (typeof child === "string" ? child : "\n");
      continue;
    }
    flush();
    if (child.tag === "Text") texts.push(await renderText(child, walk));
    else if (child.tag === "Button" || child.tag === "Thumbnail") {
      throw new RenderError(`${tag(child.tag)} goes in <Section accessory={..}>, not inside <Section>`);
    } else throw misplaced(child, "Section");
  }
  flush();
  check(texts.length >= 1 && texts.length <= LIMITS.sectionTexts, `<Section> needs 1-${LIMITS.sectionTexts} blocks of text, it has ${texts.length}`);
  json.components = texts;

  const accessory = await flatten(node.props.accessory as Child);
  const [only] = accessory;
  check(accessory.length === 1 && typeof only === "object", "<Section> needs exactly one accessory: a <Button> or <Thumbnail>");
  const acc = only as ElementNode;
  if (acc.tag === "Button") json.accessory = await renderButton(acc, walk);
  else if (acc.tag === "Thumbnail") json.accessory = renderThumbnail(acc, walk);
  else throw new RenderError(`${tag(acc.tag)} cannot be a <Section> accessory; use a <Button> or <Thumbnail>`);
  return json;
}

async function renderRow(node: ElementNode, walk: Walk): Promise<Json> {
  const json = walk.add({ type: 1, ...withId(node.props.id) } as Json);
  const children = await childrenOf(node);
  const nodes: ElementNode[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      if (child.trim() === "") continue;
      throw misplaced(child, "Row");
    }
    if (child.tag !== "Button" && !SELECTS.includes(child.tag)) throw misplaced(child, "Row");
    nodes.push(child);
  }
  check(nodes.length > 0, "<Row> is empty");
  const selects = nodes.filter((n) => n.tag !== "Button");
  if (selects.length > 0) {
    check(nodes.length === 1, `A <Row> holds up to ${LIMITS.rowButtons} <Button>s or one select, not ${nodes.map((n) => tag(n.tag)).join(" + ")}`);
    json.components = [await renderSelect(selects[0]!, walk)];
  } else {
    check(nodes.length <= LIMITS.rowButtons, `A <Row> holds at most ${LIMITS.rowButtons} <Button>s, this one has ${nodes.length}`);
    // In order: the walk's counts and custom_id checks are shared state.
    const buttons: Json[] = [];
    for (const n of nodes) buttons.push(await renderButton(n, walk));
    json.components = buttons;
  }
  return json;
}

const BUTTON_STYLES = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;

async function renderButton(node: ElementNode, walk: Walk): Promise<Json> {
  const p = node.props as { style?: keyof typeof BUTTON_STYLES; customId?: string; url?: string; skuId?: string; label?: string; emoji?: Emoji; disabled?: boolean; id?: number };
  const label = p.label ?? ((await textOf(node)).trim() || undefined);
  const json = walk.add({ type: 2, ...withId(p.id) } as Json);
  if (p.skuId !== undefined) {
    check(label === undefined && p.emoji === undefined && p.customId === undefined && p.url === undefined, "A premium <Button> (skuId) has no label, emoji, customId or url");
    return Object.assign(json, { style: 6, sku_id: p.skuId }, p.disabled !== undefined && { disabled: p.disabled });
  }
  check(label !== undefined || p.emoji !== undefined, "<Button> needs a label or an emoji");
  checkText("Button", "label", label, LIMITS.buttonLabel);
  if (p.url !== undefined) {
    check(p.customId === undefined, "A link <Button> (url) cannot have a customId");
    check(p.style === undefined, "A link <Button> (url) takes no style");
    checkText("Button", "url", p.url, LIMITS.url, 1);
    Object.assign(json, { style: 5, url: p.url });
  } else {
    Object.assign(json, { style: BUTTON_STYLES[p.style ?? "secondary"], custom_id: walk.customId(handlerId(node, "onClick", walk), "Button") });
  }
  if (label !== undefined) json.label = label;
  if (p.emoji !== undefined) json.emoji = emoji(p.emoji);
  if (p.disabled !== undefined) json.disabled = p.disabled;
  return json;
}

function emoji(value: Emoji): Json {
  if (typeof value !== "string") return { ...value };
  const custom = /^<(a?):([\w~]+):(\d+)>$/.exec(value);
  return custom ? { id: custom[3], name: custom[2], ...(custom[1] && { animated: true }) } : { name: value };
}

const SELECT_TYPES: Record<string, number> = { StringSelect: 3, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 };
const DEFAULT_TYPE: Record<string, string> = { UserSelect: "user", RoleSelect: "role", ChannelSelect: "channel" };

async function renderSelect(node: ElementNode, walk: Walk): Promise<Json> {
  const p = node.props as {
    customId?: string;
    placeholder?: string;
    minValues?: number;
    maxValues?: number;
    disabled?: boolean;
    required?: boolean;
    defaultValues?: (string | { id: string; type: string })[];
    channelTypes?: number[];
    id?: number;
  };
  const json = walk.add({
    type: SELECT_TYPES[node.tag],
    ...withId(p.id),
    custom_id: walk.customId(walk.modal ? inputName(node, walk) : handlerId(node, "onSelect", walk), node.tag),
  } as Json);
  if (!walk.modal) check(node.props.name === undefined, `${tag(node.tag)} name only applies in a <Modal>; in a message use onSelect`);
  checkText(node.tag, "placeholder", p.placeholder, LIMITS.placeholder);
  if (p.placeholder !== undefined) json.placeholder = p.placeholder;
  if (walk.modal) check(p.disabled === undefined, `${tag(node.tag)} disabled only applies in messages`);
  else check(p.required === undefined, `${tag(node.tag)} required only applies in modals`);
  if (p.disabled !== undefined) json.disabled = p.disabled;
  if (p.required !== undefined) json.required = p.required;

  let count: number = LIMITS.selectOptions;
  if (node.tag === "StringSelect") {
    const options = await renderOptions(node, walk, LIMITS.selectOptions, true);
    json.options = options;
    count = options.length;
  } else {
    if (p.defaultValues) {
      json.default_values = p.defaultValues.map((v) => (typeof v === "string" ? { id: v, type: DEFAULT_TYPE[node.tag] } : v));
    }
    if (p.channelTypes) json.channel_types = p.channelTypes;
  }
  minMax(node.tag, json, p.minValues, p.maxValues, 0, Math.min(count, LIMITS.selectOptions));
  return json;
}

function minMax(owner: string, json: Json, min: number | undefined, max: number | undefined, floor: number, ceiling: number): void {
  if (min !== undefined) {
    check(Number.isInteger(min) && min >= floor && min <= ceiling, `${tag(owner)} minValues must be ${floor}-${ceiling}`);
    json.min_values = min;
  }
  if (max !== undefined) {
    check(Number.isInteger(max) && max >= 1 && max <= ceiling, `${tag(owner)} maxValues must be 1-${ceiling}`);
    json.max_values = max;
  }
  if (min !== undefined && max !== undefined) check(min <= max, `${tag(owner)} minValues is greater than maxValues`);
}

/** `options={choices}` first, then `<Option>` children. */
async function renderOptions(node: ElementNode, walk: Walk, max: number, withEmoji: boolean): Promise<Json[]> {
  const out: Json[] = ((node.props.options as Choices<string> | undefined) ?? []).map(({ name, value }) => ({ label: name, value }));
  for (const child of await childrenOf(node)) {
    if (typeof child === "string") {
      if (child.trim() === "") continue;
      throw misplaced(child, node.tag);
    }
    if (child.tag !== "Option") throw misplaced(child, node.tag);
    const p = child.props as { value?: string; label?: string; description?: string; emoji?: Emoji; default?: boolean };
    const option: Json = { label: p.label ?? (await textOf(child)).trim(), value: p.value };
    if (p.description !== undefined) option.description = p.description;
    if (p.emoji !== undefined) {
      check(withEmoji, `<Option> emoji only applies in selects, not in ${tag(node.tag)}`);
      option.emoji = emoji(p.emoji);
    }
    if (p.default !== undefined) option.default = p.default;
    out.push(option);
  }
  check(out.length >= 1 && out.length <= max, `${tag(node.tag)} needs 1-${max} options, it has ${out.length}`);
  const values = new Set<unknown>();
  for (const o of out) {
    check(typeof o.value === "string", `<Option> in ${tag(node.tag)} needs a value`);
    checkText("Option", "value", o.value as string, LIMITS.optionText, 1);
    checkText("Option", "label", o.label as string, LIMITS.optionText, 1);
    checkText("Option", "description", o.description as string | undefined, LIMITS.optionText);
    check(!values.has(o.value), `${tag(node.tag)} has two options with value "${String(o.value)}"`);
    values.add(o.value);
  }
  return out;
}

function renderThumbnail(node: ElementNode, walk: Walk): Json {
  const p = node.props as { src?: unknown; description?: string; spoiler?: boolean; id?: number };
  checkText("Thumbnail", "description", p.description, LIMITS.mediaDescription);
  return walk.add({
    type: 11,
    ...withId(p.id),
    media: { url: walk.media(p.src, "Thumbnail") },
    ...(p.description !== undefined && { description: p.description }),
    ...(p.spoiler !== undefined && { spoiler: p.spoiler }),
  });
}

async function renderGallery(node: ElementNode, walk: Walk): Promise<Json> {
  const items: Json[] = [];
  for (const child of await childrenOf(node)) {
    if (typeof child === "string" && child.trim() === "") continue;
    if (typeof child === "string" || child.tag !== "Item") throw misplaced(child, "Gallery");
    const p = child.props as { src?: unknown; description?: string; spoiler?: boolean };
    checkText("Item", "description", p.description, LIMITS.mediaDescription);
    items.push({
      media: { url: walk.media(p.src, "Item") },
      ...(p.description !== undefined && { description: p.description }),
      ...(p.spoiler !== undefined && { spoiler: p.spoiler }),
    });
  }
  check(items.length >= 1 && items.length <= LIMITS.galleryItems, `<Gallery> needs 1-${LIMITS.galleryItems} <Item>s, it has ${items.length}`);
  return walk.add({ type: 12, ...withId(node.props.id), items });
}

function renderSeparator(node: ElementNode, walk: Walk): Json {
  const { divider, spacing, id } = node.props as { divider?: boolean; spacing?: "small" | "large"; id?: number };
  return walk.add({
    type: 14,
    ...withId(id),
    ...(divider !== undefined && { divider }),
    ...(spacing !== undefined && { spacing: spacing === "large" ? 2 : 1 }),
  });
}

function renderFile(node: ElementNode, walk: Walk): Json {
  const { src, spoiler, id } = node.props as { src?: unknown; spoiler?: boolean; id?: number };
  check(isUpload(src) || (typeof src === "string" && src.startsWith("attachment://")), "<File> src must be an Upload or attachment://<name>");
  return walk.add({ type: 13, ...withId(id), file: { url: walk.media(src, "File") }, ...(spoiler !== undefined && { spoiler }) });
}

function allowedMentions(a: AllowedMentions): Json {
  return {
    parse: a.parse ?? [],
    ...(a.users && { users: a.users }),
    ...(a.roles && { roles: a.roles }),
    ...(a.repliedUser !== undefined && { replied_user: a.repliedUser }),
  };
}

// ---- Modals --------------------------------------------------------------------------------

async function renderModal(node: ElementNode, route: string | undefined): Promise<ModalData> {
  const walk = new Walk(true, route);
  const p = node.props as { title?: string; customId?: string; form?: unknown; values?: unknown };
  check(typeof p.title === "string", "<Modal> needs a title");
  const form = (p.form as Record<symbol, unknown> | undefined)?.[FORM] as ((values: Record<string, unknown>) => ElementNode[]) | undefined;
  check(p.form === undefined || typeof form === "function", "<Modal> form must be made with form({ .. })");
  check(p.values === undefined || p.form !== undefined, "<Modal> values prefill a form; there is no form");
  checkText("Modal", "title", p.title, LIMITS.modalTitle, 1);
  const customId = walk.customId(handlerId(node, "onSubmit", walk), "Modal", false);

  const components: Json[] = [];
  let text: string | undefined;
  const flush = () => {
    if (text !== undefined && text.trim() !== "") components.push(textDisplay(text, walk));
    text = undefined;
  };
  for (const child of await childrenOf(node)) {
    if (typeof child === "string" || child.tag === "br") {
      text = (text ?? "") + (typeof child === "string" ? child : "\n");
      continue;
    }
    flush();
    if (child.tag === "Text") components.push(await renderText(child, walk));
    else if (child.tag === "Label" && form) throw new RenderError("<Label> cannot go next to <Modal form={..}>: add it to the Form as a Field");
    else if (child.tag === "Label") components.push(await renderLabel(child, walk));
    else if (INPUTS.includes(child.tag)) throw new RenderError(`${tag(child.tag)} goes inside a <Label> in a <Modal>`);
    else throw misplaced(child, "Modal");
  }
  flush();
  if (form) {
    walk.inForm = true;
    for (const label of form((p.values ?? {}) as Record<string, unknown>)) components.push(await renderLabel(label, walk));
  }
  check(components.length >= 1 && components.length <= LIMITS.modalComponents, `A <Modal> holds 1-${LIMITS.modalComponents} <Label>s and <Text>s, it has ${components.length}`);
  return { custom_id: customId, title: p.title!, components } as unknown as ModalData;
}

async function renderLabel(node: ElementNode, walk: Walk): Promise<Json> {
  const p = node.props as { text?: string; description?: string; id?: number };
  check(typeof p.text === "string", "<Label> needs text");
  checkText("Label", "text", p.text, LIMITS.labelText, 1);
  checkText("Label", "description", p.description, LIMITS.labelDescription);
  const inputs: ElementNode[] = [];
  for (const child of await childrenOf(node)) {
    if (typeof child === "string") {
      if (child.trim() === "") continue;
      throw new RenderError("text cannot go inside <Label>; use its text and description props");
    }
    if (!INPUTS.includes(child.tag)) throw misplaced(child, "Label");
    inputs.push(child);
  }
  check(inputs.length === 1, `<Label> holds exactly one input, "${p.text}" has ${inputs.length}`);
  return walk.add({
    type: 18,
    ...withId(p.id),
    label: p.text,
    ...(p.description !== undefined && { description: p.description }),
    component: await renderInput(inputs[0]!, walk),
  });
}

async function renderInput(node: ElementNode, walk: Walk): Promise<Json> {
  if (SELECTS.includes(node.tag)) return renderSelect(node, walk);
  const p = node.props as Record<string, unknown> & { required?: boolean; id?: number };
  const json = walk.add({ ...withId(p.id), custom_id: walk.customId(inputName(node, walk), node.tag) } as Json);
  if (p.required !== undefined) json.required = p.required;
  switch (node.tag) {
    case "TextInput": {
      const { paragraph, minLength, maxLength, placeholder, value } = p as { paragraph?: boolean; minLength?: number; maxLength?: number; placeholder?: string; value?: string };
      Object.assign(json, { type: 4, style: paragraph ? 2 : 1 });
      if (minLength !== undefined) {
        check(minLength >= 0 && minLength <= LIMITS.inputLength, `<TextInput> minLength must be 0-${LIMITS.inputLength}`);
        json.min_length = minLength;
      }
      if (maxLength !== undefined) {
        check(maxLength >= 1 && maxLength <= LIMITS.inputLength, `<TextInput> maxLength must be 1-${LIMITS.inputLength}`);
        json.max_length = maxLength;
      }
      if (minLength !== undefined && maxLength !== undefined) check(minLength <= maxLength, "<TextInput> minLength is greater than maxLength");
      checkText("TextInput", "placeholder", placeholder, LIMITS.inputPlaceholder);
      checkText("TextInput", "value", value, maxLength ?? LIMITS.inputLength);
      if (placeholder !== undefined) json.placeholder = placeholder;
      if (value !== undefined) json.value = value;
      return json;
    }
    case "RadioGroup":
      return Object.assign(json, { type: 21, options: await renderOptions(node, walk, LIMITS.groupOptions, false) });
    case "CheckboxGroup": {
      const options = await renderOptions(node, walk, LIMITS.groupOptions, false);
      Object.assign(json, { type: 22, options });
      minMax("CheckboxGroup", json, p.minValues as number | undefined, p.maxValues as number | undefined, 0, options.length);
      return json;
    }
    case "Checkbox":
      check(p.required === undefined, "<Checkbox> is never required");
      return Object.assign(json, { type: 23 }, p.default !== undefined && { default: p.default });
    case "FileUpload": {
      Object.assign(json, { type: 19 });
      minMax("FileUpload", json, p.minValues as number | undefined, p.maxValues as number | undefined, 0, 10);
      if (p.fileTypes !== undefined) json.file_types = p.fileTypes;
      return json;
    }
  }
  throw misplaced(node, "Label");
}

/** `customId`, or the handler prop that stands for it (`onClick`, `onSelect`, `onSubmit`), marked with the Owning Route. */
function handlerId(node: ElementNode, prop: string, walk: Walk): unknown {
  const { customId } = node.props;
  let handler = node.props[prop];
  if (typeof handler === "function") {
    handler = localRef(handler);
    if (handler === undefined) throw uncompiledHandler(`<${node.tag} ${prop}>`);
  }
  if (customId !== undefined && handler !== undefined) throw new RenderError(`${tag(node.tag)} takes customId or ${prop}, not both`);
  return typeof handler === "string" ? withRoute(handler, walk.route) : customId;
}

/** A modal input's `name`: its `custom_id`, and its key in the submit handler's values. */
function inputName(node: ElementNode, walk: Walk): string {
  const { name } = node.props;
  check(typeof name === "string" && name !== "", `${tag(node.tag)} in a <Modal> needs a name, its key in onSubmit's values`);
  // "~" marks how a Form Field decodes (ADR 0028).
  check(walk.inForm || !(name as string).includes("~"), `${tag(node.tag)} name "${name as string}" cannot contain "~"`);
  return name as string;
}
