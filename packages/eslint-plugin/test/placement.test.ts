import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter, RuleTester } from "eslint";
import { afterAll, describe, expect, it, test } from "vitest";
import plugin from "../src/index.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const IMPORT = 'import { Button, Container, Row, Section, Text } from "composurejs"\n';
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

// The cases checkPlacement covers are tested in @composurejs/vite; these test the rule around it.
tester.run("placement", plugin.rules.placement, {
  valid: [
    IMPORT + 'const v = <Container><Row><Button customId="a">A</Button></Row></Container>',
    IMPORT + 'const v = <Section accessory={<Button customId="a">A</Button>}><Text>a</Text></Section>',
    'import { Row, Text } from "./mine"\nconst v = <Row><Text>a</Text></Row>',
  ],
  invalid: [
    {
      code: IMPORT + 'const v = <Container><Button customId="a">A</Button></Container>',
      errors: [{ message: "<Button> cannot go inside <Container>", line: 2, column: 22 }],
    },
    {
      code: IMPORT + "const v = <Row>\n  hello\n  <Text>a</Text>\n</Row>",
      errors: [
        { message: "text cannot go inside <Row>", line: 2 },
        { message: "<Text> cannot go inside <Row>", line: 4, column: 3 },
      ],
    },
  ],
});

test("the recommended config turns the rule on as an error", () => {
  const linter = new Linter();
  const messages = linter.verify(IMPORT + "const v = <Row><Text>a</Text></Row>", [
    { languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    plugin.configs.recommended,
  ]);
  expect(messages).toMatchObject([{ ruleId: "@composurejs/placement", severity: 2, message: "<Text> cannot go inside <Row>" }]);
});

describe("oxlint", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, ".tmp");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("loads the plugin as a JS plugin and reports in TSX", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify({ jsPlugins: [resolve(here, "../src/index.ts").replace(/\\/g, "/")], rules: { "@composurejs/placement": "error" } }));
    writeFileSync(join(dir, "view.tsx"), `${IMPORT}export const v = (n: number) => <Row>{(<Text>{n}</Text>) as any}</Row>\n`);
    const bin = resolve(here, "../node_modules/oxlint/bin/oxlint");
    let output = "";
    try {
      execFileSync(process.execPath, [bin, "--format", "unix", "view.tsx"], { cwd: dir, encoding: "utf8" });
    } catch (error) {
      output = (error as { stdout: string }).stdout;
    }
    expect(output).toContain("view.tsx:2:");
    expect(output).toContain("<Text> cannot go inside <Row>");
  });
});
