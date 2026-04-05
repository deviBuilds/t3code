import type { ThreadId } from "@t3tools/contracts";
import { useStore } from "~/store";

/**
 * Derives the editor working directory from the active thread context.
 * Uses the same logic as ChatView's `gitCwd`: worktreePath ?? project.cwd.
 */
export function useEditorCwd(projectId: string | null, threadId: string | null): string | null {
  return useStore((s) => {
    const project = s.projects.find((p) => p.id === projectId);
    if (!project) return null;
    if (!threadId) return project.cwd;
    const thread = s.threads.find((t) => t.id === (threadId as ThreadId));
    return thread?.worktreePath ?? project.cwd;
  });
}
