// `/feedback`: a modal whose submission is posted to the maintainers' channel, answered with a link
// that opens the same report as a prefilled GitHub issue (no GitHub write access needed).
import { Button, defineChoices, Label, Modal, type ModalContext, RadioGroup, Row, Text, TextInput } from "composurejs"
import { createMessage } from "composurejs/rest"
import { type BotEnv, command, EVERYWHERE, repoUrl } from "./env.ts"
import * as ui from "./ui.tsx"

/** Discord's limit on a button's URL. */
const URL_LIMIT = 512

const Kinds = defineChoices({ bug: "Bug", feature: "Feature request", question: "Question" })
type Kind = keyof typeof KIND_TONES

/** Bugs stand out in the maintainers' channel. */
const KIND_TONES = { bug: ui.Error, feature: ui.Primary, question: ui.Secondary }
const KIND_NAMES: Record<Kind, string> = { bug: "Bug", feature: "Feature request", question: "Question" }

interface Submitted {
  kind: Kind
  title: string
  details: string
}

export const FeedbackForm = () => (
  <Modal title="Feedback on composurejs" onSubmit={(c, values: Submitted) => send(c, values)}>
    <Label text="Kind">
      <RadioGroup name="kind" options={Kinds} />
    </Label>
    <Label text="Title">
      <TextInput name="title" maxLength={100} placeholder="One line about it" />
    </Label>
    <Label text="Details" description="Steps, versions, what you expected">
      <TextInput name="details" paragraph maxLength={1500} />
    </Label>
  </Modal>
)

async function send(c: ModalContext<BotEnv>, { kind, title, details }: Submitted) {
  const { config } = c.data
  const heading = `[${KIND_NAMES[kind]}] ${title}`
  const Tone = KIND_TONES[kind] ?? ui.Secondary
  const from = `-# From <@${c.user.id}> (${c.user.username})${c.guildId ? ` in server \`${c.guildId}\`` : ""}`
  await createMessage(
    c.bot,
    config.feedbackChannel,
    <Tone title={heading}>
      <Text>{details}</Text>
      <Text>{from}</Text>
    </Tone>,
  )
  return c.ephemeral(
    <ui.Success title="Thanks!">
      <Text>The maintainers got your feedback.</Text>
      <Text>-# To follow it on GitHub, open it as an issue (prefilled; long details are shortened):</Text>
      <Row>
        <Button url={issueUrl(repoUrl(config), heading, details)}>Open as GitHub issue</Button>
      </Row>
    </ui.Success>,
  )
}

/** A new-issue link with `title` and as much of `body` as fits Discord's URL limit. */
export function issueUrl(repo: string, title: string, body: string): string {
  const url = `${repo}/issues/new?title=${encode(title)}&body=`
  // Room for an encoded "…" when cut
  const budget = URL_LIMIT - url.length - 9
  let encoded = ""
  for (const char of body) {
    const piece = encode(char)
    if (encoded.length + piece.length > budget) return `${url}${encoded}%E2%80%A6`
    encoded += piece
  }
  return url + encoded
}

/** Percent-encodes everything but unreserved characters. */
const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export const feedback = command({
  name: "feedback",
  description: "Send feedback to composurejs's maintainers",
  ...EVERYWHERE,
  // A modal cannot open after an Auto Defer; this answers at once anyway
  autoDefer: false,
  handler: () => <FeedbackForm />,
})
