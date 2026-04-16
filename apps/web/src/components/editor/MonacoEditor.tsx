import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EnvironmentId } from "@t3tools/contracts";
import { fileContentQueryOptions, editorQueryKeys } from "~/lib/editorReactQuery";
import { ensureEnvironmentApi } from "~/environmentApi";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

type Monaco = typeof import("monaco-editor");
type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type MonacoModel = import("monaco-editor").editor.ITextModel;

// ── Worker setup via Vite bundled workers ───────────────────────────────
// Vite's `?worker` import creates real bundled workers that work in Electron.
// Each language gets its own worker so TypeScript LSP features function.

import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
  JsxEmit,
} from "monaco-editor/esm/vs/language/typescript/monaco.contribution";

function configureMonacoEnvironment() {
  if (typeof window === "undefined") return;
  const win = window as unknown as Record<string, unknown>;
  if (win.__monacoConfigured) return;
  win.__monacoConfigured = true;

  win.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "typescript" || label === "javascript") return new TsWorker();
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new CssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
      return new EditorWorker();
    },
  };

  // Configure TypeScript/JavaScript language defaults
  typescriptDefaults.setCompilerOptions({
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.NodeJs,
    jsx: JsxEmit.ReactJSX,
    allowJs: true,
    esModuleInterop: true,
    strict: true,
  });
  typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  javascriptDefaults.setCompilerOptions({
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    jsx: JsxEmit.ReactJSX,
    allowJs: true,
  });
}

// ── Monaco Editor Component ─────────────────────────────────────────────

const MonacoEditorComponent = memo(function MonacoEditorComponent({
  environmentId,
  cwd,
  relativePath,
}: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const modelsRef = useRef<Map<string, MonacoModel>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePathRef = useRef<string | null>(null);
  const cwdRef = useRef<string | null>(cwd);
  cwdRef.current = cwd;
  const [editorReady, setEditorReady] = useState(false);
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();

  const fileQuery = useQuery(fileContentQueryOptions({ environmentId, cwd, relativePath }));

  const saveMutation = useMutation({
    mutationFn: async ({
      fileCwd,
      path,
      contents,
    }: {
      fileCwd: string;
      path: string;
      contents: string;
    }) => {
      if (!environmentId) throw new Error("No environment available to save file.");
      const api = ensureEnvironmentApi(environmentId);
      return api.projects.writeFile({ cwd: fileCwd, relativePath: path, contents });
    },
    onSuccess: () => {
      if (cwdRef.current) {
        void queryClient.invalidateQueries({
          queryKey: editorQueryKeys.fileTree(environmentId, cwdRef.current),
        });
      }
    },
  });

  // Initialize Monaco editor once — container div is ALWAYS in the DOM
  useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) return;

    let disposed = false;
    configureMonacoEnvironment();

    void import("monaco-editor").then((monaco) => {
      if (disposed || !containerRef.current) return;
      monacoRef.current = monaco;

      const editor = monaco.editor.create(containerRef.current, {
        automaticLayout: true,
        theme: resolvedTheme === "dark" ? "vs-dark" : "vs",
        fontSize: 13,
        lineNumbers: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        wordWrap: "on",
        tabSize: 2,
        padding: { top: 8 },
      });
      editorRef.current = editor;
      setEditorReady(true);

      // Auto-save on change (1s debounce)
      editor.onDidChangeModelContent(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const currentPath = activePathRef.current;
        const currentCwd = cwdRef.current;
        if (!currentPath || !currentCwd) return;
        const model = editor.getModel();
        if (!model) return;
        const contents = model.getValue();
        saveTimerRef.current = setTimeout(() => {
          saveMutation.mutate({ fileCwd: currentCwd, path: currentPath, contents });
        }, 1000);
      });
    });

    const models = modelsRef.current;
    return () => {
      disposed = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      editorRef.current?.dispose();
      editorRef.current = null;
      // Don't dispose models — they live in Monaco's global registry and
      // may be shared across multiple editor instances.
      models.clear();
      setEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update theme
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(resolvedTheme === "dark" ? "vs-dark" : "vs");
    }
  }, [resolvedTheme]);

  // Set model when editor is ready + file content loaded + path changes
  const applyModel = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    if (!relativePath) {
      editor.setModel(null);
      activePathRef.current = null;
      return;
    }

    activePathRef.current = relativePath;

    if (fileQuery.data && fileQuery.data.encoding === "utf8") {
      const uri = monaco.Uri.file(relativePath);
      let model = modelsRef.current.get(relativePath);

      if (!model || model.isDisposed()) {
        // Check if a global model already exists (shared across editor instances)
        const existing = monaco.editor.getModel(uri);
        if (existing) {
          model = existing;
        } else {
          // Monaco auto-detects language from the URI file extension
          model = monaco.editor.createModel(fileQuery.data.contents, undefined, uri);
        }
        modelsRef.current.set(relativePath, model);
      } else if (model.getValue() !== fileQuery.data.contents) {
        model.setValue(fileQuery.data.contents);
      }
      editor.setModel(model);
    }
  }, [relativePath, fileQuery.data]);

  useEffect(() => {
    if (editorReady) applyModel();
  }, [editorReady, applyModel]);

  // Determine overlay state
  const showEmpty = !relativePath;
  const showLoading = relativePath && fileQuery.isLoading && !fileQuery.data;
  const showBinary = relativePath && fileQuery.data?.encoding === "base64";
  const showOverlay = showEmpty || showLoading || showBinary;

  return (
    <div className="relative min-h-0 flex-1">
      {/* Monaco container — ALWAYS mounted */}
      <div ref={containerRef} className={cn("absolute inset-0", showOverlay && "invisible")} />
      {/* Overlay messages */}
      {showOverlay && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {showEmpty && "Select a file to edit"}
          {showLoading && "Loading..."}
          {showBinary && "Binary file — cannot be displayed"}
        </div>
      )}
    </div>
  );
});

export default MonacoEditorComponent;
