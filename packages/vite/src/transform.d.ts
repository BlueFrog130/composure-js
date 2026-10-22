import { type SourceMap } from "magic-string";
export declare class ViewTransformError extends Error {
    readonly pos: number;
    name: string;
    constructor(message: string, pos: number);
}
export interface TransformResult {
    code: string;
    map: SourceMap;
}
/** Rewrites the Views in one module; undefined when there is nothing to do. */
export declare function transformViews(code: string, id: string): TransformResult | undefined;
