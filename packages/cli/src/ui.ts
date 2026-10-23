// What the CLI shows, behind one interface: @clack/prompts in a terminal, a recorder in tests.
import { cancel, confirm, intro, isCancel, log, note, outro, spinner } from "@clack/prompts"
import { styleText } from "node:util"
import type { PlanStyle } from "composurejs/sync"

export interface Ui {
  intro(title: string): void
  /** Runs `work` behind a spinner, ending it with `done(result)`, or with the error. */
  step<T>(message: string, work: () => Promise<T>, done: (result: T) => string): Promise<T>
  note(body: string, title: string): void
  warn(message: string): void
  /** The run succeeded. */
  outro(message: string): void
  /** The run failed or was cancelled. */
  fail(message: string): void
  /** Asks yes or no; undefined when there is no terminal to ask in. */
  confirm: ((message: string) => Promise<boolean>) | undefined
  style: PlanStyle
}

const COLORS = { create: "green", update: "yellow", delete: "red", target: "bold", dim: "dim" } as const

/** @clack/prompts, colored when the terminal supports it (styleText checks the stream and NO_COLOR). */
export function clackUi({ interactive }: { interactive: boolean }): Ui {
  return {
    intro: (title) => intro(styleText(["bgCyan", "black"], ` ${title} `)),
    async step(message, work, done) {
      const s = spinner()
      s.start(message)
      try {
        const result = await work()
        s.stop(done(result))
        return result
      } catch (error) {
        s.error(message)
        throw error
      }
    },
    note: (body, title) => note(body, title),
    warn: (message) => log.warn(message),
    outro: (message) => outro(message),
    fail: (message) => cancel(message),
    confirm: interactive
      ? async (message) => {
          const answer = await confirm({ message, initialValue: false })
          return !isCancel(answer) && answer
        }
      : undefined,
    style: (part, text) => styleText(COLORS[part], text),
  }
}

/** Records what would be shown, as plain lines (`intro: ..`, `step: ..`, `note(title): ..`, ...). */
export function recordingUi(answer?: boolean): Ui & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    intro: (title) => void lines.push(`intro: ${title}`),
    async step(message, work, done) {
      try {
        const result = await work()
        lines.push(`step: ${done(result)}`)
        return result
      } catch (error) {
        lines.push(`step failed: ${message}`)
        throw error
      }
    },
    note: (body, title) => void lines.push(`note(${title}):\n${body}`),
    warn: (message) => void lines.push(`warn: ${message}`),
    outro: (message) => void lines.push(`outro: ${message}`),
    fail: (message) => void lines.push(`fail: ${message}`),
    confirm: answer === undefined ? undefined : async (message) => (lines.push(`confirm: ${message} ${answer ? "yes" : "no"}`), answer),
    style: (_, text) => text,
  }
}
