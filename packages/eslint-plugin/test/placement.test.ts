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

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, ".tmp");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A function component imported from another module (ADR 0032): the rule reads it from disk.
const UI = `${IMPORT}export const Card = ({ children }) => <Container>{children}</Container>;\n`;
const VIEW = `${IMPORT}import { Card } from "./ui.tsx"\nexport const v = <Card><Button customId="a">A</Button></Card>\n`;
const writeTwoFiles = () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ui.tsx"), UI);
  writeFileSync(join(dir, "card-view.tsx"), VIEW);
};

test("follows a function component into the module it is imported from", () => {
  writeTwoFiles();
  const messages = new Linter().verify(VIEW, [{ files: ["**/*.tsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }, plugin.configs.recommended], {
    filename: join(dir, "card-view.tsx"),
  });
  expect(messages).toMatchObject([{ message: "<Button> cannot go inside <Container> (in <Card>)", line: 3, column: 24 }]);
});

describe("oxlint", () => {
  const bin = resolve(here, "../node_modules/oxlint/bin/oxlint");
  const oxlint = (file: string) => {
    try {
      execFileSync(process.execPath, [bin, "--format", "unix", file], { cwd: dir, encoding: "utf8" });
      return "";
    } catch (error) {
      return (error as { stdout: string }).stdout;
    }
  };

  test("loads the plugin as a JS plugin and reports in TSX", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify({ jsPlugins: [resolve(here, "../src/index.ts").replace(/\\/g, "/")], rules: { "@composurejs/placement": "error" } }));
    writeFileSync(join(dir, "view.tsx"), `${IMPORT}export const v = (n: number) => <Row>{(<Text>{n}</Text>) as any}</Row>\n`);
    const output = oxlint("view.tsx");
    expect(output).toContain("view.tsx:2:");
    expect(output).toContain("<Text> cannot go inside <Row>");
  });

  test("follows a function component into the module it is imported from", () => {
    writeTwoFiles();
    expect(oxlint("card-view.tsx")).toContain("card-view.tsx:3:24: <Button> cannot go inside <Container> (in <Card>)");
  });
});
