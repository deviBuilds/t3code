import type {
  EnvironmentId,
  ProjectListEntriesResult,
  ProjectReadFileResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "../environmentApi";

export const editorQueryKeys = {
  all: ["editor"] as const,
  fileTree: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["editor", "file-tree", environmentId ?? null, cwd] as const,
  fileContent: (environmentId: EnvironmentId | null, cwd: string | null, path: string | null) =>
    ["editor", "file-content", environmentId ?? null, cwd, path] as const,
};

const DEFAULT_LIST_LIMIT = 3000;
const FILE_TREE_STALE_TIME = 30_000;
const FILE_CONTENT_STALE_TIME = 10_000;
const DEFAULT_MAX_READ_BYTES = 1_048_576;

const EMPTY_TREE: ProjectListEntriesResult = { entries: [], truncated: false };

export function fileTreeQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: editorQueryKeys.fileTree(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("No workspace available.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.listEntries({ cwd: input.cwd, limit: DEFAULT_LIST_LIMIT });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: FILE_TREE_STALE_TIME,
    placeholderData: (prev) => prev ?? EMPTY_TREE,
  });
}

export function fileContentQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
}) {
  return queryOptions({
    queryKey: editorQueryKeys.fileContent(input.environmentId, input.cwd, input.relativePath),
    queryFn: async (): Promise<ProjectReadFileResult> => {
      if (!input.environmentId || !input.cwd || !input.relativePath) {
        throw new Error("No file to read.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
        maxBytes: DEFAULT_MAX_READ_BYTES,
      });
    },
    enabled:
      input.environmentId !== null &&
      input.cwd !== null &&
      input.relativePath !== null &&
      input.relativePath.length > 0,
    staleTime: FILE_CONTENT_STALE_TIME,
  });
}
