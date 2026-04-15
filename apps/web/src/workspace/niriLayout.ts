/**
 * niriLayout - Pure functions for the niri-style scrollable column layout.
 *
 * All functions are pure: they take a WorkspaceDocumentNiri and return a new one.
 * The zustand store calls these and persists the result.
 */
import { randomUUID } from "../lib/utils";
import {
  createEmptyNiriDocument,
  normalizeWorkspaceSplitSizes,
  type BrowserSurfaceInput,
  type EditorSurfaceInput,
  type TerminalSurfaceInput,
  type ThreadSurfaceInput,
  type WorkspaceColumn,
  type WorkspaceDirection,
  type WorkspaceDocument,
  type WorkspaceDocumentNiri,
  type WorkspaceDropPlacement,
  type WorkspacePlacementTarget,
  type WorkspaceSurfaceInstance,
  type WorkspaceWindow,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────

export const NIRI_DEFAULT_COLUMN_WIDTH = 0.5;
export const NIRI_MIN_COLUMN_WIDTH = 0.2;
export const NIRI_MAX_COLUMN_WIDTH = 1.0;
export const NIRI_COLUMN_RESIZE_STEP = 0.06;
export const NIRI_MIN_WINDOW_HEIGHT_FRACTION = 0.15;
export const NIRI_WINDOW_RESIZE_STEP = 0.08;

// ── Helpers ────────────────────────────────────────────────────────────

function nextId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function cloneColumn(col: WorkspaceColumn): WorkspaceColumn {
  return { ...col, windowIds: [...col.windowIds], sizes: [...col.sizes] };
}

function cloneWindow(w: WorkspaceWindow): WorkspaceWindow {
  return { ...w, tabIds: [...w.tabIds] };
}

function equalSizes(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => 1 / count);
}

// ── Lookups ────────────────────────────────────────────────────────────

export function findColumnIndexByWindowId(
  doc: WorkspaceDocumentNiri,
  windowId: string,
): number {
  return doc.columns.findIndex((col) => col.windowIds.includes(windowId));
}

export function findColumnByWindowId(
  doc: WorkspaceDocumentNiri,
  windowId: string,
): { columnIndex: number; column: WorkspaceColumn } | null {
  const index = findColumnIndexByWindowId(doc, windowId);
  if (index < 0) return null;
  return { columnIndex: index, column: doc.columns[index]! };
}

export function getWindowBySurfaceId(
  doc: WorkspaceDocumentNiri,
  surfaceId: string,
): { windowId: string; window: WorkspaceWindow } | null {
  for (const [windowId, window] of Object.entries(doc.windowsById)) {
    if (window.tabIds.includes(surfaceId)) {
      return { windowId, window };
    }
  }
  return null;
}

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

export function getFocusedSurface(
  doc: WorkspaceDocumentNiri,
): WorkspaceSurfaceInstance | null {
  const windowId = firstWindowId(doc);
  if (!windowId) return null;
  const window = doc.windowsById[windowId];
  const surfaceId = window?.activeTabId ?? null;
  return surfaceId ? (doc.surfacesById[surfaceId] ?? null) : null;
}

function getOrderedWindowIds(doc: WorkspaceDocumentNiri): string[] {
  const ids: string[] = [];
  for (const col of doc.columns) {
    for (const wid of col.windowIds) {
      ids.push(wid);
    }
  }
  return ids;
}

export function findMatchingThreadSurfaceId(
  doc: WorkspaceDocumentNiri,
  input: ThreadSurfaceInput,
): string | null {
  for (const surface of Object.values(doc.surfacesById)) {
    if (surface.kind !== "thread") continue;
    if (surface.input.scope === "server" && input.scope === "server") {
      if (
        surface.input.threadRef.environmentId === input.threadRef.environmentId &&
        surface.input.threadRef.threadId === input.threadRef.threadId
      ) {
        return surface.id;
      }
    }
    if (surface.input.scope === "draft" && input.scope === "draft") {
      if (
        surface.input.draftId === input.draftId &&
        surface.input.environmentId === input.environmentId &&
        surface.input.threadId === input.threadId
      ) {
        return surface.id;
      }
    }
  }
  return null;
}

export function findTerminalSurfaceIdsForThread(
  doc: WorkspaceDocumentNiri,
  threadRef: TerminalSurfaceInput["threadRef"],
): string[] {
  return Object.values(doc.surfacesById)
    .filter(
      (s) =>
        s.kind === "terminal" &&
        s.input.threadRef.environmentId === threadRef.environmentId &&
        s.input.threadRef.threadId === threadRef.threadId,
    )
    .map((s) => s.id);
}

export function findMatchingTerminalSurfaceIds(
  doc: WorkspaceDocumentNiri,
  input: TerminalSurfaceInput,
): string[] {
  return Object.values(doc.surfacesById)
    .filter(
      (s) =>
        s.kind === "terminal" &&
        s.input.threadRef.environmentId === input.threadRef.environmentId &&
        s.input.threadRef.threadId === input.threadRef.threadId &&
        s.input.terminalId === input.terminalId,
    )
    .map((s) => s.id);
}

export function findMatchingBrowserSurfaceId(
  doc: WorkspaceDocumentNiri,
  input: BrowserSurfaceInput,
): string | null {
  for (const surface of Object.values(doc.surfacesById)) {
    if (
      surface.kind === "browser" &&
      surface.input.environmentId === input.environmentId &&
      surface.input.projectId === input.projectId
    ) {
      return surface.id;
    }
  }
  return null;
}

export function findMatchingEditorSurfaceId(
  doc: WorkspaceDocumentNiri,
  input: EditorSurfaceInput,
): string | null {
  for (const surface of Object.values(doc.surfacesById)) {
    if (
      surface.kind === "editor" &&
      surface.input.environmentId === input.environmentId &&
      surface.input.projectId === input.projectId
    ) {
      return surface.id;
    }
  }
  return null;
}

// ── Focus ─────────────────���────────────────────────────────────────────

export function setFocusedWindow(
  doc: WorkspaceDocumentNiri,
  windowId: string | null,
): WorkspaceDocumentNiri {
  if (!windowId) {
    if (doc.focusedWindowId === null && doc.focusedColumnIndex === -1) return doc;
    return { ...doc, focusedWindowId: null, focusedColumnIndex: -1 };
  }
  const colIdx = findColumnIndexByWindowId(doc, windowId);
  const nextColIdx = colIdx >= 0 ? colIdx : doc.focusedColumnIndex;
  if (
    doc.focusedWindowId === windowId &&
    doc.focusedColumnIndex === nextColIdx &&
    doc.mobileActiveWindowId === windowId
  ) {
    return doc;
  }
  return {
    ...doc,
    focusedWindowId: windowId,
    focusedColumnIndex: nextColIdx,
    mobileActiveWindowId: windowId,
  };
}

export function focusSurfaceById(
  doc: WorkspaceDocumentNiri,
  surfaceId: string,
): WorkspaceDocumentNiri {
  const located = getWindowBySurfaceId(doc, surfaceId);
  if (!located) return doc;

  // Check if already focused — avoid creating new objects
  const alreadyActive = located.window.activeTabId === surfaceId;
  const colIdx = findColumnIndexByWindowId(doc, located.windowId);
  const nextColIdx = colIdx >= 0 ? colIdx : doc.focusedColumnIndex;
  if (
    alreadyActive &&
    doc.focusedWindowId === located.windowId &&
    doc.focusedColumnIndex === nextColIdx &&
    doc.mobileActiveWindowId === located.windowId
  ) {
    return doc;
  }

  const nextWindow = alreadyActive
    ? located.window
    : { ...located.window, activeTabId: surfaceId };

  const next = alreadyActive
    ? doc
    : {
        ...doc,
        windowsById: { ...doc.windowsById, [located.windowId]: nextWindow },
      };
  return setFocusedWindow(next, located.windowId);
}

export function focusColumn(
  doc: WorkspaceDocumentNiri,
  columnIndex: number,
): WorkspaceDocumentNiri {
  if (columnIndex < 0 || columnIndex >= doc.columns.length) return doc;
  const col = doc.columns[columnIndex]!;
  const windowId =
    col.windowIds.length > 0 ? (col.windowIds[0] ?? null) : null;
  // Try to keep the previously focused window if it's in this column
  if (doc.focusedWindowId && col.windowIds.includes(doc.focusedWindowId)) {
    return {
      ...doc,
      focusedColumnIndex: columnIndex,
      mobileActiveWindowId: doc.focusedWindowId,
    };
  }
  return {
    ...doc,
    focusedColumnIndex: columnIndex,
    focusedWindowId: windowId,
    mobileActiveWindowId: windowId,
  };
}

export function focusAdjacentColumn(
  doc: WorkspaceDocumentNiri,
  direction: "left" | "right",
): WorkspaceDocumentNiri {
  if (doc.columns.length <= 1) return doc;
  const current = Math.max(0, doc.focusedColumnIndex);
  const next =
    direction === "left"
      ? Math.max(0, current - 1)
      : Math.min(doc.columns.length - 1, current + 1);
  if (next === current) return doc;
  return focusColumn(doc, next);
}

export function focusAdjacentWindowInColumn(
  doc: WorkspaceDocumentNiri,
  direction: "up" | "down",
): WorkspaceDocumentNiri {
  const windowId = firstWindowId(doc);
  if (!windowId) return doc;
  const found = findColumnByWindowId(doc, windowId);
  if (!found) return doc;
  const { column } = found;
  const currentIdx = column.windowIds.indexOf(windowId);
  if (currentIdx < 0) return doc;
  const nextIdx =
    direction === "up"
      ? Math.max(0, currentIdx - 1)
      : Math.min(column.windowIds.length - 1, currentIdx + 1);
  if (nextIdx === currentIdx) return doc;
  const nextWindowId = column.windowIds[nextIdx]!;
  return setFocusedWindow(doc, nextWindowId);
}

export function focusWindowByStep(
  doc: WorkspaceDocumentNiri,
  step: -1 | 1,
): WorkspaceDocumentNiri {
  const windowIds = getOrderedWindowIds(doc);
  if (windowIds.length <= 1) return doc;
  const currentWindowId = firstWindowId(doc);
  if (!currentWindowId) return doc;
  const currentIndex = windowIds.indexOf(currentWindowId);
  if (currentIndex < 0) return doc;
  const nextIndex = (currentIndex + step + windowIds.length) % windowIds.length;
  return setFocusedWindow(doc, windowIds[nextIndex] ?? null);
}

// ── Insert ─────────────────────────────────────────────────────────────

export function insertSurfaceIntoWindow(
  doc: WorkspaceDocumentNiri,
  windowId: string | null,
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocumentNiri {
  // If no window exists, create a new column with a new window
  if (!windowId || !doc.windowsById[windowId]) {
    const newWindowId = nextId("window");
    const newColId = nextId("col");
    const newWindow: WorkspaceWindow = {
      id: newWindowId,
      tabIds: [surface.id],
      activeTabId: surface.id,
    };
    const newCol: WorkspaceColumn = {
      id: newColId,
      windowIds: [newWindowId],
      sizes: [1.0],
      width: NIRI_DEFAULT_COLUMN_WIDTH,
      sizingMode: "auto",
    };
    const insertIndex = Math.max(0, doc.focusedColumnIndex + 1);
    const nextColumns = [
      ...doc.columns.slice(0, insertIndex),
      newCol,
      ...doc.columns.slice(insertIndex),
    ];
    return {
      ...doc,
      columns: nextColumns,
      focusedColumnIndex: insertIndex,
      focusedWindowId: newWindowId,
      mobileActiveWindowId: newWindowId,
      windowsById: { ...doc.windowsById, [newWindowId]: newWindow },
      surfacesById: { ...doc.surfacesById, [surface.id]: surface },
    };
  }

  // Add as new tab to existing window
  const currentWindow = doc.windowsById[windowId]!;
  const nextWindow = cloneWindow(currentWindow);
  nextWindow.tabIds.push(surface.id);
  nextWindow.activeTabId = surface.id;

  return setFocusedWindow(
    {
      ...doc,
      windowsById: { ...doc.windowsById, [windowId]: nextWindow },
      surfacesById: { ...doc.surfacesById, [surface.id]: surface },
    },
    windowId,
  );
}

export function addColumnAfter(
  doc: WorkspaceDocumentNiri,
  afterIndex: number,
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocumentNiri {
  const newWindowId = nextId("window");
  const newColId = nextId("col");
  const newWindow: WorkspaceWindow = {
    id: newWindowId,
    tabIds: [surface.id],
    activeTabId: surface.id,
  };
  const newCol: WorkspaceColumn = {
    id: newColId,
    windowIds: [newWindowId],
    sizes: [1.0],
    width: NIRI_DEFAULT_COLUMN_WIDTH,
    sizingMode: "auto",
  };
  const insertIndex = afterIndex + 1;
  const nextColumns = [
    ...doc.columns.slice(0, insertIndex),
    newCol,
    ...doc.columns.slice(insertIndex),
  ];
  return {
    ...doc,
    columns: nextColumns,
    focusedColumnIndex: insertIndex,
    focusedWindowId: newWindowId,
    mobileActiveWindowId: newWindowId,
    windowsById: { ...doc.windowsById, [newWindowId]: newWindow },
    surfacesById: { ...doc.surfacesById, [surface.id]: surface },
  };
}

export function addColumnBefore(
  doc: WorkspaceDocumentNiri,
  beforeIndex: number,
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocumentNiri {
  const newWindowId = nextId("window");
  const newColId = nextId("col");
  const newWindow: WorkspaceWindow = {
    id: newWindowId,
    tabIds: [surface.id],
    activeTabId: surface.id,
  };
  const newCol: WorkspaceColumn = {
    id: newColId,
    windowIds: [newWindowId],
    sizes: [1.0],
    width: NIRI_DEFAULT_COLUMN_WIDTH,
    sizingMode: "auto",
  };
  const insertIndex = Math.max(0, beforeIndex);
  const nextColumns = [
    ...doc.columns.slice(0, insertIndex),
    newCol,
    ...doc.columns.slice(insertIndex),
  ];
  // Adjust focused column index since we inserted before
  const adjustedFocusedIndex =
    doc.focusedColumnIndex >= insertIndex
      ? doc.focusedColumnIndex + 1
      : doc.focusedColumnIndex;
  return {
    ...doc,
    columns: nextColumns,
    focusedColumnIndex: insertIndex,
    focusedWindowId: newWindowId,
    mobileActiveWindowId: newWindowId,
    windowsById: { ...doc.windowsById, [newWindowId]: newWindow },
    surfacesById: { ...doc.surfacesById, [surface.id]: surface },
  };
}

export function addWindowToColumn(
  doc: WorkspaceDocumentNiri,
  columnIndex: number,
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocumentNiri {
  if (columnIndex < 0 || columnIndex >= doc.columns.length) {
    return insertSurfaceIntoWindow(doc, null, surface);
  }
  const col = doc.columns[columnIndex]!;
  const newWindowId = nextId("window");
  const newWindow: WorkspaceWindow = {
    id: newWindowId,
    tabIds: [surface.id],
    activeTabId: surface.id,
  };
  const nextCol = cloneColumn(col);
  nextCol.windowIds.push(newWindowId);
  nextCol.sizes = equalSizes(nextCol.windowIds.length);
  nextCol.sizingMode = "auto";

  const nextColumns = [...doc.columns];
  nextColumns[columnIndex] = nextCol;

  return {
    ...doc,
    columns: nextColumns,
    focusedColumnIndex: columnIndex,
    focusedWindowId: newWindowId,
    mobileActiveWindowId: newWindowId,
    windowsById: { ...doc.windowsById, [newWindowId]: newWindow },
    surfacesById: { ...doc.surfacesById, [surface.id]: surface },
  };
}

// ── Split (creates new column or new window in column) ─────────────────

export function splitWindowWithSurface(
  doc: WorkspaceDocumentNiri,
  sourceWindowId: string | null,
  axis: "x" | "y",
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocumentNiri {
  if (!sourceWindowId || !doc.windowsById[sourceWindowId]) {
    return insertSurfaceIntoWindow(doc, null, surface);
  }

  const found = findColumnByWindowId(doc, sourceWindowId);
  if (!found) {
    return insertSurfaceIntoWindow(doc, null, surface);
  }

  if (axis === "x") {
    // Horizontal split = new column to the right
    return addColumnAfter(doc, found.columnIndex, surface);
  }

  // Vertical split = new window below in same column
  return addWindowToColumn(doc, found.columnIndex, surface);
}

// ── Remove ─────────────────────────────────────────────────────────────

function removeWindowFromDoc(
  doc: WorkspaceDocumentNiri,
  windowId: string,
): WorkspaceDocumentNiri {
  const found = findColumnByWindowId(doc, windowId);
  if (!found) return doc;

  const { columnIndex, column } = found;
  const windowIdx = column.windowIds.indexOf(windowId);
  if (windowIdx < 0) return doc;

  // Remove surfaces
  const window = doc.windowsById[windowId];
  const nextSurfacesById = { ...doc.surfacesById };
  if (window) {
    for (const surfaceId of window.tabIds) {
      delete nextSurfacesById[surfaceId];
    }
  }

  // Remove window
  const nextWindowsById = { ...doc.windowsById };
  delete nextWindowsById[windowId];

  // Update column
  const nextCol = cloneColumn(column);
  nextCol.windowIds.splice(windowIdx, 1);
  nextCol.sizes = equalSizes(nextCol.windowIds.length);

  let nextColumns = [...doc.columns];
  let nextFocusedColumnIndex = doc.focusedColumnIndex;
  let nextFocusedWindowId: string | null = null;

  if (nextCol.windowIds.length === 0) {
    // Remove empty column
    nextColumns.splice(columnIndex, 1);
    if (nextFocusedColumnIndex >= nextColumns.length) {
      nextFocusedColumnIndex = Math.max(0, nextColumns.length - 1);
    } else if (nextFocusedColumnIndex > columnIndex) {
      nextFocusedColumnIndex -= 1;
    }
  } else {
    nextColumns[columnIndex] = nextCol;
  }

  // Determine next focused window
  if (nextColumns.length > 0) {
    const focusCol =
      nextColumns[Math.min(nextFocusedColumnIndex, nextColumns.length - 1)];
    if (focusCol && focusCol.windowIds.length > 0) {
      nextFocusedWindowId = focusCol.windowIds[0]!;
    }
  }

  return {
    ...doc,
    columns: nextColumns,
    focusedColumnIndex: nextFocusedColumnIndex,
    focusedWindowId: nextFocusedWindowId,
    mobileActiveWindowId: nextFocusedWindowId,
    windowsById: nextWindowsById,
    surfacesById: nextSurfacesById,
  };
}

export function closeSurfaceById(
  doc: WorkspaceDocumentNiri,
  surfaceId: string,
): WorkspaceDocumentNiri {
  const located = getWindowBySurfaceId(doc, surfaceId);
  if (!located) return doc;

  const nextWindow = cloneWindow(located.window);
  nextWindow.tabIds = nextWindow.tabIds.filter((id) => id !== surfaceId);
  if (nextWindow.activeTabId === surfaceId) {
    const closedIndex = located.window.tabIds.indexOf(surfaceId);
    nextWindow.activeTabId =
      nextWindow.tabIds[Math.min(closedIndex, nextWindow.tabIds.length - 1)] ??
      nextWindow.tabIds[0] ??
      null;
  }

  const nextSurfacesById = { ...doc.surfacesById };
  delete nextSurfacesById[surfaceId];

  if (nextWindow.tabIds.length > 0) {
    return setFocusedWindow(
      {
        ...doc,
        windowsById: { ...doc.windowsById, [located.windowId]: nextWindow },
        surfacesById: nextSurfacesById,
      },
      located.windowId,
    );
  }

  // Window is now empty — remove it
  return removeWindowFromDoc(
    { ...doc, surfacesById: nextSurfacesById },
    located.windowId,
  );
}

export function closeWindowById(
  doc: WorkspaceDocumentNiri,
  windowId: string,
): WorkspaceDocumentNiri {
  return removeWindowFromDoc(doc, windowId);
}

// ── Move / Reorder ─────────────────────────────────────────────────────

export function moveColumn(
  doc: WorkspaceDocumentNiri,
  direction: "left" | "right",
): WorkspaceDocumentNiri {
  const current = Math.max(0, doc.focusedColumnIndex);
  if (current < 0 || current >= doc.columns.length) return doc;
  const target =
    direction === "left" ? current - 1 : current + 1;
  if (target < 0 || target >= doc.columns.length) return doc;

  const nextColumns = [...doc.columns];
  const temp = nextColumns[current]!;
  nextColumns[current] = nextColumns[target]!;
  nextColumns[target] = temp;

  return {
    ...doc,
    columns: nextColumns,
    focusedColumnIndex: target,
  };
}

export function moveWindowInColumn(
  doc: WorkspaceDocumentNiri,
  direction: "up" | "down",
): WorkspaceDocumentNiri {
  const windowId = firstWindowId(doc);
  if (!windowId) return doc;
  const found = findColumnByWindowId(doc, windowId);
  if (!found) return doc;
  const { columnIndex, column } = found;
  const currentIdx = column.windowIds.indexOf(windowId);
  if (currentIdx < 0) return doc;

  const targetIdx = direction === "up" ? currentIdx - 1 : currentIdx + 1;
  if (targetIdx < 0 || targetIdx >= column.windowIds.length) return doc;

  const nextCol = cloneColumn(column);
  const temp = nextCol.windowIds[currentIdx]!;
  nextCol.windowIds[currentIdx] = nextCol.windowIds[targetIdx]!;
  nextCol.windowIds[targetIdx] = temp;
  // Swap sizes too
  const tempSize = nextCol.sizes[currentIdx]!;
  nextCol.sizes[currentIdx] = nextCol.sizes[targetIdx]!;
  nextCol.sizes[targetIdx] = tempSize;

  const nextColumns = [...doc.columns];
  nextColumns[columnIndex] = nextCol;

  return { ...doc, columns: nextColumns };
}

export function moveFocusedWindow(
  doc: WorkspaceDocumentNiri,
  direction: WorkspaceDirection,
): WorkspaceDocumentNiri {
  if (direction === "left" || direction === "right") {
    return moveColumn(doc, direction);
  }
  return moveWindowInColumn(doc, direction);
}

export function moveActiveTabToAdjacentWindow(
  doc: WorkspaceDocumentNiri,
  direction: WorkspaceDirection,
): WorkspaceDocumentNiri {
  const windowId = firstWindowId(doc);
  if (!windowId) return doc;

  const sourceWindow = doc.windowsById[windowId];
  if (!sourceWindow) return doc;
  const surfaceId = sourceWindow.activeTabId;
  if (!surfaceId) return doc;

  const found = findColumnByWindowId(doc, windowId);
  if (!found) return doc;

  if (direction === "left" || direction === "right") {
    // Move tab to adjacent column
    const targetColIdx =
      direction === "left"
        ? found.columnIndex - 1
        : found.columnIndex + 1;
    if (targetColIdx < 0 || targetColIdx >= doc.columns.length) return doc;
    const targetCol = doc.columns[targetColIdx]!;
    if (targetCol.windowIds.length === 0) return doc;
    const targetWindowId = targetCol.windowIds[0]!;
    const targetWindow = doc.windowsById[targetWindowId];
    if (!targetWindow) return doc;

    // Remove from source
    const nextSourceWindow = cloneWindow(sourceWindow);
    nextSourceWindow.tabIds = nextSourceWindow.tabIds.filter(
      (id) => id !== surfaceId,
    );
    if (nextSourceWindow.activeTabId === surfaceId) {
      const closedIdx = sourceWindow.tabIds.indexOf(surfaceId);
      nextSourceWindow.activeTabId =
        nextSourceWindow.tabIds[
          Math.min(closedIdx, nextSourceWindow.tabIds.length - 1)
        ] ??
        nextSourceWindow.tabIds[0] ??
        null;
    }

    // Add to target
    const nextTargetWindow = cloneWindow(targetWindow);
    nextTargetWindow.tabIds.push(surfaceId);
    nextTargetWindow.activeTabId = surfaceId;

    let next: WorkspaceDocumentNiri = {
      ...doc,
      windowsById: {
        ...doc.windowsById,
        [targetWindowId]: nextTargetWindow,
      },
    };

    if (nextSourceWindow.tabIds.length > 0) {
      next = {
        ...next,
        windowsById: {
          ...next.windowsById,
          [windowId]: nextSourceWindow,
        },
      };
    } else {
      // Source window is empty, remove it
      next = removeWindowFromDoc(
        {
          ...next,
          windowsById: {
            ...next.windowsById,
            [windowId]: nextSourceWindow,
          },
        },
        windowId,
      );
      // Re-add target window's updates since removeWindowFromDoc creates a new windowsById
      const currentTargetWindow = next.windowsById[targetWindowId];
      if (currentTargetWindow) {
        const updatedTarget = cloneWindow(currentTargetWindow);
        if (!updatedTarget.tabIds.includes(surfaceId)) {
          updatedTarget.tabIds.push(surfaceId);
        }
        updatedTarget.activeTabId = surfaceId;
        next = {
          ...next,
          windowsById: { ...next.windowsById, [targetWindowId]: updatedTarget },
        };
      }
    }

    return setFocusedWindow(next, targetWindowId);
  }

  // up/down: move tab to adjacent window in same column
  const { columnIndex, column } = found;
  const currentWindowIdx = column.windowIds.indexOf(windowId);
  if (currentWindowIdx < 0) return doc;
  const targetWindowIdx =
    direction === "up" ? currentWindowIdx - 1 : currentWindowIdx + 1;
  if (targetWindowIdx < 0 || targetWindowIdx >= column.windowIds.length)
    return doc;

  const targetWindowId = column.windowIds[targetWindowIdx]!;
  const targetWindow = doc.windowsById[targetWindowId];
  if (!targetWindow) return doc;

  // Remove from source
  const nextSourceWindow = cloneWindow(sourceWindow);
  nextSourceWindow.tabIds = nextSourceWindow.tabIds.filter(
    (id) => id !== surfaceId,
  );
  if (nextSourceWindow.activeTabId === surfaceId) {
    const closedIdx = sourceWindow.tabIds.indexOf(surfaceId);
    nextSourceWindow.activeTabId =
      nextSourceWindow.tabIds[
        Math.min(closedIdx, nextSourceWindow.tabIds.length - 1)
      ] ??
      nextSourceWindow.tabIds[0] ??
      null;
  }

  // Add to target
  const nextTargetWindow = cloneWindow(targetWindow);
  nextTargetWindow.tabIds.push(surfaceId);
  nextTargetWindow.activeTabId = surfaceId;

  let next: WorkspaceDocumentNiri = {
    ...doc,
    windowsById: {
      ...doc.windowsById,
      [targetWindowId]: nextTargetWindow,
    },
  };

  if (nextSourceWindow.tabIds.length > 0) {
    next = {
      ...next,
      windowsById: { ...next.windowsById, [windowId]: nextSourceWindow },
    };
  } else {
    next = removeWindowFromDoc(
      { ...next, windowsById: { ...next.windowsById, [windowId]: nextSourceWindow } },
      windowId,
    );
    // Ensure target window still has the surface
    const currentTargetWindow = next.windowsById[targetWindowId];
    if (currentTargetWindow) {
      const updatedTarget = cloneWindow(currentTargetWindow);
      if (!updatedTarget.tabIds.includes(surfaceId)) {
        updatedTarget.tabIds.push(surfaceId);
      }
      updatedTarget.activeTabId = surfaceId;
      next = {
        ...next,
        windowsById: { ...next.windowsById, [targetWindowId]: updatedTarget },
      };
    }
  }

  return setFocusedWindow(next, targetWindowId);
}

// ── Resize ─────────────────────────────────────────────────────────────

export function resizeColumn(
  doc: WorkspaceDocumentNiri,
  direction: WorkspaceDirection,
): WorkspaceDocumentNiri {
  const windowId = firstWindowId(doc);
  if (!windowId) return doc;
  const found = findColumnByWindowId(doc, windowId);
  if (!found) return doc;

  if (direction === "left" || direction === "right") {
    const { columnIndex, column } = found;
    const delta =
      direction === "right" ? NIRI_COLUMN_RESIZE_STEP : -NIRI_COLUMN_RESIZE_STEP;
    const newWidth = Math.min(
      NIRI_MAX_COLUMN_WIDTH,
      Math.max(NIRI_MIN_COLUMN_WIDTH, column.width + delta),
    );
    if (newWidth === column.width) return doc;

    const nextCol = { ...column, width: newWidth };
    const nextColumns = [...doc.columns];
    nextColumns[columnIndex] = nextCol;
    return { ...doc, columns: nextColumns };
  }

  // up/down: resize window height within column
  const { columnIndex, column } = found;
  if (column.windowIds.length <= 1) return doc;

  const windowIdx = column.windowIds.indexOf(windowId);
  if (windowIdx < 0) return doc;

  const sizes = normalizeWorkspaceSplitSizes(
    column.sizes,
    column.windowIds.length,
  );
  const neighborIdx = direction === "up" ? windowIdx - 1 : windowIdx + 1;
  if (neighborIdx < 0 || neighborIdx >= sizes.length) return doc;

  const delta = NIRI_WINDOW_RESIZE_STEP;
  const neighborSize = sizes[neighborIdx]!;
  const maxDelta = neighborSize - NIRI_MIN_WINDOW_HEIGHT_FRACTION;
  if (maxDelta <= 0) return doc;

  const actualDelta = Math.min(delta, maxDelta);
  const nextSizes = [...sizes];
  nextSizes[windowIdx] = sizes[windowIdx]! + actualDelta;
  nextSizes[neighborIdx] = neighborSize - actualDelta;

  const nextCol = {
    ...column,
    sizes: normalizeWorkspaceSplitSizes(nextSizes, column.windowIds.length),
    sizingMode: "manual" as const,
  };
  const nextColumns = [...doc.columns];
  nextColumns[columnIndex] = nextCol;
  return { ...doc, columns: nextColumns };
}

// ── Equalize ───────────────────────────────────────────────────────────

export function equalizeSplits(
  doc: WorkspaceDocumentNiri,
): WorkspaceDocumentNiri {
  if (doc.columns.length === 0) return doc;
  const nextColumns = doc.columns.map((col) => ({
    ...col,
    width: NIRI_DEFAULT_COLUMN_WIDTH,
    sizes: equalSizes(col.windowIds.length),
    sizingMode: "auto" as const,
  }));
  return { ...doc, columns: nextColumns };
}

// ── Zoom ───────────────────────────────────────────────────────────────
// Zoom is handled at the store level via zoomedWindowId — no document change needed.

// ── Place / Drop ───────────────────────────────────────────────────────

function detachSurfaceFromWindow(
  doc: WorkspaceDocumentNiri,
  surfaceId: string,
): {
  doc: WorkspaceDocumentNiri;
  sourceWindowId: string | null;
  surface: WorkspaceSurfaceInstance | null;
} {
  const surface = doc.surfacesById[surfaceId] ?? null;
  const located = getWindowBySurfaceId(doc, surfaceId);
  if (!surface || !located) {
    return { doc, sourceWindowId: null, surface };
  }

  const nextWindow = cloneWindow(located.window);
  nextWindow.tabIds = nextWindow.tabIds.filter((id) => id !== surfaceId);
  if (nextWindow.activeTabId === surfaceId) {
    const removedIndex = located.window.tabIds.indexOf(surfaceId);
    nextWindow.activeTabId =
      nextWindow.tabIds[Math.min(removedIndex, nextWindow.tabIds.length - 1)] ??
      nextWindow.tabIds[0] ??
      null;
  }

  if (nextWindow.tabIds.length > 0) {
    return {
      doc: {
        ...doc,
        windowsById: { ...doc.windowsById, [located.windowId]: nextWindow },
      },
      sourceWindowId: located.windowId,
      surface,
    };
  }

  // Window is empty — remove it
  return {
    doc: removeWindowFromDoc(
      { ...doc, windowsById: { ...doc.windowsById, [located.windowId]: nextWindow } },
      located.windowId,
    ),
    sourceWindowId: located.windowId,
    surface,
  };
}

export function placeSurface(
  doc: WorkspaceDocumentNiri,
  surfaceId: string,
  target: WorkspacePlacementTarget,
): WorkspaceDocumentNiri {
  if (target.kind === "tab") {
    const window = doc.windowsById[target.windowId];
    const targetIndex = window?.tabIds.indexOf(target.surfaceId) ?? -1;
    if (!window || targetIndex < 0) return doc;
    return moveSurfaceToTabIndex(doc, surfaceId, target.windowId, targetIndex);
  }

  if (target.placement === "center") {
    const window = doc.windowsById[target.windowId];
    if (!window) return doc;
    return moveSurfaceToTabIndex(
      doc,
      surfaceId,
      target.windowId,
      window.tabIds.length,
    );
  }

  // Edge placement: detach surface, then place at edge
  const detached = detachSurfaceFromWindow(doc, surfaceId);
  const surface = detached.surface;
  if (!surface) return doc;

  const { placement } = target;
  const targetFound = findColumnByWindowId(detached.doc, target.windowId);

  if (placement === "left") {
    if (!targetFound) return doc;
    return addColumnBefore(detached.doc, targetFound.columnIndex, surface);
  }
  if (placement === "right") {
    if (!targetFound) return doc;
    return addColumnAfter(detached.doc, targetFound.columnIndex, surface);
  }
  if (placement === "top" || placement === "bottom") {
    if (!targetFound) return doc;
    // Add window above/below in the same column
    const { columnIndex, column } = targetFound;
    const windowIdx = column.windowIds.indexOf(target.windowId);
    const newWindowId = nextId("window");
    const newWindow: WorkspaceWindow = {
      id: newWindowId,
      tabIds: [surface.id],
      activeTabId: surface.id,
    };
    const nextCol = cloneColumn(column);
    const insertIdx = placement === "top" ? windowIdx : windowIdx + 1;
    nextCol.windowIds.splice(insertIdx, 0, newWindowId);
    nextCol.sizes = equalSizes(nextCol.windowIds.length);
    nextCol.sizingMode = "auto";

    const nextColumns = [...detached.doc.columns];
    nextColumns[columnIndex] = nextCol;

    return setFocusedWindow(
      {
        ...detached.doc,
        columns: nextColumns,
        windowsById: { ...detached.doc.windowsById, [newWindowId]: newWindow },
        surfacesById: { ...detached.doc.surfacesById, [surface.id]: surface },
      },
      newWindowId,
    );
  }

  return doc;
}

function moveSurfaceToTabIndex(
  doc: WorkspaceDocumentNiri,
  surfaceId: string,
  targetWindowId: string,
  targetIndex: number,
): WorkspaceDocumentNiri {
  const targetWindow = doc.windowsById[targetWindowId];
  const source = getWindowBySurfaceId(doc, surfaceId);
  if (!targetWindow || !source) return doc;

  if (source.windowId === targetWindowId) {
    // Reorder within same window
    const fromIndex = source.window.tabIds.indexOf(surfaceId);
    if (fromIndex < 0) return doc;
    const filtered = source.window.tabIds.filter((id) => id !== surfaceId);
    const bounded = Math.max(0, Math.min(targetIndex, filtered.length));
    filtered.splice(bounded, 0, surfaceId);
    return setFocusedWindow(
      {
        ...doc,
        windowsById: {
          ...doc.windowsById,
          [targetWindowId]: {
            ...source.window,
            tabIds: filtered,
            activeTabId: surfaceId,
          },
        },
      },
      targetWindowId,
    );
  }

  // Cross-window move
  const detached = detachSurfaceFromWindow(doc, surfaceId);
  const nextTargetWindow = detached.doc.windowsById[targetWindowId];
  if (!nextTargetWindow) return doc;
  const nextTabIds = [...nextTargetWindow.tabIds];
  const bounded = Math.max(
    0,
    Math.min(targetIndex, nextTabIds.length),
  );
  nextTabIds.splice(bounded, 0, surfaceId);

  return setFocusedWindow(
    {
      ...detached.doc,
      windowsById: {
        ...detached.doc.windowsById,
        [targetWindowId]: {
          ...nextTargetWindow,
          tabIds: nextTabIds,
          activeTabId: surfaceId,
        },
      },
    },
    targetWindowId,
  );
}

// ── Set column split sizes (for drag resize of windows within a column) ──

export function setColumnWindowSizes(
  doc: WorkspaceDocumentNiri,
  columnId: string,
  sizes: number[],
): WorkspaceDocumentNiri {
  const colIdx = doc.columns.findIndex((c) => c.id === columnId);
  if (colIdx < 0) return doc;
  const col = doc.columns[colIdx]!;
  const nextSizes = normalizeWorkspaceSplitSizes(sizes, col.windowIds.length);
  const currentSizes = normalizeWorkspaceSplitSizes(
    col.sizes,
    col.windowIds.length,
  );
  const changed = currentSizes.some(
    (s, i) => Math.abs(s - (nextSizes[i] ?? 0)) > 0.001,
  );
  if (!changed) return doc;

  const nextCol = { ...col, sizes: nextSizes, sizingMode: "manual" as const };
  const nextColumns = [...doc.columns];
  nextColumns[colIdx] = nextCol;
  return { ...doc, columns: nextColumns };
}

// ── Set column width (for drag resize of column width) ─────────────────

export function setColumnWidth(
  doc: WorkspaceDocumentNiri,
  columnId: string,
  width: number,
): WorkspaceDocumentNiri {
  const colIdx = doc.columns.findIndex((c) => c.id === columnId);
  if (colIdx < 0) return doc;
  const col = doc.columns[colIdx]!;
  const clamped = Math.min(
    NIRI_MAX_COLUMN_WIDTH,
    Math.max(NIRI_MIN_COLUMN_WIDTH, width),
  );
  if (Math.abs(clamped - col.width) < 0.001) return doc;

  const nextCol = { ...col, width: clamped };
  const nextColumns = [...doc.columns];
  nextColumns[colIdx] = nextCol;
  return { ...doc, columns: nextColumns };
}

// ── Scroll ─────────────────────────────────────────────────────────────

export function getScrollTargetForColumn(
  doc: WorkspaceDocumentNiri,
  columnIndex: number,
  viewportWidth: number,
): number {
  if (columnIndex < 0 || columnIndex >= doc.columns.length || viewportWidth <= 0) {
    return 0;
  }

  // Calculate column left offset by summing widths of preceding columns
  let columnLeft = 0;
  for (let i = 0; i < columnIndex; i++) {
    columnLeft += doc.columns[i]!.width * viewportWidth;
  }
  const columnWidth = doc.columns[columnIndex]!.width * viewportWidth;

  // Center the column in the viewport
  const targetScroll = columnLeft - (viewportWidth - columnWidth) / 2;
  return Math.max(0, targetScroll);
}

// ── Migration ──────────────────────────────────────────────────────────

export function migrateSplitToNiri(
  doc: WorkspaceDocument,
): WorkspaceDocumentNiri {
  if (!doc.rootNodeId || !doc.nodesById[doc.rootNodeId]) {
    return {
      ...createEmptyNiriDocument(),
      windowsById: doc.windowsById,
      surfacesById: doc.surfacesById,
    };
  }

  const columns: WorkspaceColumn[] = [];

  function collectColumnFromNode(nodeId: string): void {
    const node = doc.nodesById[nodeId];
    if (!node) return;

    if (node.kind === "window") {
      // Single window → single column
      columns.push({
        id: nextId("col"),
        windowIds: [node.windowId],
        sizes: [1.0],
        width: NIRI_DEFAULT_COLUMN_WIDTH,
        sizingMode: "auto",
      });
      return;
    }

    // Split node
    if (node.axis === "x") {
      // Horizontal split → each child becomes its own column(s)
      for (const childId of node.childIds) {
        collectColumnFromNode(childId);
      }
    } else {
      // Vertical split → all children become windows in one column
      const windowIds: string[] = [];
      collectWindowsFromNode(node.childIds, windowIds);
      if (windowIds.length > 0) {
        columns.push({
          id: nextId("col"),
          windowIds,
          sizes: equalSizes(windowIds.length),
          width: NIRI_DEFAULT_COLUMN_WIDTH,
          sizingMode: "auto",
        });
      }
    }
  }

  function collectWindowsFromNode(
    childIds: string[],
    windowIds: string[],
  ): void {
    for (const childId of childIds) {
      const child = doc.nodesById[childId];
      if (!child) continue;
      if (child.kind === "window") {
        windowIds.push(child.windowId);
      } else if (child.axis === "y") {
        // Nested vertical split — flatten
        collectWindowsFromNode(child.childIds, windowIds);
      } else {
        // Nested horizontal split inside a vertical split — create separate columns
        // This is an edge case; for simplicity, flatten into the current collection
        // by recursing into the main function
        collectColumnFromNode(childId);
      }
    }
  }

  collectColumnFromNode(doc.rootNodeId);

  // Determine focused column
  let focusedColumnIndex = 0;
  if (doc.focusedWindowId) {
    const idx = columns.findIndex((col) =>
      col.windowIds.includes(doc.focusedWindowId!),
    );
    if (idx >= 0) focusedColumnIndex = idx;
  }

  // Each column gets the default niri width (not divided by count)
  for (const col of columns) {
    col.width = NIRI_DEFAULT_COLUMN_WIDTH;
  }

  return {
    version: 2,
    layoutEngine: "niri",
    columns,
    focusedColumnIndex,
    focusedWindowId: doc.focusedWindowId,
    mobileActiveWindowId: doc.mobileActiveWindowId,
    windowsById: doc.windowsById,
    surfacesById: doc.surfacesById,
    scrollOffset: 0,
  };
}
