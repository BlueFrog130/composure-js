import type { Plugin } from "vite"
import { transformViews, ViewTransformError } from "./transform.ts"

export interface ComposureOptions {
  /** Modules to transform. Default: JS/TS/JSX/TSX outside node_modules. */
  include?: RegExp
}

/**
 * The composurejs Vite plugin. Hoists Views' Inline Handlers out of render (ADR 0005), so
 * clicks call them directly and each `custom_id` carries only what they capture.
 */
export default function composure(options: ComposureOptions = {}): Plugin {
  const include = options.include ?? /\.[cm]?[jt]sx?$/
  return {
    name: "composurejs",
    // Before Oxc compiles TS and JSX, so hoisted handlers are copied as written.
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0]!
      if (!include.test(file) || /[\/]node_modules[\/]/.test(file)) return undefined
      try {
        return transformViews(code, file)
      } catch (error) {
        if (error instanceof ViewTransformError) this.error({ message: error.message, pos: error.pos })
        throw error
      }
    },
  }
}

export { composure, transformViews, ViewTransformError }
