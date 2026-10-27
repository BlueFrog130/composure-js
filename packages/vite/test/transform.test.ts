import { describe, expect, test } from "vitest";
import { transformHandlers } from "../src/transform.ts";

const ROOT = "/bot";
const run = (code: string, file = "/bot/src/counter.tsx") => transformHandlers(code, file, { root: ROOT })?.code;
const idsIn = (out: string | undefined) => [...(out ?? "").matchAll(/__composure_handler\("([^"]+)"/g)].map((m) => m[1]);

const counter = `
import { Button, Container, Row, Text } from "composurejs"

export const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      {[1, 5, 10].map((step) => (
        <Button onClick={(c) => (c.user.id === owner ? <Counter count={count + step} owner={owner} /> : c.ephemeral("Not yours"))}>+{step}</Button>
      ))}
      <Button onClick={() => <Counter count={0} owner={owner} />}>Reset</Button>
    </Row>
  </Container>
)
`;

describe("transformHandlers", () => {
  test("hoists inline handlers in any component, capturing props and loop variables", () => {
    const out = run(counter)!;
    expect(out).toContain(`onClick={__composure_h0.bind([owner, count, step])}`);
    expect(out).toContain(`onClick={__composure_h1.bind([owner])}`);
    expect(out).toMatch(/const __composure_h0 = __composure_handler\("_[\w-]{7}", \["owner","count","step"\], \(\{ owner, count, step \}\) => \(\(c\) => \(c\.user\.id === owner/);
    expect(out).toContain(`import { __handler as __composure_handler } from "composurejs";`);
    // After the imports, before anything that could render at module load.
    expect(out.indexOf("__composure_h0 =")).toBeLessThan(out.indexOf("export const Counter"));
  });

  test("a command handler's c is captured by member chain; a shadowing parameter is not", () => {
    const out = run(`
      import { Button, command } from "composurejs"
      export const ping = command({
        name: "ping",
        description: "Ping",
        handler: (c) => (
          <>
            <Button onClick={(b) => b.ephemeral(\`hi \${c.user.id} in \${c.guildId}\`)}>a</Button>
            <Button onClick={(c) => c.ephemeral(c.user.id)}>b</Button>
          </>
        ),
      })
    `);
    expect(out).toContain(`__composure_h0.bind([c.user.id, c.guildId])`);
    expect(out).toContain(`__composure_h1.bind([])`);
  });

  test("module-scope bindings and imports are not captured; a bare read captures the root", () => {
    const out = run(`
      import { Button, Row } from "composurejs"
      import { db } from "./db"
      const PREFIX = ">"
      export function List({ items }: { items: string[] }) {
        const first = items[0]
        return <Row><Button onClick={() => db.save(PREFIX + first + items.length)}>save</Button></Row>
      }
    `);
    expect(out).toContain(`__composure_h0.bind([first, items.length])`);
  });

  test("named() gives a stable id of your choosing", () => {
    const out = run(`
      import { Button, named } from "composurejs"
      export const Roles = ({ role }: { role: string }) => <Button onClick={named("toggle-role", (c) => toggle(c, role))}>Toggle</Button>
    `);
    expect(out).toContain(`onClick={__composure_h0.bind([role])}`);
    expect(out).toContain(`__composure_handler("toggle-role", ["role"], ({ role }) => ((c) => toggle(c, role)), "src/counter.tsx: Roles")`);
  });

  test("a handler returning markup with handlers hoists both, the inner rewritten inside the outer", () => {
    const out = run(`
      import { Button } from "composurejs"
      export const Menu = ({ user }: { user: string }) => (
        <Button onClick={() => <Button onClick={(c) => c.ephemeral(user)}>Confirm</Button>}>Delete</Button>
      )
    `)!;
    expect(out).toContain(`onClick={__composure_h0.bind([user])}`);
    expect(out).toMatch(
      /const __composure_h0 = __composure_handler\("_[\w-]{7}", \["user"\], \(\{ user \}\) => \(\(\) => <Button onClick=\{__composure_h1\.bind\(\[user\]\)\}>Confirm<\/Button>\), "src\/counter\.tsx: Menu"\);/,
    );
    expect(out).toMatch(/const __composure_h1 = __composure_handler\("_[\w-]{7}", \["user"\], \(\{ user \}\) => \(\(c\) => c\.ephemeral\(user\)\), "src\/counter\.tsx: Menu"\);/);
  });

  test("generated ids survive unrelated edits, and change with file, owner, position or captures", () => {
    const [a, b] = idsIn(run(counter));
    expect(a).not.toBe(b);
    expect(idsIn(run(`// a comment\nconst unrelated = 1\n${counter.replace("## Count", "### Total")}`))).toEqual([a, b]);
    expect(idsIn(run(counter, "/bot/src/other.tsx"))[0]).not.toBe(a);
    expect(idsIn(run(counter.replace(/Counter/g, "Tally")))[0]).not.toBe(a);
    // Editing a handler's body keeps its id; capturing something new changes it.
    expect(idsIn(run(counter.replace("<Counter count={0} owner={owner} />", "<Counter count={count * 0} owner={owner} />")))[1]).not.toBe(b);
    expect(idsIn(run(counter.replace('c.ephemeral("Not yours")', 'c.ephemeral("Hands off")')))[0]).toBe(a);
    expect(idsIn(run(counter.replace("c.user.id === owner ?", "c.user.id === owner && count < 100 ?")))[0]).toBe(a);
    expect(idsIn(run(counter.replace('c.ephemeral("Not yours")', "c.ephemeral(String(count))")))[0]).toBe(a);
    expect(idsIn(run(counter.replace("+{step}</Button>", "+{step}</Button>").replace("(c) => (c.user.id === owner", "(c) => (c.user.id === owner && STEP_LIMIT")))[0]).toBe(a);
  });

  test("a handler may not render a component defined inside a function", () => {
    expect(() =>
      run(`import { Button } from "composurejs"\nexport function make() { const Local = () => <Button>x</Button>; return <Button onClick={() => <Local />}>go</Button> }`),
    ).toThrow("<Local> is defined inside a function, but the onClick handler rendering it is hoisted to module scope: define Local at module scope");
    expect(
      run(`import { Button } from "composurejs"\nconst Top = () => <Button>x</Button>\nexport function make() { return <Button onClick={() => <Top />}>go</Button> }`),
    ).toContain("__composure_h0.bind([])");
  });

  test("errors point at the handler", () => {
    expect(() => run(`import { Button } from "composurejs"\nimport { make } from "./x"\nexport const V = () => { const go = make(); return <Button onClick={go} /> }`)).toThrow(
      "onClick={go}: go is a local variable that does not hold a function written there, so it cannot be hoisted",
    );
    expect(() => run(`import { Button } from "composurejs"\nexport const V = () => { let go = () => 1; return <Button onClick={go} /> }`)).toThrow(
      "onClick={go}: go is declared with let; declare the handler with const",
    );
    expect(() => run(`import { Button, named } from "composurejs"\nconst id = "x"\nexport const V = () => <Button onClick={named(id, () => 1)} />`)).toThrow(
      "named() needs a string literal id",
    );
    expect(() => run(`import { Button, named } from "composurejs"\nexport const V = () => <Button onClick={named("_x", () => 1)} />`)).toThrow('not starting with "_"');
    expect(() =>
      run(`import { Button, named } from "composurejs"\nexport const V = () => <><Button onClick={named("a", () => 1)} /><Button onClick={named("a", () => 2)} /></>`),
    ).toThrow('named("a") is used twice in this module');
  });

  test("a module-level or imported function is wrapped as a handler; a reference held there passes on", () => {
    const out = run(`import { Button } from "composurejs"\nimport { refresh } from "./refs"\nexport const V = () => <Button onClick={refresh} />`)!;
    expect(out).toContain(`onClick={(typeof refresh === "function" ? __composure_h0.bind([]) : refresh)}`);
    expect(out).toMatch(/const __composure_h0 = __composure_handler\("_[\w-]{7}", \[\], \(\) => \(refresh\)/);
  });

  test("a local const an on* prop names is hoisted and tagged where it is declared, once", () => {
    const out = run(`import { Button } from "composurejs"
      export const V = ({ n, owner }) => {
        const add = ((c) => <V n={n + 1} owner={owner} />) satisfies unknown
        return <><Button onClick={add} /><Button onClick={add} /></>
      }`)!;
    expect(out).toContain(`const add = (__composure_h0.local((c) => <V n={n + 1} owner={owner} />, () => [n, owner])) satisfies unknown`);
    expect(out).toContain(`<Button onClick={add} /><Button onClick={add} />`);
    expect(out).toMatch(
      /const __composure_h0 = __composure_handler\("_[\w-]{7}", \["n","owner"\], \(\{ n, owner \}\) => \(\(c\) => <V n=\{n \+ 1\} owner=\{owner\} \/>\), "src\/counter\.tsx: V\.add"\);/,
    );
    expect(idsIn(out)).toHaveLength(1);
  });

  test("a local function declaration is tagged at the top of its block, so it may be named before it", () => {
    const out = run(`import { Button } from "composurejs"
      export function V({ n }) {
        return <Button onClick={go}>{n}</Button>
        function go(c) { return <Button onClick={() => n}>again</Button> }
      }`)!;
    expect(out).toMatch(/export function V\(\{ n \}\) \{ __composure_h0\.local\(go, \(\) => \[n\]\);/);
    expect(out).toContain(`function go(c) { return <Button onClick={__composure_h1.bind([n])}>again</Button> }`);
    expect(out).toContain(`({ n }) => (function go(c) { return <Button onClick={__composure_h1.bind([n])}>again</Button> }), "src/counter.tsx: V.go");`);
  });

  test("a local holding named() passes on as it is", () => {
    const out = run(`import { Button, named } from "composurejs"
      export const V = ({ role }) => { const t = named("toggle", (c) => role); return <Button onClick={t} /> }`)!;
    expect(out).toContain(`const t = __composure_h0.bind([role]); return <Button onClick={t} />`);
  });

  test("a hoisted handler may not read a function declared inside a function, its own name included", () => {
    expect(() =>
      run(`import { Button } from "composurejs"
        export const V = ({ n }) => { const inc = (c) => n + 1; return <Button onClick={() => <Button onClick={inc} />} /> }`),
    ).toThrow(
      "The onClick handler reads inc, a function declared inside a function, but the handler is hoisted to module scope: declare inc inside the handler, or at module scope",
    );
    expect(() =>
      run(`import { Button } from "composurejs"
        export const V = () => { function shout(s) { return s } return <Button onClick={() => shout("hi")} /> }`),
    ).toThrow("The onClick handler reads shout");
    expect(() => run(`import { Button } from "composurejs"\nexport const V = () => { const inc = (c) => <Button onClick={inc} />; return <Button onClick={inc} /> }`)).toThrow(
      "inc is a local handler that names itself, but it is hoisted to module scope, where inc is out of reach: render a component that places it",
    );
    // Declared inside the handler, it travels with it.
    const out = run(`import { Button } from "composurejs"
      export const V = ({ n }) => <Button onClick={() => { const go = (c) => n; return <Button onClick={go} /> }} />`)!;
    expect(out).toContain(`const go = __composure_h1.local((c) => n, () => [n])`);
  });

  test("a handler prop passed through a wrapper component is left as it is", () => {
    const out = run(`import { Button } from "composurejs"
      const Fancy = ({ onClick, label }) => <Button style="primary" onClick={onClick}>{label}</Button>
      const Plain = (props) => <Button onClick={props.onClick}>x</Button>
      export const V = ({ n }) => <Fancy label="go" onClick={() => <V n={n + 1} />} />`)!;
    expect(out).toContain(`<Button style="primary" onClick={onClick}>`);
    expect(out).toContain(`<Button onClick={props.onClick}>`);
    expect(out).toContain(`<Fancy label="go" onClick={__composure_h0.bind([n])} />`);
  });

  test("each function branch of ?:, &&, || and ?? is hoisted on its own", () => {
    const out = run(`import { Button } from "composurejs"
      export const V = ({ a, n }) => <><Button onClick={a ? (c) => "yes" : (c) => "no " + n} /><Button onClick={a && ((c) => "x")} /><Button onClick={(a as any) ?? (() => "y")} /></>`)!;
    expect(out).toContain(`onClick={a ? __composure_h0.bind([]) : __composure_h1.bind([n])}`);
    expect(out).toContain(`onClick={a && (__composure_h2.bind([]))}`);
    expect(out).toContain(`onClick={(a as any) ?? (__composure_h3.bind([]))}`);
  });

  test("a handler made by a call is a compile error", () => {
    expect(() => run(`import { Button } from "composurejs"\nimport { make } from "./x"\nexport const V = () => <Button onClick={make(1)} />`)).toThrow(
      "onClick={make(..)}: a handler made by a call cannot be hoisted",
    );
  });

  test("leaves modules without handlers alone", () => {
    expect(run(`import { Button } from "composurejs"\nexport const V = () => <Button onClick={undefined} />`)).toBeUndefined();
    expect(run(`export const x = 1`)).toBeUndefined();
  });

  test("emits a source map", () => {
    expect(transformHandlers(counter, "/bot/src/counter.tsx", { root: ROOT })?.map.mappings.length).toBeGreaterThan(0);
  });
});
