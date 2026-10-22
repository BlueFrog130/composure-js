import type { Plugin } from "vite";
import { transformViews, ViewTransformError } from "./transform.ts";
export interface ComposureOptions {
    /** Modules to transform. Default: JS/TS/JSX/TSX outside node_modules. */
    include?: RegExp;
}
/**
 * The composurejs Vite plugin. Hoists Views' Inline Handlers out of render (ADR 0005), so
 * clicks call them directly and each `custom_id` carries only what they capture.
 */
export default function composure(options?: ComposureOptions): Plugin;
export { composure, transformViews, ViewTransformError };
