// The bot's building blocks: a container per tone, so every message looks alike.
//
//   <ui.Success title="Saved"><Text>Announcements will appear in {channel}</Text></ui.Success>
//
// Each sets its accent color from the consts below, so replies, deferred edits and messages sent
// through REST (announcements, feedback, the install log) look the same. Handler errors use
// `renderError`, the App's Error Renderer, in the same style.
import { Container, type ContainerProps, GENERIC_ERROR_MESSAGE, Text, UserError } from "composurejs"

/** TypeScript's blue: tells this bot's messages from composure-rs's purple ones in the shared server. */
export const PRIMARY = 0x3178c6
/** Discord's grey, for neutral information. */
export const SECONDARY = 0x4e5058
/** Discord's green. */
export const SUCCESS = 0x57f287
/** Discord's yellow. */
export const WARNING = 0xfee75c
/** Discord's red. */
export const ERROR = 0xed4245

interface ToneProps {
  /** Shown as a `###` heading above the children. */
  title?: string | undefined
  children?: ContainerProps["children"]
}

const Panel = ({ accent, title, children }: ToneProps & { accent: number }) => (
  <Container accentColor={accent}>
    {title !== undefined && <Text>### {title}</Text>}
    {children}
  </Container>
)

/** The brand color: pages, cards, announcements. */
export const Primary = (props: ToneProps) => <Panel accent={PRIMARY} {...props} />
/** Neutral information: status, notices for maintainers. */
export const Secondary = (props: ToneProps) => <Panel accent={SECONDARY} {...props} />
/** Something worked. */
export const Success = (props: ToneProps) => <Panel accent={SUCCESS} {...props} />
/** Worked, with a catch. */
export const Warning = (props: ToneProps) => <Panel accent={WARNING} {...props} />
/** Something failed, said in the bot's words. */
export const Error = (props: ToneProps) => <Panel accent={ERROR} {...props} />

/** The App's Error Renderer: a User Error's message, else the generic one, in the error tone (always ephemeral). */
export const renderError = (error: unknown) => (
  <Error>
    <Text>{error instanceof UserError ? error.message : GENERIC_ERROR_MESSAGE}</Text>
  </Error>
)
