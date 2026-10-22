import { checkPlacement } from "composurejs/placement"
import type { Plugin } from "vite"
import { describe, expect, test } from "vitest"
import composure from "../src/index.ts"
import { parseModule } from "../src/transform.ts"

const IMPORT = 'import { Button, Container, Gallery, Item, Message, Modal, Row, Section, Text, TextInput, Thumbnail } from "composurejs"\n'

/** Each problem as `message @ the source it points at`. */
const check = (body: string, header = IMPORT) => {
  const code = header + body
  return checkPlacement(parseModule(code, "/bot/src/view.tsx")!).map((p) => `${p.message} @ ${code.slice(p.node.start, p.node.end)}`)
}

describe("checkPlacement", () => {
  test("a tag directly inside a parent that cannot hold it", () => {
    expect(check(`const v = <Container><Button customId="a">A</Button></Container>`)).toEqual(['<Button> cannot go inside <Container> @ <Button customId="a">A</Button>'])
    expect(check(`const v = <Container><Container><Text>a</Text></Container></Container>`)).toEqual([
      "<Container> cannot go inside <Container> @ <Container><Text>a</Text></Container>",
    ])
  })

  test("text, <br /> and the rules' own hints", () => {
    expect(check(`const v = <Row>  click <br /></Row>`)).toEqual(["text cannot go inside <Row> @   click ", "<br> cannot go inside <Row> @ <br />"])
    expect(check(`const v = <Row>{"a"}{\` \`}{1}</Row>`)).toEqual(['text cannot go inside <Row> @ "a"', "text cannot go inside <Row> @ 1"])
    expect(check(`const v = <Section><Text>a</Text><Button customId="b">B</Button></Section>`)).toEqual([
      '<Button> goes in <Section accessory={..}>, not inside <Section> @ <Button customId="b">B</Button>',
    ])
    expect(check(`const v = <Modal title="t"><TextInput name="a" /></Modal>`)).toEqual(['<TextInput> goes inside a <Label> in a <Modal> @ <TextInput name="a" />'])
    expect(check(`const v = <Container><Message>a</Message></Container>`)).toEqual(["<Message> can only be the root of a View @ <Message>a</Message>"])
  })

  test("accessories", () => {
    expect(check(`const v = <Section accessory={<Text>x</Text>}>a</Section>`)).toEqual(["<Text> cannot be a <Section> accessory; use a <Button> or <Thumbnail> @ <Text>x</Text>"])
    expect(check(`const v = <Section accessory={c ? <Thumbnail src="s" /> : <Button customId="b">B</Button>}>a</Section>`)).toEqual([])
  })

  test("follows fragments, conditions, arrays and .map callbacks", () => {
    const body = `
      const v = (
        <Gallery>
          <><Item src="a" /><Text>1</Text></>
          {ok && <Text>2</Text>}
          {ok ? <Item src="b" /> : <Text>3</Text>}
          {[<Text>4</Text>]}
          {items.map((i) => <Text>{i}</Text>)}
          {items.map((i) => { return <Text>{i}</Text> })}
          {(<Text>5</Text>) as any}
        </Gallery>
      )`
    expect(check(body)).toHaveLength(7)
    expect(check(body).every((p) => p.startsWith("<Text> cannot go inside <Gallery> @ <Text>"))).toBe(true)
  })

  test("renamed and namespace imports count; other tags, components and variables do not", () => {
    expect(check(`const v = <C.Row><C.Text>a</C.Text></C.Row>`, 'import * as C from "composurejs"\n')).toEqual(["<Text> cannot go inside <Row> @ <C.Text>a</C.Text>"])
    expect(check(`const v = <R><T>a</T></R>`, 'import { Row as R } from "composurejs/components"\nimport { Text as T } from "composurejs"\n')).toEqual([
      "<Text> cannot go inside <Row> @ <T>a</T>",
    ])
    expect(check(`const v = <Row><Text>a</Text></Row>`, 'import { Row, Text } from "./my-components"\n')).toEqual([])
    expect(check(`const v = <Row><Text>a</Text></Row>`, 'import type { Row, Text } from "composurejs"\n')).toEqual([])
    expect(check(`const Card = () => <Text>a</Text>; const v = <Row><Card />{text}</Row>`)).toEqual([])
  })
})

describe("the plugin", () => {
  const transform = (plugin: Plugin, code: string) => {
    const warnings: { message: string; pos: number }[] = []
    const hook = plugin.transform as (this: unknown, code: string, id: string) => unknown
    hook.call(
      {
        warn: (w: { message: string; pos: number }) => warnings.push(w),
        error: (e: unknown) => {
          throw e
        },
      },
      code,
      "/bot/src/view.tsx",
    )
    return warnings
  }

  test("warns at the misplaced child, naming where it is", () => {
    const code = `${IMPORT}export const v = <Row><Text>a</Text></Row>`
    expect(transform(composure(), code)).toEqual([{ message: "/bot/src/view.tsx:2:23: <Text> cannot go inside <Row>", pos: code.indexOf("<Text>") }])
  })

  test("placement: false turns the check off", () => {
    expect(transform(composure({ placement: false }), `${IMPORT}export const v = <Row><Text>a</Text></Row>`)).toEqual([])
  })
})
