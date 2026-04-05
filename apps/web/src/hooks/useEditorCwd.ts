import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";

export function useEditorCwd(
  environmentId: EnvironmentId | null,
  projectId: string | null,
  threadId: string | null,
): string | null {
  return useStore((state) => {
    if (!environmentId || !projectId) return null;
    const project = selectProjectByRef(state, {
      environmentId,
      projectId: projectId as ProjectId,
    });
    if (!project) return null;
    if (!threadId) return project.cwd;
    const thread = selectThreadByRef(state, {
      environmentId,
      threadId: threadId as ThreadId,
    });
    return thread?.worktreePath ?? project.cwd;
  });
}
