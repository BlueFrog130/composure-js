import { jsx } from "./jsx-runtime.ts";

export { Fragment, type JSX } from "./jsx-runtime.ts";

export function jsxDEV(type: Parameters<typeof jsx>[0], props: Record<string, unknown>, key?: unknown): ReturnType<typeof jsx> {
  return jsx(type, props, key);
}
