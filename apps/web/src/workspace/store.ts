import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  readBrowserWorkspaceDocument,
  writeBrowserWorkspaceDocument,
} from "../clientPersistenceStorage";
import { randomUUID } from "../lib/utils";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";
import {
  createEmptyNiriDocument,
  isNiriDocument,
  isWorkspaceDocument,
  routeTargetForSurface,
  type BrowserSurfaceInput,
  type EditorSurfaceInput,
  type TerminalSurfaceInput,
  type ThreadSurfaceInput,
  type WorkspaceAxis,
  type WorkspaceColumn,
  type WorkspaceDirection,
  type WorkspaceDocument,
  type WorkspaceDocumentNiri,
  type WorkspacePlacementTarget,
  type WorkspaceSurfaceInstance,
  type WorkspaceWindow,
} from "./types";
import {
  addColumnAfter,
  addWindowToColumn,
  closeWindowById,
  closeSurfaceById,
  equalizeSplits,
  NIRI_DEFAULT_COLUMN_WIDTH,
  findColumnByWindowId,
  findMatchingBrowserSurfaceId,
  findMatchingEditorSurfaceId,
  findMatchingTerminalSurfaceIds,
  findMatchingThreadSurfaceId,
  findTerminalSurfaceIdsForThread,
  focusAdjacentColumn,
  focusAdjacentWindowInColumn,
  focusColumn,
  focusSurfaceById,
  focusWindowByStep,
  getFocusedSurface,
  getWindowBySurfaceId,
  insertSurfaceIntoWindow,
  migrateSplitToNiri,
  moveActiveTabToAdjacentWindow,
  moveFocusedWindow,
  placeSurface,
  resizeColumn,
  setColumnWidth,
  setColumnWindowSizes,
  setFocusedWindow,
  splitWindowWithSurface,
} from "./niriLayout";

// ── Types ──────────────────────────────────────────────────────────────

type OpenThreadDisposition = "focus-or-tab" | "new-tab" | "split-right" | "split-down";
type OpenTerminalDisposition = OpenThreadDisposition;

// ── Constants ──────────────────────────────────────────────────────────

const WORKSPACE_PERSIST_DEBOUNCE_MS = 150;

let persistTimer: number | null = null;

function scheduleWorkspacePersistence(document: WorkspaceDocumentNiri): void {
  if (typeof window === "undefined") {
    return;
  }

  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }

  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    writeBrowserWorkspaceDocument(document);
  }, WORKSPACE_PERSIST_DEBOUNCE_MS);
}

// ── Surface Factories ──────────────────────────────────────────────────

function nextWorkspaceId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function nextTerminalSessionId(): string {
  return `terminal-${randomUUID()}`;
}

function createThreadSurface(input: ThreadSurfaceInput): WorkspaceSurfaceInstance {
  return {
    id: nextWorkspaceId("surface"),
    kind: "thread",
    input,
  };
}

function createTerminalSurface(input: TerminalSurfaceInput): WorkspaceSurfaceInstance {
  return {
    id: nextWorkspaceId("surface"),
    kind: "terminal",
    input,
  };
}

function createBrowserSurface(input: BrowserSurfaceInput): WorkspaceSurfaceInstance {
  return {
    id: nextWorkspaceId("surface"),
    kind: "browser",
    input,
  };
}

function createEditorSurface(input: EditorSurfaceInput): WorkspaceSurfaceInstance {
  return {
    id: nextWorkspaceId("surface"),
    kind: "editor",
    input,
  };
}

function duplicateSurface(surface: WorkspaceSurfaceInstance): WorkspaceSurfaceInstance {
  if (surface.kind === "thread") {
    return createThreadSurface(surface.input);
  }

  if (surface.kind === "browser") {
    return createBrowserSurface(surface.input);
  }

  if (surface.kind === "editor") {
    return createEditorSurface(surface.input);
  }

  return createTerminalSurface({
    ...surface.input,
    terminalId: nextTerminalSessionId(),
  });
}

function preferredTerminalIdForThread(threadRef: TerminalSurfaceInput["threadRef"]): string {
  return (
    selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadKey, threadRef)
      .activeTerminalId || DEFAULT_THREAD_TERMINAL_ID
  );
}

function terminalSurfaceInputForThread(options: {
  disposition: OpenTerminalDisposition;
  threadRef: TerminalSurfaceInput["threadRef"];
}): TerminalSurfaceInput {
  const { disposition, threadRef } = options;
  return {
    scope: "thread",
    threadRef,
    terminalId:
      disposition === "focus-or-tab"
        ? preferredTerminalIdForThread(threadRef)
        : nextTerminalSessionId(),
  };
}

// ── Lookup Helpers ────────────────────────────────────────────────────

/** Find the first server-scoped thread ref in the document matching the given environment. */
function findThreadRefInDocument(
  doc: WorkspaceDocumentNiri,
  environmentId: string,
): TerminalSurfaceInput["threadRef"] | null {
  for (const surface of Object.values(doc.surfacesById)) {
    if (
      surface.kind === "thread" &&
      surface.input.scope === "server" &&
      surface.input.threadRef.environmentId === environmentId
    ) {
      return surface.input.threadRef;
    }
  }
  return null;
}

// ── First Window Helper ────────────────────────────────────────────────

function firstWindowId(doc: WorkspaceDocumentNiri): string | null {
  if (doc.focusedWindowId && doc.windowsById[doc.focusedWindowId]) {
    return doc.focusedWindowId;
  }
  if (doc.columns.length === 0) return null;
  const focusedCol = doc.columns[Math.max(0, doc.focusedColumnIndex)];
  if (focusedCol && focusedCol.windowIds.length > 0) {
    return focusedCol.windowIds[0] ?? null;
  }
  for (const col of doc.columns) {
    if (col.windowIds.length > 0) return col.windowIds[0]!;
  }
  return null;
}

// ── Read / Migrate ─────────────────────────────────────────────────────

function readInitialWorkspaceDocument(): WorkspaceDocumentNiri {
  const persisted = readBrowserWorkspaceDocument<WorkspaceDocument | WorkspaceDocumentNiri>();
  if (!persisted) {
    return createEmptyNiriDocument();
  }

  if (isNiriDocument(persisted)) {
    // Fix column widths from older persisted docs that used 1/count instead of
    // NIRI_DEFAULT_COLUMN_WIDTH. Without this, columns fit the viewport and
    // never overflow / scroll.
    const needsFix =
      persisted.columns.length > 1 &&
      persisted.columns.some((col) => col.width < NIRI_DEFAULT_COLUMN_WIDTH);
    if (needsFix) {
      return {
        ...persisted,
        columns: persisted.columns.map((col) => ({
          ...col,
          width: Math.max(col.width, NIRI_DEFAULT_COLUMN_WIDTH),
        })),
      };
    }
    return persisted;
  }

  if (isWorkspaceDocument(persisted)) {
    return migrateSplitToNiri(persisted);
  }

  return createEmptyNiriDocument();
}

// ── Store Interface ────────────────────────────────────────────────────

export interface WorkspaceStoreState {
  document: WorkspaceDocumentNiri;
  zoomedWindowId: string | null;
  openRouteTarget: (target: ThreadRouteTarget) => void;
  openThreadSurface: (input: ThreadSurfaceInput, disposition?: OpenThreadDisposition) => void;
  openThreadInNewTab: (input: ThreadSurfaceInput) => void;
  openThreadInSplit: (input: ThreadSurfaceInput, axis: WorkspaceAxis) => void;
  placeSurface: (surfaceId: string, target: WorkspacePlacementTarget) => void;
  placeThreadSurface: (input: ThreadSurfaceInput, target: WorkspacePlacementTarget) => void;
  openTerminalSurfaceForThread: (
    threadRef: TerminalSurfaceInput["threadRef"],
    disposition?: OpenTerminalDisposition,
  ) => void;
  splitWindowSurface: (windowId: string, axis: WorkspaceAxis) => void;
  setColumnWindowSizes: (columnId: string, sizes: number[]) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  closeSurface: (surfaceId: string) => void;
  closeFocusedWindow: () => void;
  focusWindow: (windowId: string) => void;
  focusWindowByStep: (step: -1 | 1) => void;
  focusAdjacentWindow: (direction: WorkspaceDirection) => void;
  focusTab: (windowId: string, surfaceId: string) => void;
  focusThreadSurface: (input: ThreadSurfaceInput) => void;
  resizeFocusedWindow: (direction: WorkspaceDirection) => void;
  equalizeSplits: () => void;
  toggleFocusedWindowZoom: () => void;
  moveActiveTabToAdjacentWindow: (direction: WorkspaceDirection) => void;
  moveFocusedWindow: (direction: WorkspaceDirection) => void;
  toggleTerminalSurfaceForThread: (threadRef: TerminalSurfaceInput["threadRef"]) => void;
  ensureTerminalSurfaceForThread: (threadRef: TerminalSurfaceInput["threadRef"]) => void;
  closeTerminalSurfacesForThread: (threadRef: TerminalSurfaceInput["threadRef"]) => void;
  focusTerminalSurfaceForThread: (threadRef: TerminalSurfaceInput["threadRef"]) => void;
  openBrowserSurface: (input: BrowserSurfaceInput, disposition?: OpenThreadDisposition) => void;
  openEditorSurface: (input: EditorSurfaceInput, disposition?: OpenThreadDisposition) => void;
  toggleBrowserSurface: (input: BrowserSurfaceInput) => void;
  toggleEditorSurface: (input: EditorSurfaceInput) => void;
  setMobileActiveWindow: (windowId: string) => void;
  resetWorkspace: () => void;
  // Legacy compat (kept for consumers that call setSplitNodeSizes)
  setSplitNodeSizes: (nodeId: string, sizes: number[]) => void;
}

function setDocumentState(nextDocument: WorkspaceDocumentNiri): Partial<WorkspaceStoreState> {
  scheduleWorkspacePersistence(nextDocument);
  return { document: nextDocument };
}

// ── Store ──────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStoreState>()((set, get) => ({
  document: readInitialWorkspaceDocument(),
  zoomedWindowId: null,

  openRouteTarget: (target) => {
    if (target.kind !== "server") {
      return;
    }
    get().openThreadSurface({ scope: "server", threadRef: target.threadRef }, "focus-or-tab");
  },

  openThreadSurface: (input, disposition = "focus-or-tab") => {
    const current = get().document;
    const existingSurfaceId =
      disposition === "focus-or-tab" ? findMatchingThreadSurfaceId(current, input) : null;
    if (existingSurfaceId) {
      set(setDocumentState(focusSurfaceById(current, existingSurfaceId)));
      return;
    }

    const nextSurface = createThreadSurface(input);
    const nextDocument =
      disposition === "split-right"
        ? splitWindowWithSurface(current, firstWindowId(current), "x", nextSurface)
        : disposition === "split-down"
          ? splitWindowWithSurface(current, firstWindowId(current), "y", nextSurface)
          : insertSurfaceIntoWindow(current, firstWindowId(current), nextSurface);
    set(setDocumentState(nextDocument));
  },

  openThreadInNewTab: (input) => {
    const current = get().document;
    const nextDocument = insertSurfaceIntoWindow(
      current,
      firstWindowId(current),
      createThreadSurface(input),
    );
    set(setDocumentState(nextDocument));
  },

  openThreadInSplit: (input, axis) => {
    const current = get().document;
    const nextDocument = splitWindowWithSurface(
      current,
      firstWindowId(current),
      axis,
      createThreadSurface(input),
    );
    set(setDocumentState(nextDocument));
  },

  placeSurface: (surfaceId, target) => {
    const current = get().document;
    const nextDocument = placeSurface(current, surfaceId, target);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  placeThreadSurface: (input, target) => {
    const current = get().document;
    const existingSurfaceId = findMatchingThreadSurfaceId(current, input);
    if (existingSurfaceId) {
      get().placeSurface(existingSurfaceId, target);
      return;
    }

    const nextSurface = createThreadSurface(input);
    // Insert into appropriate location based on target
    let nextDocument: WorkspaceDocumentNiri;
    if (target.kind === "tab") {
      const window = current.windowsById[target.windowId];
      if (!window) return;
      nextDocument = insertSurfaceIntoWindow(current, target.windowId, nextSurface);
    } else if (target.placement === "center") {
      nextDocument = insertSurfaceIntoWindow(current, target.windowId, nextSurface);
    } else {
      // Edge placement: create a placed surface then use placeSurface logic
      // First add the surface to the doc, then place it
      const docWithSurface = {
        ...current,
        surfacesById: { ...current.surfacesById, [nextSurface.id]: nextSurface },
      };
      nextDocument = placeSurface(docWithSurface, nextSurface.id, target);
    }
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  openTerminalSurfaceForThread: (threadRef, disposition = "focus-or-tab") => {
    const current = get().document;
    const threadSurfaceIds = findTerminalSurfaceIdsForThread(current, threadRef);
    if (disposition === "focus-or-tab" && threadSurfaceIds.length > 0) {
      set(setDocumentState(focusSurfaceById(current, threadSurfaceIds[0]!)));
      return;
    }

    const input = terminalSurfaceInputForThread({ disposition, threadRef });
    const matchingSurfaceIds = findMatchingTerminalSurfaceIds(current, input);
    if (matchingSurfaceIds.length > 0) {
      set(setDocumentState(focusSurfaceById(current, matchingSurfaceIds[0]!)));
      return;
    }

    const nextSurface = createTerminalSurface(input);
    const targetWindowId = firstWindowId(current);
    const nextDocument =
      disposition === "split-right"
        ? splitWindowWithSurface(current, targetWindowId, "x", nextSurface)
        : disposition === "split-down"
          ? splitWindowWithSurface(current, targetWindowId, "y", nextSurface)
          : insertSurfaceIntoWindow(current, targetWindowId, nextSurface);
    set(setDocumentState(nextDocument));
  },

  splitWindowSurface: (windowId, axis) => {
    const current = get().document;
    const window = current.windowsById[windowId];
    const activeSurface = window?.activeTabId ? current.surfacesById[window.activeTabId] : null;
    if (!window || !activeSurface) {
      return;
    }

    const nextDocument = splitWindowWithSurface(
      current,
      windowId,
      axis,
      duplicateSurface(activeSurface),
    );
    set(setDocumentState(nextDocument));
  },

  setColumnWindowSizes: (columnId, sizes) => {
    const current = get().document;
    const nextDocument = setColumnWindowSizes(current, columnId, sizes);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  setColumnWidth: (columnId, width) => {
    const current = get().document;
    const nextDocument = setColumnWidth(current, columnId, width);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  // Legacy compat: map to setColumnWindowSizes if we can find the column
  setSplitNodeSizes: (nodeId, sizes) => {
    // In niri mode, nodeId might be a column id
    get().setColumnWindowSizes(nodeId, sizes);
  },

  closeSurface: (surfaceId) => {
    const current = get().document;
    const nextDocument = closeSurfaceById(current, surfaceId);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  closeFocusedWindow: () => {
    const current = get().document;
    const windowId = firstWindowId(current);
    if (!windowId) {
      return;
    }
    const nextDocument = closeWindowById(current, windowId);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  focusWindow: (windowId) => {
    const current = get().document;
    if (!current.windowsById[windowId]) {
      return;
    }
    set(setDocumentState(setFocusedWindow(current, windowId)));
  },

  focusWindowByStep: (step) => {
    const current = get().document;
    const nextDocument = focusWindowByStep(current, step);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  focusAdjacentWindow: (direction) => {
    const current = get().document;
    let nextDocument: WorkspaceDocumentNiri;
    if (direction === "left" || direction === "right") {
      nextDocument = focusAdjacentColumn(current, direction);
    } else {
      nextDocument = focusAdjacentWindowInColumn(current, direction);
    }
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  focusTab: (windowId, surfaceId) => {
    const current = get().document;
    const window = current.windowsById[windowId];
    if (!window || !window.tabIds.includes(surfaceId)) {
      return;
    }
    set(
      setDocumentState(
        setFocusedWindow(
          {
            ...current,
            windowsById: {
              ...current.windowsById,
              [windowId]: {
                ...window,
                activeTabId: surfaceId,
              },
            },
          },
          windowId,
        ),
      ),
    );
  },

  focusThreadSurface: (input) => {
    const current = get().document;
    const existingSurfaceId = findMatchingThreadSurfaceId(current, input);
    if (!existingSurfaceId) {
      return;
    }
    set(setDocumentState(focusSurfaceById(current, existingSurfaceId)));
  },

  resizeFocusedWindow: (direction) => {
    const current = get().document;
    const nextDocument = resizeColumn(current, direction);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  equalizeSplits: () => {
    const current = get().document;
    const nextDocument = equalizeSplits(current);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  toggleFocusedWindowZoom: () => {
    const current = get();
    const focusedWindowId = firstWindowId(current.document);
    if (!focusedWindowId) {
      return;
    }
    set({
      zoomedWindowId: current.zoomedWindowId === focusedWindowId ? null : focusedWindowId,
    });
  },

  moveActiveTabToAdjacentWindow: (direction) => {
    const current = get().document;
    const nextDocument = moveActiveTabToAdjacentWindow(current, direction);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  moveFocusedWindow: (direction) => {
    const current = get().document;
    const nextDocument = moveFocusedWindow(current, direction);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },

  toggleTerminalSurfaceForThread: (threadRef) => {
    const current = get().document;
    const matchingSurfaceIds = findTerminalSurfaceIdsForThread(current, threadRef);
    if (matchingSurfaceIds.length > 0) {
      let nextDocument = current;
      for (const surfaceId of matchingSurfaceIds) {
        nextDocument = closeSurfaceById(nextDocument, surfaceId);
      }
      set(setDocumentState(nextDocument));
      return;
    }

    const nextDocument = splitWindowWithSurface(
      current,
      firstWindowId(current),
      "y",
      createTerminalSurface({
        scope: "thread",
        threadRef,
        terminalId: preferredTerminalIdForThread(threadRef),
      }),
    );
    set(setDocumentState(nextDocument));
  },

  ensureTerminalSurfaceForThread: (threadRef) => {
    const current = get().document;
    const matchingSurfaceIds = findTerminalSurfaceIdsForThread(current, threadRef);
    if (matchingSurfaceIds.length > 0) {
      set(setDocumentState(focusSurfaceById(current, matchingSurfaceIds[0]!)));
      return;
    }

    const nextDocument = splitWindowWithSurface(
      current,
      firstWindowId(current),
      "y",
      createTerminalSurface({
        scope: "thread",
        threadRef,
        terminalId: preferredTerminalIdForThread(threadRef),
      }),
    );
    set(setDocumentState(nextDocument));
  },

  closeTerminalSurfacesForThread: (threadRef) => {
    const current = get().document;
    const matchingSurfaceIds = findTerminalSurfaceIdsForThread(current, threadRef);
    if (matchingSurfaceIds.length === 0) {
      return;
    }

    let nextDocument = current;
    for (const surfaceId of matchingSurfaceIds) {
      nextDocument = closeSurfaceById(nextDocument, surfaceId);
    }
    set(setDocumentState(nextDocument));
  },

  focusTerminalSurfaceForThread: (threadRef) => {
    const current = get().document;
    const matchingSurfaceIds = findTerminalSurfaceIdsForThread(current, threadRef);
    if (matchingSurfaceIds.length === 0) {
      return;
    }
    set(setDocumentState(focusSurfaceById(current, matchingSurfaceIds[0]!)));
  },

  openBrowserSurface: (input, disposition = "focus-or-tab") => {
    const current = get().document;
    const existingId =
      disposition === "focus-or-tab" ? findMatchingBrowserSurfaceId(current, input) : null;
    if (existingId) {
      set(setDocumentState(focusSurfaceById(current, existingId)));
      return;
    }
    const surface = createBrowserSurface(input);
    const nextDocument =
      disposition === "split-right"
        ? splitWindowWithSurface(current, firstWindowId(current), "x", surface)
        : disposition === "split-down"
          ? splitWindowWithSurface(current, firstWindowId(current), "y", surface)
          : insertSurfaceIntoWindow(current, firstWindowId(current), surface);
    set(setDocumentState(nextDocument));
  },

  openEditorSurface: (input, disposition = "focus-or-tab") => {
    const current = get().document;
    const existingId =
      disposition === "focus-or-tab" ? findMatchingEditorSurfaceId(current, input) : null;
    if (existingId) {
      set(setDocumentState(focusSurfaceById(current, existingId)));
      return;
    }
    const surface = createEditorSurface(input);
    const nextDocument =
      disposition === "split-right"
        ? splitWindowWithSurface(current, firstWindowId(current), "x", surface)
        : disposition === "split-down"
          ? splitWindowWithSurface(current, firstWindowId(current), "y", surface)
          : insertSurfaceIntoWindow(current, firstWindowId(current), surface);
    set(setDocumentState(nextDocument));
  },

  toggleBrowserSurface: (input) => {
    const current = get().document;
    const existingId = findMatchingBrowserSurfaceId(current, input);
    if (existingId) {
      set(setDocumentState(closeSurfaceById(current, existingId)));
      return;
    }
    const surface = createBrowserSurface(input);
    const nextDocument = splitWindowWithSurface(current, firstWindowId(current), "x", surface);
    set(setDocumentState(nextDocument));
  },

  toggleEditorSurface: (input) => {
    const current = get().document;
    const existingId = findMatchingEditorSurfaceId(current, input);
    if (existingId) {
      set(setDocumentState(closeSurfaceById(current, existingId)));
      return;
    }
    const surface = createEditorSurface(input);
    const nextDocument = splitWindowWithSurface(current, firstWindowId(current), "x", surface);
    set(setDocumentState(nextDocument));
  },

  setMobileActiveWindow: (windowId) => {
    const current = get().document;
    if (!current.windowsById[windowId]) {
      return;
    }
    set(
      setDocumentState({
        ...current,
        focusedWindowId: windowId,
        mobileActiveWindowId: windowId,
      }),
    );
  },

  resetWorkspace: () => {
    const nextDocument = createEmptyNiriDocument();
    set({
      ...setDocumentState(nextDocument),
      zoomedWindowId: null,
    });
  },
}));

// ── Selector Hooks ─────────────────────────────────────────────────────

export function useWorkspaceDocument(): WorkspaceDocumentNiri {
  return useWorkspaceStore((state) => state.document);
}

/** Returns true if the workspace has any columns (i.e., has content to render). */
export function useWorkspaceHasColumns(): boolean {
  return useWorkspaceStore((state) => state.document.columns.length > 0);
}

/** Legacy compat: returns a synthetic "root node id" if columns exist. */
export function useWorkspaceRootNodeId(): string | null {
  return useWorkspaceStore((state) =>
    state.document.columns.length > 0 ? "__niri_root__" : null,
  );
}

export function useWorkspaceColumns(): WorkspaceColumn[] {
  return useWorkspaceStore(useShallow((state) => state.document.columns));
}

export function useWorkspaceColumn(columnIndex: number): WorkspaceColumn | null {
  return useWorkspaceStore((state) => state.document.columns[columnIndex] ?? null);
}

export function useWorkspaceFocusedColumnIndex(): number {
  return useWorkspaceStore((state) => state.document.focusedColumnIndex);
}

export function useWorkspaceWindowIds(): string[] {
  return useWorkspaceStore(
    useShallow((state) =>
      Object.keys(state.document.windowsById).filter(
        (windowId) => state.document.windowsById[windowId],
      ),
    ),
  );
}

export function useWorkspaceFocusedWindowId(): string | null {
  return useWorkspaceStore((state) => state.document.focusedWindowId);
}

export function useWorkspaceMobileActiveWindowId(): string | null {
  return useWorkspaceStore((state) => state.document.mobileActiveWindowId);
}

export function useWorkspaceZoomedWindowId(): string | null {
  return useWorkspaceStore((state) =>
    state.zoomedWindowId && state.document.windowsById[state.zoomedWindowId]
      ? state.zoomedWindowId
      : null,
  );
}

/** Legacy compat: always returns null since niri has no tree nodes. */
export function useWorkspaceNode(_nodeId: string | null): null {
  return null;
}

export function useWorkspaceWindow(windowId: string | null): WorkspaceWindow | null {
  return useWorkspaceStore((state) =>
    windowId ? (state.document.windowsById[windowId] ?? null) : null,
  );
}

export function useWorkspaceSurface(surfaceId: string | null): WorkspaceSurfaceInstance | null {
  return useWorkspaceStore((state) =>
    surfaceId ? (state.document.surfacesById[surfaceId] ?? null) : null,
  );
}

export function useFocusedWorkspaceSurface(): WorkspaceSurfaceInstance | null {
  const document = useWorkspaceDocument();
  return useMemo(() => getFocusedSurface(document), [document]);
}

export function useFocusedWorkspaceRouteTarget(): ThreadRouteTarget | null {
  const document = useWorkspaceDocument();
  return useMemo(() => routeTargetForSurface(getFocusedSurface(document)), [document]);
}

export function useWorkspaceThreadTerminalOpen(
  threadRef: TerminalSurfaceInput["threadRef"] | null | undefined,
): boolean {
  return useWorkspaceStore((state) => {
    if (!threadRef) {
      return false;
    }
    return findTerminalSurfaceIdsForThread(state.document, threadRef).length > 0;
  });
}
