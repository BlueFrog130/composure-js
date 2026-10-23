import { expect, test } from "vitest";
import { search, slug } from "../src/docs.tsx";
import { readConfig } from "../src/env.ts";
import { issueUrl } from "../src/feedback.tsx";
import { excerpt, findVersion, tidy } from "../src/releases.ts";

test("finds composurejs versions, not other packages'", () => {
  expect(findVersion("composurejs v0.1.2 is out")).toBe("0.1.2");
  expect(findVersion("**composurejs** v0.1.2")).toBe("0.1.2");
  expect(findVersion("composurejs@0.2.0")).toBe("0.2.0");
  expect(findVersion("v0.1.2")).toBe("0.1.2");
  expect(findVersion("10.20.300")).toBe("10.20.300");
  expect(findVersion("1.2 and 3.4.5.")).toBe("3.4.5");
  expect(findVersion("1.2.3.4")).toBe("1.2.3");
  expect(findVersion("no version 1.2")).toBeUndefined();
  // composure-rs's: its bot announces them in the same server
  expect(findVersion("composure v0.1.2 is out")).toBeUndefined();
  expect(findVersion("composure/v0.1.4")).toBeUndefined();
  expect(findVersion("composure_macros v0.1.4, then composurejs v0.2.0")).toBe("0.2.0");
  // Other composurejs packages
  expect(findVersion("@composurejs/vite@0.3.0")).toBeUndefined();
});

test("tidies notes", () => {
  const notes = "## Features\n\n### Commands\n\n`command()` turns\nobjects into commands.\n\n- one\n- two\n  continued\n\n```ts\nconst x =\n    1\n```";
  expect(tidy(notes)).toBe("### Features\n\n**Commands**\n\n`command()` turns objects into commands.\n\n- one\n- two continued\n\n```ts\nconst x =\n    1\n```");
});

test("excerpts at breaks, closing fences", () => {
  expect(excerpt("short", 10)).toEqual(["short", false]);
  expect(excerpt("one\n\ntwo two two", 10)).toEqual(["one", true]);
  expect(excerpt("```\ncode\n\nmore code", 12)).toEqual(["```\ncode\n```", true]);
});

test("slugs headings as VitePress does", () => {
  expect(slug("Ids, deploys, and `named()`")).toBe("ids-deploys-and-named");
  expect(slug("Errors, retries and rate limits")).toBe("errors-retries-and-rate-limits");
  expect(slug("[Typing](./x) `c.env` and `c.data`")).toBe("typing-c-env-and-c-data");
});

test("searches prefixes first; an empty query lists chapters", () => {
  expect(search("middle")[0]![1].title).toBe("Middleware");
  expect(search("zzzz")).toEqual([]);
  expect(search("").every(([, e]) => !e.title.includes(" › "))).toBe(true);
});

test("prefills issues within Discord's URL limit", () => {
  expect(issueUrl("https://github.com/o/r", "[Bug] a b", "x/y")).toBe("https://github.com/o/r/issues/new?title=%5BBug%5D%20a%20b&body=x%2Fy");
  const long = issueUrl("https://github.com/o/r", "t", "é".repeat(500));
  expect(long.length).toBeLessThanOrEqual(512);
  expect(long.endsWith("%E2%80%A6")).toBe(true);
});

test("reads its Config from vars", () => {
  const vars = { ANNOUNCE_CHANNEL_ID: "600000000000000001", FEEDBACK_CHANNEL_ID: "600000000000000002", LOG_CHANNEL_ID: "600000000000000003" };
  expect(readConfig(vars)).toMatchObject({ repo: "BlueFrog130/composure-js", githubToken: undefined });
  expect(() => readConfig({ ...vars, LOG_CHANNEL_ID: "" })).toThrow("LOG_CHANNEL_ID is not set");
  expect(() => readConfig({ ...vars, LOG_CHANNEL_ID: "#log" })).toThrow("LOG_CHANNEL_ID is not a snowflake");
});
