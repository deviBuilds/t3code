import { useParams } from "@tanstack/react-router";
import { CodeXmlIcon, Columns2Icon, GlobeIcon, Rows2Icon, TerminalSquareIcon, XIcon } from "lucide-react";
import {
  Fragment,
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createThreadSelectorByRef } from "../../storeSelectors";
import { useStore } from "../../store";
import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { SidebarInset } from "../ui/sidebar";
import ChatView from "../ChatView";
import { useComposerDraftStore } from "../../composerDraftStore";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { ThreadTerminalSurface } from "./ThreadTerminalSurface";
import { useWorkspaceDragStore } from "../../workspace/dragStore";
import {
  useWorkspaceColumns,
  useWorkspaceFocusedColumnIndex,
  useWorkspaceFocusedWindowId,
  useWorkspaceMobileActiveWindowId,
  useWorkspaceRootNodeId,
  useWorkspaceStore,
  useWorkspaceSurface,
  useWorkspaceWindow,
  useWorkspaceWindowIds,
  useWorkspaceZoomedWindowId,
} from "../../workspace/store";
import {
  normalizeWorkspaceSplitSizes,
  type WorkspaceColumn,
  type WorkspaceDropPlacement,
  type WorkspacePlacementTarget,
  type WorkspaceSurfaceInstance,
} from "../../workspace/types";
import { NIRI_MIN_COLUMN_WIDTH, NIRI_MAX_COLUMN_WIDTH } from "../../workspace/niriLayout";
import { useEditorCwd } from "../../hooks/useEditorCwd";
import { useSidePanelStore } from "../../sidePanelStore";
import { EditorTabBar } from "../editor/EditorTabBar";

const BrowserPanel = lazy(() => import("../BrowserPanel"));
const EditorPanel = lazy(() => import("../EditorPanel"));

const WORKSPACE_MIN_PANE_SIZE_PX = 220;
const WORKSPACE_DROP_EDGE_THRESHOLD = 0.22;
const INTERACTIVE_PANE_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  "[contenteditable='true']",
  "[contenteditable='']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[draggable='true']",
  "[data-pane-autofocus-prevent='true']",
].join(", ");

function isWorkspaceDropTarget(
  value: WorkspaceDropPlacement | string | null,
  target: WorkspaceDropPlacement | string,
): boolean {
  return value === target;
}

function resolveWorkspaceDropPlacementFromPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): WorkspaceDropPlacement {
  if (rect.width <= 0 || rect.height <= 0) {
    return "center";
  }

  const normalizedX = (clientX - rect.left) / rect.width;
  const normalizedY = (clientY - rect.top) / rect.height;
  const distanceLeft = normalizedX;
  const distanceRight = 1 - normalizedX;
  const distanceTop = normalizedY;
  const distanceBottom = 1 - normalizedY;
  const minEdgeDistance = Math.min(distanceLeft, distanceRight, distanceTop, distanceBottom);

  if (minEdgeDistance > WORKSPACE_DROP_EDGE_THRESHOLD) {
    return "center";
  }

  if (minEdgeDistance === distanceLeft) {
    return "left";
  }
  if (minEdgeDistance === distanceRight) {
    return "right";
  }
  if (minEdgeDistance === distanceTop) {
    return "top";
  }
  return "bottom";
}

function workspaceDropPreviewClass(target: WorkspaceDropPlacement | string | null): string {
  switch (target) {
    case "left":
      return "left-2 top-2 bottom-2 w-1/2";
    case "right":
      return "right-2 top-2 bottom-2 w-1/2";
    case "top":
      return "left-2 right-2 top-2 h-1/2";
    case "bottom":
      return "left-2 right-2 bottom-2 h-1/2";
    case "center":
      return "inset-2";
    default:
      return "hidden";
  }
}

function shouldSuppressPaneActivationAutoFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest("[data-pane-autofocus-allow='true']")) {
    return false;
  }

  return target.closest(INTERACTIVE_PANE_TARGET_SELECTOR) !== null;
}

function applyWorkspaceDrop(params: {
  clearDragItem: () => void;
  dragItem:
    | {
        kind: "surface";
        surfaceId: string;
      }
    | {
        kind: "thread";
        input: Parameters<ReturnType<typeof useWorkspaceStore.getState>["placeThreadSurface"]>[0];
      };
  placeSurface: ReturnType<typeof useWorkspaceStore.getState>["placeSurface"];
  placeThreadSurface: ReturnType<typeof useWorkspaceStore.getState>["placeThreadSurface"];
  target: WorkspacePlacementTarget;
}) {
  if (params.dragItem.kind === "surface") {
    params.placeSurface(params.dragItem.surfaceId, params.target);
  } else {
    params.placeThreadSurface(params.dragItem.input, params.target);
  }
  params.clearDragItem();
}

function WorkspaceEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
        <p className="text-xl text-foreground">Pick a thread to continue</p>
        <p className="mt-2 text-sm text-muted-foreground/78">
          Select an existing thread or create a new one to get started.
        </p>
      </div>
    </div>
  );
}

export function WorkspaceShell() {
  const rootNodeId = useWorkspaceRootNodeId();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {rootNodeId ? <WorkspaceLayoutRoot /> : <WorkspaceRouteFallback />}
      </div>
    </SidebarInset>
  );
}

function WorkspaceRouteFallback() {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const openThreadSurface = useWorkspaceStore((state) => state.openThreadSurface);
  const draftSession = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );

  useEffect(() => {
    if (!routeTarget) {
      return;
    }

    if (routeTarget.kind === "server") {
      openThreadSurface(
        {
          scope: "server",
          threadRef: routeTarget.threadRef,
        },
        "focus-or-tab",
      );
      return;
    }

    if (!draftSession) {
      return;
    }

    openThreadSurface(
      {
        scope: "draft",
        draftId: routeTarget.draftId,
        environmentId: draftSession.environmentId,
        threadId: draftSession.threadId,
      },
      "focus-or-tab",
    );
  }, [draftSession, openThreadSurface, routeTarget]);

  if (!routeTarget) {
    return <WorkspaceEmptyState />;
  }

  if (routeTarget.kind === "server") {
    return (
      <ChatView
        environmentId={routeTarget.threadRef.environmentId}
        threadId={routeTarget.threadRef.threadId}
        routeKind="server"
      />
    );
  }

  if (!draftSession) {
    return <WorkspaceEmptyState />;
  }

  return (
    <ChatView
      draftId={routeTarget.draftId}
      environmentId={draftSession.environmentId}
      threadId={draftSession.threadId}
      routeKind="draft"
    />
  );
}

// ── Niri Layout Root ───────────────────────────────────────────────────

function WorkspaceLayoutRoot() {
  const columns = useWorkspaceColumns();
  const focusedColumnIndex = useWorkspaceFocusedColumnIndex();
  const focusedWindowId = useWorkspaceFocusedWindowId();
  const mobileActiveWindowId = useWorkspaceMobileActiveWindowId();
  const windowIds = useWorkspaceWindowIds();
  const zoomedWindowId = useWorkspaceZoomedWindowId();
  const setMobileActiveWindow = useWorkspaceStore((state) => state.setMobileActiveWindow);
  const isDesktopViewport = useMediaQuery("md");
  const activeWindowId =
    zoomedWindowId ?? mobileActiveWindowId ?? focusedWindowId ?? windowIds[0] ?? null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {windowIds.length > 1 ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          {windowIds.map((windowId, index) => {
            const isActive = (mobileActiveWindowId ?? focusedWindowId ?? windowIds[0]) === windowId;
            return (
              <button
                key={windowId}
                type="button"
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  isActive
                    ? "border-border bg-accent text-foreground"
                    : "border-border/60 text-muted-foreground",
                )}
                onClick={() => setMobileActiveWindow(windowId)}
              >
                Window {index + 1}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {isDesktopViewport ? (
          zoomedWindowId ? (
            <WorkspaceWindowView windowId={zoomedWindowId} />
          ) : (
            <NiriScrollContainer
              columns={columns}
              focusedColumnIndex={focusedColumnIndex}
            />
          )
        ) : (
          <MobileWorkspaceWindow windowId={activeWindowId} />
        )}
      </div>
    </div>
  );
}

const MobileWorkspaceWindow = memo(function MobileWorkspaceWindow(props: {
  windowId: string | null;
}) {
  const window = useWorkspaceWindow(props.windowId);

  if (!props.windowId) {
    return <WorkspaceEmptyState />;
  }

  if (!window) {
    return <WorkspaceEmptyState />;
  }

  return <WorkspaceWindowView windowId={window.id} />;
});

// ── Niri Scroll Container ──────────────────────────────────────────────

const NiriScrollContainer = memo(function NiriScrollContainer(props: {
  columns: WorkspaceColumn[];
  focusedColumnIndex: number;
}) {
  const { columns, focusedColumnIndex } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width via ResizeObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Compute pixel widths for each column
  const columnPixelWidths = useMemo(() => {
    if (containerWidth <= 0) return columns.map(() => 0);
    const pixelWidths = columns.map((col) =>
      Math.max(NIRI_COLUMN_MIN_WIDTH_PX, col.width * containerWidth),
    );
    const total = pixelWidths.reduce((sum, w) => sum + w, 0);
    // Single column: stretch to fill viewport
    if (columns.length === 1 || total <= containerWidth) {
      const scale = containerWidth / Math.max(total, 1);
      return pixelWidths.map((w) => w * scale);
    }
    return pixelWidths;
  }, [columns, containerWidth]);

  // Scroll to center the focused column using native scrollTo
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || containerWidth <= 0 || focusedColumnIndex < 0 || focusedColumnIndex >= columns.length) {
      return;
    }

    let columnLeft = 0;
    for (let i = 0; i < focusedColumnIndex; i++) {
      columnLeft += columnPixelWidths[i]!;
    }
    const columnWidth = columnPixelWidths[focusedColumnIndex]!;

    // Center the focused column
    const target = columnLeft - (containerWidth - columnWidth) / 2;
    el.scrollTo({ left: target, behavior: "smooth" });
  }, [columns, focusedColumnIndex, containerWidth, columnPixelWidths]);

  return (
    <div
      ref={scrollRef}
      className="niri-scroll-container relative h-full min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      style={{ scrollbarWidth: "none" }}
    >
      <style>{`.niri-scroll-container::-webkit-scrollbar { display: none; }`}</style>
      <div className="flex h-full flex-row" style={{ width: "max-content" }}>
        {columns.map((column, index) => (
          <NiriColumnView
            key={column.id}
            column={column}
            columnIndex={index}
            pixelWidth={columnPixelWidths[index] ?? 0}
            isLast={index === columns.length - 1}
          />
        ))}
      </div>
    </div>
  );
});

// ── Niri Column View ───────────────────────────────────────────────────

const NIRI_COLUMN_MIN_WIDTH_PX = 280;

const NiriColumnView = memo(function NiriColumnView(props: {
  column: WorkspaceColumn;
  columnIndex: number;
  pixelWidth: number;
  isLast: boolean;
}) {
  const { column, columnIndex, pixelWidth, isLast } = props;
  const setColumnWindowSizes = useWorkspaceStore((state) => state.setColumnWindowSizes);
  const setColumnWidth = useWorkspaceStore((state) => state.setColumnWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{
    pointerId: number;
    handle: HTMLButtonElement;
    startX: number;
    startWidth: number;
    viewportWidth: number;
    rafId: number | null;
    pendingWidth: number;
  } | null>(null);

  const sizes = useMemo(
    () => normalizeWorkspaceSplitSizes(column.sizes, column.windowIds.length),
    [column.sizes, column.windowIds.length],
  );

  // Vertical resize state (windows within column)
  const vertResizeRef = useRef<{
    handle: HTMLButtonElement;
    handleIndex: number;
    pendingSizes: number[];
    pointerId: number;
    rafId: number | null;
    startCoordinate: number;
    startSizes: number[];
    totalPx: number;
  } | null>(null);

  const stopVertResize = useCallback(
    (pointerId: number) => {
      const state = vertResizeRef.current;
      if (!state) return;
      if (state.rafId !== null) {
        window.cancelAnimationFrame(state.rafId);
        setColumnWindowSizes(column.id, state.pendingSizes);
      }
      vertResizeRef.current = null;
      if (state.handle.hasPointerCapture(pointerId)) {
        state.handle.releasePointerCapture(pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [column.id, setColumnWindowSizes],
  );

  const handleVertResizePointerDown = useCallback(
    (handleIndex: number, event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      const totalPx = container.clientHeight;
      if (totalPx <= 0) return;

      event.preventDefault();
      event.stopPropagation();
      vertResizeRef.current = {
        handle: event.currentTarget,
        handleIndex,
        pendingSizes: sizes,
        pointerId: event.pointerId,
        rafId: null,
        startCoordinate: event.clientY,
        startSizes: sizes,
        totalPx,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [sizes],
  );

  const handleVertResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = vertResizeRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaPx = event.clientY - state.startCoordinate;
      const deltaFraction = deltaPx / state.totalPx;
      const pairTotal = state.startSizes[state.handleIndex]! + state.startSizes[state.handleIndex + 1]!;
      const requestedMin = WORKSPACE_MIN_PANE_SIZE_PX / state.totalPx;
      const minFraction = Math.min(requestedMin, Math.max(pairTotal / 2 - 0.001, 0));

      const nextBefore = Math.min(
        pairTotal - minFraction,
        Math.max(minFraction, state.startSizes[state.handleIndex]! + deltaFraction),
      );
      const nextAfter = pairTotal - nextBefore;
      const nextSizes = [...state.startSizes];
      nextSizes[state.handleIndex] = nextBefore;
      nextSizes[state.handleIndex + 1] = nextAfter;
      state.pendingSizes = nextSizes;

      if (state.rafId !== null) return;
      state.rafId = window.requestAnimationFrame(() => {
        const active = vertResizeRef.current;
        if (!active) return;
        active.rafId = null;
        setColumnWindowSizes(column.id, active.pendingSizes);
      });
    },
    [column.id, setColumnWindowSizes],
  );

  const endVertResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = vertResizeRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      stopVertResize(event.pointerId);
    },
    [stopVertResize],
  );

  // Column width resize (horizontal handle on right edge)
  const handleColResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const parentContainer = containerRef.current?.parentElement;
      if (!parentContainer) return;
      const viewportWidth = parentContainer.clientWidth;
      if (viewportWidth <= 0) return;

      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        pointerId: event.pointerId,
        handle: event.currentTarget,
        startX: event.clientX,
        startWidth: column.width,
        viewportWidth,
        rafId: null,
        pendingWidth: column.width,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [column.width],
  );

  const handleColResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaPx = event.clientX - state.startX;
      const deltaFraction = deltaPx / state.viewportWidth;
      const nextWidth = Math.min(
        NIRI_MAX_COLUMN_WIDTH,
        Math.max(NIRI_MIN_COLUMN_WIDTH, state.startWidth + deltaFraction),
      );
      state.pendingWidth = nextWidth;

      if (state.rafId !== null) return;
      state.rafId = window.requestAnimationFrame(() => {
        const active = resizeStateRef.current;
        if (!active) return;
        active.rafId = null;
        setColumnWidth(column.id, active.pendingWidth);
      });
    },
    [column.id, setColumnWidth],
  );

  const endColResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      if (state.rafId !== null) {
        window.cancelAnimationFrame(state.rafId);
        setColumnWidth(column.id, state.pendingWidth);
      }
      resizeStateRef.current = null;
      if (state.handle.hasPointerCapture(event.pointerId)) {
        state.handle.releasePointerCapture(event.pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [column.id, setColumnWidth],
  );

  useEffect(() => {
    return () => {
      const vs = vertResizeRef.current;
      if (vs?.rafId !== null && vs) window.cancelAnimationFrame(vs.rafId);
      const cs = resizeStateRef.current;
      if (cs?.rafId !== null && cs) window.cancelAnimationFrame(cs.rafId);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  return (
    <div
      className="flex h-full min-h-0 shrink-0 flex-row"
      style={{
        width: `${pixelWidth}px`,
      }}
    >
      <div
        ref={containerRef}
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {column.windowIds.map((windowId, index) => (
          <Fragment key={windowId}>
            <div
              className="min-h-0 min-w-0 overflow-hidden"
              style={{
                flexBasis: 0,
                flexGrow: sizes[index] ?? 1,
                flexShrink: 1,
              }}
            >
              <WorkspaceWindowView windowId={windowId} />
            </div>
            {index < column.windowIds.length - 1 ? (
              <button
                type="button"
                className="relative z-10 h-1 w-full shrink-0 cursor-row-resize touch-none bg-border/80 transition hover:bg-foreground/40"
                aria-label="Resize panes vertically"
                title="Drag to resize panes"
                onPointerCancel={endVertResize}
                onPointerDown={(event) => handleVertResizePointerDown(index, event)}
                onPointerMove={handleVertResizePointerMove}
                onPointerUp={endVertResize}
              >
                <span className="pointer-events-none absolute top-1/2 left-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/90" />
              </button>
            ) : null}
          </Fragment>
        ))}
      </div>
      {/* Column resize handle (right edge) */}
      {!isLast ? (
        <button
          type="button"
          className="relative z-10 h-full w-1 shrink-0 cursor-col-resize touch-none bg-border/80 transition hover:bg-foreground/40"
          aria-label="Resize column width"
          title="Drag to resize column"
          onPointerCancel={endColResize}
          onPointerDown={handleColResizePointerDown}
          onPointerMove={handleColResizePointerMove}
          onPointerUp={endColResize}
        >
          <span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/90" />
        </button>
      ) : null}
    </div>
  );
});

// ── Window View (unchanged from before) ────────────────────────────────

const WorkspaceWindowView = memo(function WorkspaceWindowView(props: { windowId: string }) {
  const dragItem = useWorkspaceDragStore((state) => state.item);
  const clearDragItem = useWorkspaceDragStore((state) => state.clearItem);
  const focusWindow = useWorkspaceStore((state) => state.focusWindow);
  const focusTab = useWorkspaceStore((state) => state.focusTab);
  const closeSurface = useWorkspaceStore((state) => state.closeSurface);
  const placeSurface = useWorkspaceStore((state) => state.placeSurface);
  const placeThreadSurface = useWorkspaceStore((state) => state.placeThreadSurface);
  const splitWindowSurface = useWorkspaceStore((state) => state.splitWindowSurface);
  const window = useWorkspaceWindow(props.windowId);
  const activeSurface = useWorkspaceSurface(window?.activeTabId ?? null);
  const focusedWindowId = useWorkspaceFocusedWindowId();
  const [isWindowDragActive, setIsWindowDragActive] = useState(false);
  const [threadActivationFocusRequestId, setThreadActivationFocusRequestId] = useState(0);
  const [terminalActivationFocusRequestId, setTerminalActivationFocusRequestId] = useState(0);
  const [hoveredDropTarget, setHoveredDropTarget] = useState<
    WorkspaceDropPlacement | string | null
  >(null);
  const shouldAutoFocusOnActivationRef = useRef(true);
  const wasFocusedRef = useRef(focusedWindowId === props.windowId);
  const windowElementRef = useRef<HTMLElement | null>(null);
  const pendingFocusWindowFrameRef = useRef<number | null>(null);

  const resetHoveredDropTarget = useCallback(() => {
    setHoveredDropTarget(null);
  }, []);

  useEffect(() => {
    if (!dragItem) {
      setIsWindowDragActive(false);
      setHoveredDropTarget(null);
    }
  }, [dragItem]);

  useEffect(() => {
    return () => {
      if (pendingFocusWindowFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(pendingFocusWindowFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const isFocused = focusedWindowId === props.windowId;
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = isFocused;

    if (!isFocused || wasFocused || !activeSurface) {
      return;
    }

    const shouldAutoFocus = shouldAutoFocusOnActivationRef.current;
    shouldAutoFocusOnActivationRef.current = true;
    if (!shouldAutoFocus) {
      return;
    }

    const activeElement = document.activeElement;
    const windowElement = windowElementRef.current;
    if (
      activeElement instanceof HTMLElement &&
      windowElement &&
      !windowElement.contains(activeElement)
    ) {
      activeElement.blur();
    }

    if (activeSurface.kind === "thread") {
      setThreadActivationFocusRequestId((current) => current + 1);
      return;
    }

    setTerminalActivationFocusRequestId((current) => current + 1);
  }, [activeSurface, focusedWindowId, props.windowId]);

  const handleWindowDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!dragItem) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setIsWindowDragActive(true);
      setHoveredDropTarget(
        resolveWorkspaceDropPlacementFromPoint(
          event.currentTarget.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        ),
      );
    },
    [dragItem],
  );

  const handleWindowDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setIsWindowDragActive(false);
    setHoveredDropTarget(null);
  }, []);

  const handleDropTarget = useCallback(
    (target: WorkspacePlacementTarget) => (event: React.DragEvent<HTMLElement>) => {
      if (!dragItem) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      applyWorkspaceDrop({
        clearDragItem,
        dragItem,
        placeSurface,
        placeThreadSurface,
        target,
      });
      setIsWindowDragActive(false);
      setHoveredDropTarget(null);
    },
    [clearDragItem, dragItem, placeSurface, placeThreadSurface],
  );

  const handleDragOverTarget = useCallback(
    (hoverTarget: WorkspaceDropPlacement | string) => (event: React.DragEvent<HTMLElement>) => {
      if (!dragItem) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setHoveredDropTarget(hoverTarget);
    },
    [dragItem],
  );

  const handleWindowDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!dragItem) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const targetPlacement = resolveWorkspaceDropPlacementFromPoint(
        event.currentTarget.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      applyWorkspaceDrop({
        clearDragItem,
        dragItem,
        placeSurface,
        placeThreadSurface,
        target: {
          kind: "window",
          windowId: props.windowId,
          placement: targetPlacement,
        },
      });
      setIsWindowDragActive(false);
      setHoveredDropTarget(null);
    },
    [clearDragItem, dragItem, placeSurface, placeThreadSurface, props.windowId],
  );

  const handleTabDragStart = useCallback(
    (surfaceId: string) => (event: React.DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", surfaceId);
      useWorkspaceDragStore.getState().setItem({
        kind: "surface",
        surfaceId,
      });
      focusWindow(props.windowId);
      focusTab(props.windowId, surfaceId);
    },
    [focusTab, focusWindow, props.windowId],
  );

  const handleTabDragEnd = useCallback(() => {
    useWorkspaceDragStore.getState().clearItem();
    setHoveredDropTarget(null);
  }, []);

  if (!window) {
    return null;
  }

  return (
    <section
      ref={windowElementRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border/70 bg-background",
        focusedWindowId === props.windowId ? "ring-1 ring-border/80" : "",
      )}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) {
          shouldAutoFocusOnActivationRef.current = true;
          return;
        }
        const shouldSuppressAutoFocus = shouldSuppressPaneActivationAutoFocus(event.target);
        shouldAutoFocusOnActivationRef.current = !shouldSuppressAutoFocus;
        if (pendingFocusWindowFrameRef.current !== null) {
          globalThis.cancelAnimationFrame(pendingFocusWindowFrameRef.current);
          pendingFocusWindowFrameRef.current = null;
        }
        if (!shouldSuppressAutoFocus) {
          focusWindow(props.windowId);
          return;
        }
        pendingFocusWindowFrameRef.current = globalThis.requestAnimationFrame(() => {
          pendingFocusWindowFrameRef.current = null;
          focusWindow(props.windowId);
        });
      }}
    >
      <div className="flex min-w-0 items-center gap-1 border-b border-border/70 bg-muted/20 px-2 py-1.5">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md transition",
            isWorkspaceDropTarget(hoveredDropTarget, "tab-strip") ? "bg-accent/60" : "",
          )}
          onDragLeave={resetHoveredDropTarget}
          onDragOver={handleDragOverTarget("tab-strip")}
          onDrop={handleDropTarget({
            kind: "window",
            windowId: props.windowId,
            placement: "center",
          })}
        >
          {window.tabIds.map((surfaceId) => {
            return (
              <WorkspaceTabView
                key={surfaceId}
                closeSurface={closeSurface}
                focusTab={focusTab}
                handleDragOverTarget={handleDragOverTarget}
                handleDropTarget={handleDropTarget}
                handleTabDragEnd={handleTabDragEnd}
                handleTabDragStart={handleTabDragStart}
                hoveredDropTarget={hoveredDropTarget}
                resetHoveredDropTarget={resetHoveredDropTarget}
                surfaceId={surfaceId}
                windowId={props.windowId}
                isActive={window.activeTabId === surfaceId}
              />
            );
          })}
        </div>
        <div className="hidden items-center gap-1 md:flex">
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => splitWindowSurface(props.windowId, "x")}
            aria-label="Split active tab right"
            title="Split active tab right"
          >
            <Columns2Icon className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => splitWindowSurface(props.windowId, "y")}
            aria-label="Split active tab down"
            title="Split active tab down"
          >
            <Rows2Icon className="size-3.5" />
          </button>
        </div>
      </div>
      <div
        className={cn(
          "h-0.5 shrink-0 transition-colors",
          focusedWindowId === props.windowId ? "bg-primary" : "bg-transparent",
        )}
      />
      <div
        className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
        onDragLeave={handleWindowDragLeave}
        onDrop={handleWindowDrop}
        onDragOver={handleWindowDragOver}
      >
        {activeSurface ? (
          <WorkspaceSurfaceView
            activationFocusRequestId={
              activeSurface.kind === "thread"
                ? threadActivationFocusRequestId
                : terminalActivationFocusRequestId
            }
            surface={activeSurface}
            bindSharedComposerHandle={focusedWindowId === props.windowId}
          />
        ) : null}
        {dragItem && isWindowDragActive ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 bg-background/10" />
            <div
              className={cn(
                "pointer-events-none absolute z-20 rounded-lg border-2 border-primary/70 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-all",
                workspaceDropPreviewClass(hoveredDropTarget),
              )}
            />
          </>
        ) : null}
      </div>
    </section>
  );
});

// ── Tab View ───────────────────────────────────────────────────────────

const WorkspaceTabView = memo(function WorkspaceTabView(props: {
  closeSurface: (surfaceId: string) => void;
  focusTab: (windowId: string, surfaceId: string) => void;
  handleDragOverTarget: (
    hoverTarget: WorkspaceDropPlacement | string,
  ) => (event: React.DragEvent<HTMLElement>) => void;
  handleDropTarget: (
    target: WorkspacePlacementTarget,
  ) => (event: React.DragEvent<HTMLElement>) => void;
  handleTabDragEnd: () => void;
  handleTabDragStart: (surfaceId: string) => (event: React.DragEvent<HTMLElement>) => void;
  hoveredDropTarget: WorkspaceDropPlacement | string | null;
  isActive: boolean;
  resetHoveredDropTarget: () => void;
  surfaceId: string;
  windowId: string;
}) {
  const surface = useWorkspaceSurface(props.surfaceId);

  if (!surface) {
    return null;
  }

  return (
    <div
      className={cn(
        "group flex max-w-[18rem] min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-xs",
        props.isActive
          ? "border-border bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent/50",
        isWorkspaceDropTarget(props.hoveredDropTarget, props.surfaceId)
          ? "ring-1 ring-primary/50"
          : "",
      )}
      onDragLeave={props.resetHoveredDropTarget}
      onDragOver={props.handleDragOverTarget(props.surfaceId)}
      onDrop={props.handleDropTarget({
        kind: "tab",
        windowId: props.windowId,
        surfaceId: props.surfaceId,
      })}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        data-pane-autofocus-allow="true"
        draggable
        onClick={() => props.focusTab(props.windowId, props.surfaceId)}
        onDragEnd={props.handleTabDragEnd}
        onDragStart={props.handleTabDragStart(props.surfaceId)}
      >
        <WorkspaceSurfaceTitle surface={surface} />
      </button>
      <button
        type="button"
        draggable={false}
        className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-accent hover:text-foreground"
        onClick={() => props.closeSurface(props.surfaceId)}
        aria-label="Close tab"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
});

// ── Surface View ───────────────────────────────────────────────────────

const WorkspaceSurfaceView = memo(function WorkspaceSurfaceView(props: {
  activationFocusRequestId?: number;
  bindSharedComposerHandle?: boolean;
  surface: WorkspaceSurfaceInstance;
}) {
  if (props.surface.kind === "thread") {
    if (props.surface.input.scope === "server") {
      return (
        <ChatView
          {...(props.activationFocusRequestId === undefined
            ? {}
            : { activationFocusRequestId: props.activationFocusRequestId })}
          environmentId={props.surface.input.threadRef.environmentId}
          threadId={props.surface.input.threadRef.threadId}
          routeKind="server"
          {...(props.bindSharedComposerHandle === undefined
            ? {}
            : { bindSharedComposerHandle: props.bindSharedComposerHandle })}
        />
      );
    }

    return (
      <ChatView
        {...(props.activationFocusRequestId === undefined
          ? {}
          : { activationFocusRequestId: props.activationFocusRequestId })}
        draftId={props.surface.input.draftId}
        environmentId={props.surface.input.environmentId}
        threadId={props.surface.input.threadId}
        routeKind="draft"
        {...(props.bindSharedComposerHandle === undefined
          ? {}
          : { bindSharedComposerHandle: props.bindSharedComposerHandle })}
      />
    );
  }

  if (props.surface.kind === "terminal") {
    return (
      <ThreadTerminalSurface
        surfaceId={props.surface.id}
        terminalId={props.surface.input.terminalId}
        threadRef={props.surface.input.threadRef}
        {...(props.activationFocusRequestId === undefined
          ? {}
          : { activationFocusRequestId: props.activationFocusRequestId })}
      />
    );
  }

  if (props.surface.kind === "browser") {
    return (
      <WorkspaceBrowserSurface
        surfaceId={props.surface.id}
        projectId={props.surface.input.projectId}
      />
    );
  }

  if (props.surface.kind === "editor") {
    return (
      <WorkspaceEditorSurface
        surfaceId={props.surface.id}
        environmentId={props.surface.input.environmentId}
        projectId={props.surface.input.projectId}
      />
    );
  }

  return null;
});

// ── Browser / Editor Surface Wrappers ──────────────────────────────────

const WorkspaceBrowserSurface = memo(function WorkspaceBrowserSurface(props: {
  surfaceId: string;
  projectId: string;
}) {
  const store = useSidePanelStore;
  const addTab = store((s) => s.addTab);

  // Use surfaceId as the store key so each browser surface has independent tabs
  const storeKey = `ws-browser:${props.surfaceId}`;

  useEffect(() => {
    // Temporarily set activeProjectId to our key so addTab writes to the right slot
    store.setState({ activeProjectId: storeKey });
    const s = store.getState();
    const projectState = s.browserStateByProjectId[storeKey];
    if (!projectState || projectState.tabs.length === 0) {
      addTab();
    }
  }, [storeKey, addTab]);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading browser...
          </div>
        }
      >
        <BrowserPanel layout="sidebar" storeKey={storeKey} />
      </Suspense>
    </div>
  );
});

const EMPTY_EDITOR_TABS: import("../../sidePanelStore").EditorTab[] = [];

const WorkspaceEditorSurface = memo(function WorkspaceEditorSurface(props: {
  surfaceId: string;
  environmentId: string;
  projectId: string;
}) {
  const store = useSidePanelStore;
  const storeKey = `ws-editor:${props.surfaceId}`;

  const scopeStore = useCallback(() => {
    store.setState({ activeProjectId: storeKey });
  }, [storeKey]);

  const editorTabs = store(
    (s) => s.editorStateByProjectId[storeKey]?.tabs ?? EMPTY_EDITOR_TABS,
  );
  const activeEditorTabId = store(
    (s) => s.editorStateByProjectId[storeKey]?.activeTabId ?? null,
  );
  const rawSetActiveEditorTab = store((s) => s.setActiveEditorTab);
  const rawCloseEditorTab = store((s) => s.closeEditorTab);
  const rawPinEditorTab = store((s) => s.pinEditorTab);
  const setActiveEditorTab = useCallback((tabId: string) => { scopeStore(); rawSetActiveEditorTab(tabId); }, [scopeStore, rawSetActiveEditorTab]);
  const closeEditorTab = useCallback((tabId: string) => { scopeStore(); rawCloseEditorTab(tabId); }, [scopeStore, rawCloseEditorTab]);
  const pinEditorTab = useCallback((tabId: string) => { scopeStore(); rawPinEditorTab(tabId); }, [scopeStore, rawPinEditorTab]);

  const envId = props.environmentId as import("@t3tools/contracts").EnvironmentId;
  const cwd = useEditorCwd(envId, props.projectId, null);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {editorTabs.length > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-card/60 px-1.5">
          <EditorTabBar
            tabs={editorTabs}
            activeTabId={activeEditorTabId}
            onActivate={setActiveEditorTab}
            onClose={closeEditorTab}
            onPin={pinEditorTab}
          />
        </div>
      )}
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading editor...
          </div>
        }
      >
        <EditorPanel environmentId={envId} cwd={cwd} storeKey={storeKey} />
      </Suspense>
    </div>
  );
});

// ── Surface Titles ─────────────────────────────────────────────────────

function WorkspaceSurfaceTitle(props: { surface: WorkspaceSurfaceInstance }) {
  if (props.surface.kind === "terminal") {
    return <TerminalSurfaceTitle threadRef={props.surface.input.threadRef} />;
  }

  if (props.surface.kind === "browser") {
    return (
      <AttachedSurfaceTitle
        icon={<GlobeIcon className="size-3 shrink-0" />}
        label="Browser"
        environmentId={props.surface.input.environmentId}
      />
    );
  }

  if (props.surface.kind === "editor") {
    return (
      <AttachedSurfaceTitle
        icon={<CodeXmlIcon className="size-3 shrink-0" />}
        label="Editor"
        environmentId={props.surface.input.environmentId}
      />
    );
  }

  return <ThreadSurfaceTitle surface={props.surface} />;
}

function ThreadSurfaceTitle(props: {
  surface: Extract<WorkspaceSurfaceInstance, { kind: "thread" }>;
}) {
  const thread = useStore(
    useMemo(
      () =>
        createThreadSelectorByRef(
          props.surface.input.scope === "server" ? props.surface.input.threadRef : null,
        ),
      [props.surface.input],
    ),
  );
  if (props.surface.input.scope === "server") {
    return <>{thread?.title ?? props.surface.input.threadRef.threadId}</>;
  }

  return <>{thread?.title ?? props.surface.input.threadId ?? "Draft thread"}</>;
}

function TerminalSurfaceTitle(props: {
  threadRef: Extract<WorkspaceSurfaceInstance, { kind: "terminal" }>["input"]["threadRef"];
}) {
  const thread = useStore(
    useMemo(() => createThreadSelectorByRef(props.threadRef), [props.threadRef]),
  );
  const label = thread?.title ?? props.threadRef.threadId;

  return (
    <span className="inline-flex items-center gap-1">
      <TerminalSquareIcon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function AttachedSurfaceTitle(props: {
  icon: ReactNode;
  label: string;
  environmentId: string;
}) {
  const document = useWorkspaceStore((s) => s.document);
  const threadRef = useMemo(() => {
    for (const surface of Object.values(document.surfacesById)) {
      if (
        surface.kind === "thread" &&
        surface.input.scope === "server" &&
        surface.input.threadRef.environmentId === props.environmentId
      ) {
        return surface.input.threadRef;
      }
    }
    return null;
  }, [document.surfacesById, props.environmentId]);

  const thread = useStore(
    useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]),
  );
  const threadLabel = thread?.title ?? threadRef?.threadId;

  return (
    <span className="inline-flex items-center gap-1">
      {props.icon}
      <span className="truncate">{props.label}</span>
      {threadLabel && (
        <>
          <span className="text-muted-foreground/60">·</span>
          <span className="truncate text-muted-foreground">{threadLabel}</span>
        </>
      )}
    </span>
  );
}
