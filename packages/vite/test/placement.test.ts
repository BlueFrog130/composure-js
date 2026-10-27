import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type JSX, render } from "composurejs";
import { checkPlacement } from "composurejs/placement";
import type { Plugin } from "vite";
import { afterAll, describe, expect, test } from "vitest";
import composure from "../src/index.ts";
import { parseModule } from "../src/transform.ts";

const IMPORT = 'import { Button, Container, Gallery, Item, Message, Modal, Row, Section, Separator, Text, TextInput, Thumbnail } from "composurejs"\n';

/** Each problem as `message @ the source it points at`. */
const check = (body: string, header = IMPORT) => {
  const code = header + body;
  return checkPlacement(parseModule(code, "/bot/src/view.tsx")!).map((p) => `${p.message} @ ${code.slice(p.node.start, p.node.end)}`);
};

describe("checkPlacement", () => {
  test("a tag directly inside a parent that cannot hold it", () => {
    expect(check(`const v = <Container><Button customId="a">A</Button></Container>`)).toEqual(['<Button> cannot go inside <Container> @ <Button customId="a">A</Button>']);
    expect(check(`const v = <Container><Container><Text>a</Text></Container></Container>`)).toEqual([
      "<Container> cannot go inside <Container> @ <Container><Text>a</Text></Container>",
    ]);
  });

  test("text, <br /> and the rules' own hints", () => {
    expect(check(`const v = <Row>  click <br /></Row>`)).toEqual(["text cannot go inside <Row> @   click ", "<br> cannot go inside <Row> @ <br />"]);
    expect(check(`const v = <Row>{"a"}{\` \`}{1}</Row>`)).toEqual(['text cannot go inside <Row> @ "a"', "text cannot go inside <Row> @ 1"]);
    expect(check(`const v = <Section><Text>a</Text><Button customId="b">B</Button></Section>`)).toEqual([
      '<Button> goes in <Section accessory={..}>, not inside <Section> @ <Button customId="b">B</Button>',
    ]);
    expect(check(`const v = <Modal title="t"><TextInput name="a" /></Modal>`)).toEqual(['<TextInput> goes inside a <Label> in a <Modal> @ <TextInput name="a" />']);
    expect(check(`const v = <Container><Message>a</Message></Container>`)).toEqual(["<Message> can only be the root of a View @ <Message>a</Message>"]);
  });

  test("accessories", () => {
    expect(check(`const v = <Section accessory={<Text>x</Text>}>a</Section>`)).toEqual(["<Text> cannot be a <Section> accessory; use a <Button> or <Thumbnail> @ <Text>x</Text>"]);
    expect(check(`const v = <Section accessory={c ? <Thumbnail src="s" /> : <Button customId="b">B</Button>}>a</Section>`)).toEqual([]);
  });

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
      )`;
    expect(check(body)).toHaveLength(7);
    expect(check(body).every((p) => p.startsWith("<Text> cannot go inside <Gallery> @ <Text>"))).toBe(true);
  });

  test("renamed and namespace imports count; other tags, components and variables do not", () => {
    expect(check(`const v = <C.Row><C.Text>a</C.Text></C.Row>`, 'import * as C from "composurejs"\n')).toEqual(["<Text> cannot go inside <Row> @ <C.Text>a</C.Text>"]);
    expect(check(`const v = <R><T>a</T></R>`, 'import { Row as R } from "composurejs/components"\nimport { Text as T } from "composurejs"\n')).toEqual([
      "<Text> cannot go inside <Row> @ <T>a</T>",
    ]);
    expect(check(`const v = <Row><Text>a</Text></Row>`, 'import { Row, Text } from "./my-components"\n')).toEqual([]);
    expect(check(`const v = <Row><Text>a</Text></Row>`, 'import type { Row, Text } from "composurejs"\n')).toEqual([]);
    expect(check(`const v = <Row><Card />{text}</Row>`)).toEqual([]);
  });
});

// Each case is checked from memory, then written to disk and rendered: the walk must throw the
// message without its "(in <X>)" note, or no placement error when the check finds none.
describe("function components", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tmp = join(here, ".tmp", "placement");
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const UI = `${IMPORT}
const Panel = ({ accent, children }: any) => (
  <Container accentColor={accent}>
    {children}
    <Text>footer</Text>
  </Container>
);
export const Primary = (props: any) => <Panel accent={1} {...props} />;
export const Bar = ({ children }: any) => <Row>{children}</Row>;
`;

  const CASES: Record<string, { files: Record<string, string>; expected: string[] }> = {
    "children through a namespace import, a spread and a chain": {
      files: { "ui.tsx": UI, "view.tsx": `${IMPORT}import * as ui from "./ui.tsx"\nexport const view = () => <ui.Primary><Button customId="b">B</Button></ui.Primary>` },
      expected: ['<Button> cannot go inside <Container> (in <ui.Primary>) @ <Button customId="b">B</Button>'],
    },
    "props.children, a named import and a .js specifier": {
      files: {
        "card.tsx": `${IMPORT}export function Card(props: any) {\n  return <Container>{props.children}</Container>;\n}`,
        "view.tsx": `${IMPORT}import { Card } from "./card.js"\nexport const view = () => <Card><Text>a</Text><Button customId="b">B</Button></Card>`,
      },
      expected: ['<Button> cannot go inside <Container> (in <Card>) @ <Button customId="b">B</Button>'],
    },
    "what a function component renders at its top": {
      files: { "view.tsx": `${IMPORT}const Btn = () => <Button customId="b">B</Button>;\nexport const view = () => <Container><Btn /></Container>` },
      expected: ["<Button> cannot go inside <Container> (rendered by <Btn>) @ <Btn />"],
    },
    "children returned as they are": {
      files: { "view.tsx": `${IMPORT}const Wrap = ({ children }: any) => <>{children}</>;\nexport const view = () => <Row><Wrap><Text>a</Text></Wrap></Row>` },
      expected: ["<Text> cannot go inside <Row> (in <Wrap>) @ <Text>a</Text>"],
    },
    "a module that imports nothing from composurejs": {
      files: { "ui.tsx": UI, "view.tsx": `import { Bar, Primary } from "./ui.tsx"\nexport const view = () => <Bar><Primary /></Bar>` },
      expected: ["<Container> cannot go inside <Row> (rendered by <Primary>, in <Bar>) @ <Primary />"],
    },
    "re-exports, a default export and a directory index": {
      files: {
        "parts/section.tsx": `${IMPORT}export default ({ children }: any) => <Section accessory={<Thumbnail src="https://x.test/t.png" />}>{children}</Section>;`,
        "parts/more.tsx": `${IMPORT}export const Box = ({ children }: any) => <Container>{children}</Container>;`,
        "parts/index.ts": `export { default as Panel } from "./section.tsx";\nexport * from "./more.tsx";`,
        "view.tsx": `${IMPORT}import { Box, Panel } from "./parts"\nexport const view = () => <Box><Panel><Row><Button customId="b">B</Button></Row></Panel></Box>`,
      },
      expected: ['<Row> cannot go inside <Section> (in <Panel>) @ <Row><Button customId="b">B</Button></Row>'],
    },
    "every return": {
      files: {
        "view.tsx": `${IMPORT}function Pick({ wide, children }: any) {
  if (wide) return <Container>{children}</Container>;
  return <Section accessory={<Thumbnail src="https://x.test/t.png" />}>{children}</Section>;
}
export const view = () => <Pick wide={false}><Separator /></Pick>`,
      },
      expected: ["<Separator> cannot go inside <Section> (in <Pick>) @ <Separator />"],
    },
    "children as a <Section> accessory": {
      files: {
        "view.tsx": `${IMPORT}const Card = ({ children }: any) => <Section accessory={children}><Text>t</Text></Section>;\nexport const view = () => <Card><Text>x</Text></Card>`,
      },
      expected: ["<Text> cannot be a <Section> accessory; use a <Button> or <Thumbnail> (in <Card>) @ <Text>x</Text>"],
    },
    "children placed where they may go": {
      files: {
        "ui.tsx": UI,
        "view.tsx": `${IMPORT}import * as ui from "./ui.tsx"\nexport const view = () => <ui.Primary><Text>a</Text><Row><Button customId="b">B</Button></Row></ui.Primary>`,
      },
      expected: [],
    },
  };

  const checkFiles = (files: Record<string, string>) => {
    const load = (path: string) => {
      const name = path.slice("/bot/src/".length);
      return name in files ? parseModule(files[name]!, path) : undefined;
    };
    const code = files["view.tsx"]!;
    return checkPlacement(parseModule(code, "/bot/src/view.tsx")!, { file: "/bot/src/view.tsx", load }).map((p) => `${p.message} @ ${code.slice(p.node.start, p.node.end)}`);
  };

  test.each(Object.keys(CASES))("%s", async (name) => {
    const { files, expected } = CASES[name]!;
    expect(checkFiles(files)).toEqual(expected);

    const dir = join(tmp, name.replace(/\W+/g, "-"));
    for (const [file, code] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), code);
    }
    const { view } = (await import(pathToFileURL(join(dir, "view.tsx")).href)) as { view: () => JSX.Element };
    const error = await render(view()).then(
      () => undefined,
      (e: Error) => e.message,
    );
    if (expected[0]) expect(error).toBe(expected[0].replace(/ \([^()]*\) @ .*$| @ .*$/s, ""));
    else expect(error).toBeUndefined();
  });

  test("without load, only the module's own function components are followed", () => {
    const code = `${IMPORT}import { Bar } from "./ui.tsx"\nconst Btn = () => <Button customId="b">B</Button>;\nexport const v = <Bar><Text>a</Text></Bar>; export const w = <Container><Btn /></Container>`;
    expect(checkPlacement(parseModule(code, "/bot/src/view.tsx")!).map((p) => p.message)).toEqual(["<Button> cannot go inside <Container> (rendered by <Btn>)"]);
  });

  test("a function component that renders itself, packages and unresolved imports add nothing", () => {
    expect(check(`const Loop = ({ children }: any) => <Loop><Row>{children}</Row></Loop>;\nconst v = <Container><Loop><Text>a</Text></Loop></Container>`)).toEqual([
      "<Row> cannot go inside <Row> (in <Loop>) @ <Row>{children}</Row>",
      "<Text> cannot go inside <Row> (in <Loop>) @ <Text>a</Text>",
    ]);
    const files = { "view.tsx": `${IMPORT}import { Bar } from "some-package"\nimport { Gone } from "./gone.tsx"\nexport const v = <Bar><Gone><Text>a</Text></Gone></Bar>` };
    expect(checkFiles(files)).toEqual([]);
  });
});

describe("the plugin", () => {
  const transform = (plugin: Plugin, code: string, id = "/bot/src/view.tsx", watched: string[] = []) => {
    const warnings: { message: string; pos: number }[] = [];
    const hook = plugin.transform as (this: unknown, code: string, id: string) => unknown;
    hook.call(
      {
        warn: (w: { message: string; pos: number }) => warnings.push(w),
        error: (e: unknown) => {
          throw e;
        },
        addWatchFile: (path: string) => watched.push(path),
      },
      code,
      id,
    );
    return warnings;
  };

  test("follows a function component into the module it is imported from, and watches it", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), ".tmp", "placement-plugin").replace(/\\/g, "/");
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(`${dir}/ui.tsx`, `${IMPORT}export const Card = ({ children }: any) => <Container>{children}</Container>;`);
      const code = `import { Button } from "composurejs"\nimport { Card } from "./ui.tsx"\nexport const v = <Card><Button customId="b">B</Button></Card>`;
      const watched: string[] = [];
      const [warning] = transform(composure(), code, `${dir}/view.tsx`, watched);
      expect(warning?.message).toMatch(/view\.tsx:3:24: <Button> cannot go inside <Container> \(in <Card>\)$/);
      expect(watched).toEqual([`${dir}/ui.tsx`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("warns at the misplaced child, naming where it is", () => {
    const code = `${IMPORT}export const v = <Row><Text>a</Text></Row>`;
    expect(transform(composure(), code)).toEqual([{ message: "/bot/src/view.tsx:2:23: <Text> cannot go inside <Row>", pos: code.indexOf("<Text>") }]);
  });

  test("placement: false turns the check off", () => {
    expect(transform(composure({ placement: false }), `${IMPORT}export const v = <Row><Text>a</Text></Row>`)).toEqual([]);
  });
});
