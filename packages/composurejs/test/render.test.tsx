import { describe, expect, test } from "vitest"
import { Container, RenderError, Text } from "composurejs"
import { renderMessage } from "../src/jsx/render.ts"

describe("render", () => {
  test("adjacent text and expressions join into one Text Display", async () => {
    const name = "Alice"
    const count = 3
    expect((await renderMessage(<Text>Hi {name}, you have {count} cookies</Text>)).components).toEqual([
      { type: 10, content: "Hi Alice, you have 3 cookies" },
    ])
  })

  test("JSX drops newlines; <br /> puts them back", async () => {
    const view = (
      <Text>
        - one
        <br />- two
      </Text>
    )
    expect((await renderMessage(view)).components).toEqual([{ type: 10, content: "- one\n- two" }])
  })

  test("null, false, undefined render nothing; arrays, fragments and async Views flatten", async () => {
    const Async = async ({ n }: { n: number }) => <Text>async {n}</Text>
    const view = (
      <Container>
        {null}
        {false}
        {undefined}
        {["a", "b"].map((x) => (
          <Text>{x}</Text>
        ))}
        <>
          <Text>frag</Text>
        </>
        <Async n={1} />
      </Container>
    )
    const [container] = (await renderMessage(view)).components as unknown as [{ components: unknown[] }]
    expect(container.components).toEqual([
      { type: 10, content: "a" },
      { type: 10, content: "b" },
      { type: 10, content: "frag" },
      { type: 10, content: "async 1" },
    ])
  })

  test("Container props map to Discord's names", async () => {
    expect((await renderMessage(<Container accentColor={0xff0000} spoiler><Text>x</Text></Container>)).components).toEqual([
      { type: 17, accent_color: 0xff0000, spoiler: true, components: [{ type: 10, content: "x" }] },
    ])
  })

  test("placement errors name parent and child", async () => {
    await expect(renderMessage(<Container><Container><Text>x</Text></Container></Container>)).rejects.toThrow(
      new RenderError("<Container> cannot go inside <Container>"),
    )
    await expect(renderMessage(<Text><Container /></Text>)).rejects.toThrow("<Container> cannot go inside <Text>")
  })

  test("Limits are checked before Discord sees the message", async () => {
    await expect(renderMessage(<Text>{"x".repeat(4001)}</Text>)).rejects.toThrow("at most 4000 characters of text")
    const many = Array.from({ length: 41 }, (_, i) => <Text>{i}</Text>)
    await expect(renderMessage(<>{many}</>)).rejects.toThrow("at most 40 components")
    await expect(renderMessage(<>{null}</>)).rejects.toThrow("renders no components")
  })
})
