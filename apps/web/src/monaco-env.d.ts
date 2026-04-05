// Type declarations for Monaco ESM subpath imports and Vite worker imports.
// These modules exist at runtime but don't ship type definitions.

declare module "monaco-editor/esm/vs/editor/editor.worker?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
declare module "monaco-editor/esm/vs/language/typescript/ts.worker?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
declare module "monaco-editor/esm/vs/language/json/json.worker?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
declare module "monaco-editor/esm/vs/language/css/css.worker?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
declare module "monaco-editor/esm/vs/language/html/html.worker?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
declare module "monaco-editor/esm/vs/language/typescript/monaco.contribution" {
  import type * as monaco from "monaco-editor";
  export const typescriptDefaults: monaco.languages.typescript.LanguageServiceDefaults;
  export const javascriptDefaults: monaco.languages.typescript.LanguageServiceDefaults;
  export const ScriptTarget: typeof monaco.languages.typescript.ScriptTarget;
  export const ModuleKind: typeof monaco.languages.typescript.ModuleKind;
  export const ModuleResolutionKind: typeof monaco.languages.typescript.ModuleResolutionKind;
  export const JsxEmit: typeof monaco.languages.typescript.JsxEmit;
}
