import type { ProjectListEntriesResult, ProjectReadFileResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const editorQueryKeys = {
  all: ["editor"] as const,
  fileTree: (cwd: string | null) => ["editor", "file-tree", cwd] as const,
  fileContent: (cwd: string | null, path: string | null) =>
    ["editor", "file-content", cwd, path] as const,
};

const DEFAULT_LIST_LIMIT = 3000;
const FILE_TREE_STALE_TIME = 30_000;
const FILE_CONTENT_STALE_TIME = 10_000;
const DEFAULT_MAX_READ_BYTES = 1_048_576; // 1 MB

const EMPTY_TREE: ProjectListEntriesResult = { entries: [], truncated: false };

export function fileTreeQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: editorQueryKeys.fileTree(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("No workspace CWD available.");
      return api.projects.listEntries({ cwd, limit: DEFAULT_LIST_LIMIT });
    },
    enabled: cwd !== null,
    staleTime: FILE_TREE_STALE_TIME,
    placeholderData: (prev) => prev ?? EMPTY_TREE,
  });
}

export function fileContentQueryOptions(cwd: string | null, relativePath: string | null) {
  return queryOptions({
    queryKey: editorQueryKeys.fileContent(cwd, relativePath),
    queryFn: async (): Promise<ProjectReadFileResult> => {
      const api = ensureNativeApi();
      if (!cwd || !relativePath) throw new Error("No file to read.");
      return api.projects.readFile({ cwd, relativePath, maxBytes: DEFAULT_MAX_READ_BYTES });
    },
    enabled: cwd !== null && relativePath !== null && relativePath.length > 0,
    staleTime: FILE_CONTENT_STALE_TIME,
  });
}
