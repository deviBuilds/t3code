import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";

export type WorkspaceAxis = "x" | "y";
export type WorkspaceDirection = "left" | "right" | "up" | "down";
export type WorkspaceDropPlacement = "center" | "left" | "right" | "top" | "bottom";
export type WorkspaceLayoutEngine = "split" | "niri";
export type WorkspaceSurfaceKind = "thread" | "terminal" | "browser" | "editor";
export type WorkspaceSplitSizingMode = "auto" | "manual";

export type ThreadSurfaceInput =
  | {
      scope: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      scope: "draft";
      draftId: DraftId;
      environmentId: EnvironmentId;
      threadId: ThreadId;
    };

export interface TerminalSurfaceInput {
  scope: "thread";
  threadRef: ScopedThreadRef;
  terminalId: string;
}

export interface BrowserSurfaceInput {
  environmentId: EnvironmentId;
  projectId: string;
  initialUrl?: string;
  label?: string;
}

export interface EditorSurfaceInput {
  environmentId: EnvironmentId;
  projectId: string;
  initialFilePath?: string;
  label?: string;
}

export type WorkspaceSurfaceInstance =
  | {
      id: string;
      kind: "thread";
      input: ThreadSurfaceInput;
    }
  | {
      id: string;
      kind: "terminal";
      input: TerminalSurfaceInput;
    }
  | {
      id: string;
      kind: "browser";
      input: BrowserSurfaceInput;
    }
  | {
      id: string;
      kind: "editor";
      input: EditorSurfaceInput;
    };

export interface WorkspaceWindow {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export type WorkspacePlacementTarget =
  | {
      kind: "window";
      windowId: string;
      placement: WorkspaceDropPlacement;
    }
  | {
      kind: "tab";
      windowId: string;
      surfaceId: string;
    };

export type WorkspaceNode =
  | {
      id: string;
      kind: "window";
      windowId: string;
    }
  | {
      id: string;
      kind: "split";
      axis: WorkspaceAxis;
      childIds: string[];
      sizes: number[];
      sizingMode: WorkspaceSplitSizingMode;
    };

export interface WorkspaceDocument {
  version: 1;
  layoutEngine: WorkspaceLayoutEngine;
  rootNodeId: string | null;
  nodesById: Record<string, WorkspaceNode>;
  windowsById: Record<string, WorkspaceWindow>;
  surfacesById: Record<string, WorkspaceSurfaceInstance>;
  focusedWindowId: string | null;
  mobileActiveWindowId: string | null;
}

// ── Niri Column Layout Types ───────────────────────────────────────────

export interface WorkspaceColumn {
  id: string;
  windowIds: string[];
  sizes: number[];
  width: number;
  sizingMode: WorkspaceSplitSizingMode;
}

export interface WorkspaceDocumentNiri {
  version: 2;
  layoutEngine: "niri";
  columns: WorkspaceColumn[];
  focusedColumnIndex: number;
  focusedWindowId: string | null;
  mobileActiveWindowId: string | null;
  windowsById: Record<string, WorkspaceWindow>;
  surfacesById: Record<string, WorkspaceSurfaceInstance>;
  scrollOffset: number;
}

export type AnyWorkspaceDocument = WorkspaceDocument | WorkspaceDocumentNiri;

export function createEmptyNiriDocument(): WorkspaceDocumentNiri {
  return {
    version: 2,
    layoutEngine: "niri",
    columns: [],
    focusedColumnIndex: -1,
    focusedWindowId: null,
    mobileActiveWindowId: null,
    windowsById: {},
    surfacesById: {},
    scrollOffset: 0,
  };
}

export function isNiriDocument(value: unknown): value is WorkspaceDocumentNiri {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceDocumentNiri>;
  return candidate.version === 2 && candidate.layoutEngine === "niri";
}

export function createEmptyWorkspaceDocument(): WorkspaceDocument {
  return {
    version: 1,
    layoutEngine: "split",
    rootNodeId: null,
    nodesById: {},
    windowsById: {},
    surfacesById: {},
    focusedWindowId: null,
    mobileActiveWindowId: null,
  };
}

export function normalizeWorkspaceSplitSizes(
  sizes: number[] | null | undefined,
  childCount: number,
): number[] {
  if (childCount <= 0) {
    return [];
  }

  const fallback = Array.from({ length: childCount }, () => 1 / childCount);
  if (!sizes || sizes.length !== childCount) {
    return fallback;
  }

  const finiteSizes = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = finiteSizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) {
    return fallback;
  }

  return finiteSizes.map((size) => size / total);
}

export function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceDocument>;
  return candidate.version === 1 && candidate.layoutEngine === "split";
}

export function sameThreadSurfaceInput(
  left: ThreadSurfaceInput | null | undefined,
  right: ThreadSurfaceInput | null | undefined,
): boolean {
  if (!left || !right || left.scope !== right.scope) {
    return false;
  }

  if (left.scope === "server" && right.scope === "server") {
    return (
      left.threadRef.environmentId === right.threadRef.environmentId &&
      left.threadRef.threadId === right.threadRef.threadId
    );
  }

  if (left.scope !== "draft" || right.scope !== "draft") {
    return false;
  }

  return (
    left.draftId === right.draftId &&
    left.environmentId === right.environmentId &&
    left.threadId === right.threadId
  );
}

export function sameTerminalSurfaceInput(
  left: TerminalSurfaceInput | null | undefined,
  right: TerminalSurfaceInput | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.scope === right.scope &&
    left.threadRef.environmentId === right.threadRef.environmentId &&
    left.threadRef.threadId === right.threadRef.threadId &&
    left.terminalId === right.terminalId
  );
}

export function sameBrowserSurfaceInput(
  left: BrowserSurfaceInput | null | undefined,
  right: BrowserSurfaceInput | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.environmentId === right.environmentId && left.projectId === right.projectId;
}

export function sameEditorSurfaceInput(
  left: EditorSurfaceInput | null | undefined,
  right: EditorSurfaceInput | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.environmentId === right.environmentId && left.projectId === right.projectId;
}

export function sameWorkspaceSurface(
  left: WorkspaceSurfaceInstance | null | undefined,
  right: WorkspaceSurfaceInstance | null | undefined,
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "thread" && right.kind === "thread") {
    return sameThreadSurfaceInput(left.input, right.input);
  }

  if (left.kind === "terminal" && right.kind === "terminal") {
    return sameTerminalSurfaceInput(left.input, right.input);
  }

  if (left.kind === "browser" && right.kind === "browser") {
    return sameBrowserSurfaceInput(left.input, right.input);
  }

  if (left.kind === "editor" && right.kind === "editor") {
    return sameEditorSurfaceInput(left.input, right.input);
  }

  return false;
}

export function routeTargetForSurface(
  surface: WorkspaceSurfaceInstance | null | undefined,
): ThreadRouteTarget | null {
  if (!surface) {
    return null;
  }

  if (surface.kind === "thread") {
    if (surface.input.scope === "server") {
      return {
        kind: "server",
        threadRef: surface.input.threadRef,
      };
    }

    return {
      kind: "draft",
      draftId: surface.input.draftId,
    };
  }

  if (surface.kind === "terminal") {
    return {
      kind: "server",
      threadRef: surface.input.threadRef,
    };
  }

  // Browser and editor surfaces don't have thread route targets
  return null;
}

export function normalizeThreadSurfaceInput(input: ThreadSurfaceInput): ThreadSurfaceInput {
  if (input.scope === "server") {
    return input;
  }

  return {
    scope: "draft",
    draftId: input.draftId,
    environmentId: input.environmentId,
    threadId: input.threadId,
  };
}

export function serverThreadSurfaceInput(threadRef: ScopedThreadRef): ThreadSurfaceInput {
  return {
    scope: "server",
    threadRef,
  };
}

export function draftThreadSurfaceInput(input: {
  draftId: DraftId;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}): ThreadSurfaceInput {
  return {
    scope: "draft",
    draftId: input.draftId,
    environmentId: input.environmentId,
    threadId: input.threadId,
  };
}

export function terminalSurfaceInput(
  threadRef: ScopedThreadRef,
  terminalId: string,
): TerminalSurfaceInput {
  return {
    scope: "thread",
    threadRef,
    terminalId,
  };
}

export function browserSurfaceInput(
  environmentId: EnvironmentId,
  projectId: string,
  initialUrl?: string,
  label?: string,
): BrowserSurfaceInput {
  const result: BrowserSurfaceInput = { environmentId, projectId };
  if (initialUrl !== undefined) result.initialUrl = initialUrl;
  if (label !== undefined) result.label = label;
  return result;
}

export function editorSurfaceInput(
  environmentId: EnvironmentId,
  projectId: string,
  initialFilePath?: string,
  label?: string,
): EditorSurfaceInput {
  const result: EditorSurfaceInput = { environmentId, projectId };
  if (initialFilePath !== undefined) result.initialFilePath = initialFilePath;
  if (label !== undefined) result.label = label;
  return result;
}
