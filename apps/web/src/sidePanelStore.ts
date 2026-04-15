/**
 * Zustand store for the unified right side panel.
 *
 * Browser tab state is scoped per project — switching threads across
 * projects swaps the visible tabs. History and favorites are global.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SidePanelMode = "browser" | "editor";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  favicon: string | null;
  visitedAt: string; // ISO timestamp
}

export interface FavoriteFolder {
  id: string;
  name: string;
  entries: BrowserHistoryEntry[];
  collapsed: boolean;
}

interface ProjectBrowserState {
  tabs: BrowserTab[];
  activeTabId: string | null;
}

export interface EditorTab {
  id: string;
  relativePath: string;
  /** false = "preview" tab (single-click). true = "pinned" tab (double-click). */
  pinned: boolean;
}

interface ProjectEditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
}

interface SidePanelState {
  open: boolean;
  mode: SidePanelMode;
  browserStateByProjectId: Record<string, ProjectBrowserState>;
  editorStateByProjectId: Record<string, ProjectEditorState>;
  favorites: BrowserHistoryEntry[];
  favoriteFolders: FavoriteFolder[];
  history: BrowserHistoryEntry[];
}

const SIDE_PANEL_STORAGE_KEY = "t3code:side-panel-state:v2";
const LEGACY_KEYS = ["t3code:side-panel-state:v1", "t3code:browser-panel-state:v1"];
const DEFAULT_HOME_URL = "about:blank";
const MAX_HISTORY_ENTRIES = 200;

// Clean up legacy localStorage keys from old store versions
if (typeof window !== "undefined") {
  for (const key of LEGACY_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

let tabIdCounter = 0;

function nextTabId(): string {
  tabIdCounter += 1;
  return `browser-tab-${Date.now()}-${tabIdCounter}`;
}

/** Derive a favicon URL from a site URL. Exported for component use. */
export function faviconUrlForSite(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "about:" || parsed.protocol === "data:") return null;
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/** Coerce a value to a valid URL string, or return null if invalid. */
function coerceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw === "" || raw === "undefined" || raw === "[object Object]") return null;
  return raw;
}

const EMPTY_PROJECT_BROWSER: ProjectBrowserState = Object.freeze({
  tabs: [] as BrowserTab[],
  activeTabId: null,
});

function getProjectBrowser(
  stateMap: Record<string, ProjectBrowserState>,
  projectId: string | null,
): ProjectBrowserState {
  if (!projectId) return EMPTY_PROJECT_BROWSER;
  return stateMap[projectId] ?? EMPTY_PROJECT_BROWSER;
}

function isValidTabUrl(url: unknown): boolean {
  return typeof url === "string" && url !== "[object Object]" && url !== "undefined" && url !== "";
}

/**
 * Sanitize browser state map once (on hydration), removing tabs with
 * corrupted URLs. Must NOT be called from selectors (would create new
 * references on every call → infinite Zustand re-render loop).
 */
function sanitizeBrowserStateMap(
  stateMap: Record<string, ProjectBrowserState>,
): Record<string, ProjectBrowserState> {
  let changed = false;
  const result: Record<string, ProjectBrowserState> = {};
  for (const [pid, pbs] of Object.entries(stateMap)) {
    const hasBad = pbs.tabs.some((t) => !isValidTabUrl(t.url));
    if (hasBad) {
      changed = true;
      const clean = pbs.tabs.filter((t) => isValidTabUrl(t.url));
      result[pid] = { tabs: clean, activeTabId: clean[0]?.id ?? null };
    } else {
      result[pid] = pbs;
    }
  }
  return changed ? result : stateMap;
}

function defaultTab(): BrowserTab {
  return { id: nextTabId(), url: DEFAULT_HOME_URL, title: "New Tab", favicon: null };
}

function ensureProjectHasTab(
  stateMap: Record<string, ProjectBrowserState>,
  projectId: string,
): Record<string, ProjectBrowserState> {
  const current = getProjectBrowser(stateMap, projectId);
  if (current.tabs.length > 0) return stateMap;
  const tab = defaultTab();
  return { ...stateMap, [projectId]: { tabs: [tab], activeTabId: tab.id } };
}

function updateProjectInMap(
  stateMap: Record<string, ProjectBrowserState>,
  projectId: string | null,
  updater: (pbs: ProjectBrowserState) => ProjectBrowserState,
): Record<string, ProjectBrowserState> {
  if (!projectId) return stateMap;
  const current = getProjectBrowser(stateMap, projectId);
  const next = updater(current);
  if (next === current) return stateMap;
  return { ...stateMap, [projectId]: next };
}

let folderIdCounter = 0;
function nextFolderId(): string {
  folderIdCounter += 1;
  return `fav-folder-${Date.now()}-${folderIdCounter}`;
}

let editorTabIdCounter = 0;
function nextEditorTabId(): string {
  editorTabIdCounter += 1;
  return `editor-tab-${Date.now()}-${editorTabIdCounter}`;
}

const EMPTY_PROJECT_EDITOR: ProjectEditorState = Object.freeze({
  tabs: [] as EditorTab[],
  activeTabId: null,
});

function getProjectEditor(
  stateMap: Record<string, ProjectEditorState>,
  projectId: string | null,
): ProjectEditorState {
  if (!projectId) return EMPTY_PROJECT_EDITOR;
  return stateMap[projectId] ?? EMPTY_PROJECT_EDITOR;
}

function updateProjectEditorInMap(
  stateMap: Record<string, ProjectEditorState>,
  projectId: string | null,
  updater: (pes: ProjectEditorState) => ProjectEditorState,
): Record<string, ProjectEditorState> {
  if (!projectId) return stateMap;
  const current = getProjectEditor(stateMap, projectId);
  const next = updater(current);
  if (next === current) return stateMap;
  return { ...stateMap, [projectId]: next };
}

export interface DesignModeAction {
  selector: string;
  tagName: string;
  outerHTML: string;
  description: string;
}

interface SidePanelStore extends SidePanelState {
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;

  pendingDesignAction: DesignModeAction | null;
  setPendingDesignAction: (action: DesignModeAction) => void;
  clearPendingDesignAction: () => void;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setMode: (mode: SidePanelMode) => void;

  addTab: (url?: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  navigateTab: (tabId: string, url: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  updateTabFavicon: (tabId: string, favicon: string | null) => void;

  addHistoryEntry: (entry: Omit<BrowserHistoryEntry, "visitedAt">) => void;
  updateHistoryEntryTitle: (url: string, title: string) => void;
  removeHistoryEntry: (url: string) => void;
  toggleFavorite: (entry: Omit<BrowserHistoryEntry, "visitedAt">) => void;
  clearHistory: () => void;

  // Folder actions
  addFavoriteFolder: (name: string) => void;
  renameFavoriteFolder: (folderId: string, name: string) => void;
  deleteFavoriteFolder: (folderId: string) => void;
  toggleFavoriteFolder: (folderId: string) => void;
  moveFavoriteToFolder: (url: string, folderId: string) => void;
  moveHistoryToFavorites: (
    entry: Omit<BrowserHistoryEntry, "visitedAt">,
    folderId?: string,
  ) => void;
  removeFavoriteFromFolder: (url: string, folderId: string) => void;

  // Editor actions
  openEditorFile: (relativePath: string) => void;
  pinEditorTab: (tabId: string) => void;
  closeEditorTab: (tabId: string) => void;
  setActiveEditorTab: (tabId: string) => void;
}

export const useSidePanelStore = create<SidePanelStore>()(
  persist(
    (set, get) => ({
      open: false,
      mode: "browser",
      browserStateByProjectId: {},
      editorStateByProjectId: {},
      favorites: [],
      favoriteFolders: [],
      history: [],
      activeProjectId: null,
      pendingDesignAction: null,
      setPendingDesignAction: (action) => set({ pendingDesignAction: action }),
      clearPendingDesignAction: () => set({ pendingDesignAction: null }),

      setActiveProjectId: (projectId) => {
        const s = get();
        if (projectId && s.open && s.mode === "browser") {
          set({
            activeProjectId: projectId,
            browserStateByProjectId: ensureProjectHasTab(s.browserStateByProjectId, projectId),
          });
        } else {
          set({ activeProjectId: projectId });
        }
      },

      toggle: () => {
        const s = get();
        if (s.open) {
          set({ open: false });
          return;
        }
        const pid = s.activeProjectId;
        if (s.mode === "browser" && pid) {
          set({
            open: true,
            browserStateByProjectId: ensureProjectHasTab(s.browserStateByProjectId, pid),
          });
        } else {
          set({ open: true });
        }
      },

      setOpen: (open) => {
        const s = get();
        if (open && s.mode === "browser" && s.activeProjectId) {
          set({
            open: true,
            browserStateByProjectId: ensureProjectHasTab(
              s.browserStateByProjectId,
              s.activeProjectId,
            ),
          });
        } else {
          set({ open });
        }
      },

      setMode: (mode) => {
        const s = get();
        if (mode === "browser" && s.activeProjectId) {
          set({
            mode,
            browserStateByProjectId: ensureProjectHasTab(
              s.browserStateByProjectId,
              s.activeProjectId,
            ),
          });
        } else {
          set({ mode });
        }
      },

      addTab: (url) => {
        const id = nextTabId();
        const resolvedUrl = url ?? DEFAULT_HOME_URL;
        let title: string;
        try {
          title = url ? new URL(url).hostname : "New Tab";
        } catch {
          title = "New Tab";
        }
        const newTab: BrowserTab = {
          id,
          url: resolvedUrl,
          title,
          favicon: faviconUrlForSite(resolvedUrl),
        };
        set((s) => ({
          mode: "browser",
          browserStateByProjectId: updateProjectInMap(
            s.browserStateByProjectId,
            s.activeProjectId,
            (pbs) => ({
              tabs: [...pbs.tabs, newTab],
              activeTabId: id,
            }),
          ),
        }));
      },

      closeTab: (tabId) => {
        set((s) => ({
          browserStateByProjectId: updateProjectInMap(
            s.browserStateByProjectId,
            s.activeProjectId,
            (pbs) => {
              const idx = pbs.tabs.findIndex((t) => t.id === tabId);
              if (idx < 0) return pbs;
              const remaining = pbs.tabs.filter((t) => t.id !== tabId);
              if (remaining.length === 0) return { tabs: [], activeTabId: null };
              const needsNew = pbs.activeTabId === tabId;
              return {
                tabs: remaining,
                activeTabId: needsNew
                  ? (remaining[Math.min(idx, remaining.length - 1)]?.id ?? null)
                  : pbs.activeTabId,
              };
            },
          ),
        }));
      },

      setActiveTab: (tabId) => {
        set((s) => ({
          browserStateByProjectId: updateProjectInMap(
            s.browserStateByProjectId,
            s.activeProjectId,
            (pbs) => {
              if (!pbs.tabs.some((t) => t.id === tabId)) return pbs;
              return { ...pbs, activeTabId: tabId };
            },
          ),
        }));
      },

      navigateTab: (tabId, rawUrl) => {
        const url = coerceUrl(rawUrl);
        if (!url) return;
        set((s) => ({
          browserStateByProjectId: updateProjectInMap(
            s.browserStateByProjectId,
            s.activeProjectId,
            (pbs) => ({
              ...pbs,
              tabs: pbs.tabs.map((t) => {
                if (t.id !== tabId) return t;
                let title: string;
                try {
                  title = new URL(url).hostname || url;
                } catch {
                  title = url;
                }
                return { ...t, url, title, favicon: faviconUrlForSite(url) };
              }),
            }),
          ),
        }));
      },

      updateTabTitle: (tabId, title) => {
        set((s) => ({
          browserStateByProjectId: updateProjectInMap(
            s.browserStateByProjectId,
            s.activeProjectId,
            (pbs) => ({
              ...pbs,
              tabs: pbs.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
            }),
          ),
        }));
      },

      updateTabFavicon: (tabId, favicon) => {
        set((s) => ({
          browserStateByProjectId: updateProjectInMap(
            s.browserStateByProjectId,
            s.activeProjectId,
            (pbs) => ({
              ...pbs,
              tabs: pbs.tabs.map((t) => (t.id === tabId ? { ...t, favicon } : t)),
            }),
          ),
        }));
      },

      addHistoryEntry: (entry) => {
        set((s) => {
          const newEntry: BrowserHistoryEntry = { ...entry, visitedAt: new Date().toISOString() };
          const filtered = s.history.filter((h) => h.url !== entry.url);
          return { history: [newEntry, ...filtered].slice(0, MAX_HISTORY_ENTRIES) };
        });
      },

      updateHistoryEntryTitle: (url, title) => {
        set((s) => {
          const idx = s.history.findIndex((h) => h.url === url);
          if (idx < 0 || s.history[idx]!.title === title) return s;
          const history = [...s.history];
          history[idx] = { ...history[idx]!, title };
          return { history };
        });
      },

      removeHistoryEntry: (url) => {
        set((s) => ({ history: s.history.filter((h) => h.url !== url) }));
      },

      toggleFavorite: (entry) => {
        set((s) => {
          const existsTopLevel = s.favorites.some((f) => f.url === entry.url);
          const existsInFolder = s.favoriteFolders.some((folder) =>
            folder.entries.some((e) => e.url === entry.url),
          );
          if (existsTopLevel) return { favorites: s.favorites.filter((f) => f.url !== entry.url) };
          if (existsInFolder) {
            return {
              favoriteFolders: s.favoriteFolders.map((folder) => ({
                ...folder,
                entries: folder.entries.filter((e) => e.url !== entry.url),
              })),
            };
          }
          return { favorites: [...s.favorites, { ...entry, visitedAt: new Date().toISOString() }] };
        });
      },

      clearHistory: () => set({ history: [] }),

      // ── Folder actions ──────────────────────────────────────────────

      addFavoriteFolder: (name) => {
        set((s) => ({
          favoriteFolders: [
            ...s.favoriteFolders,
            { id: nextFolderId(), name, entries: [], collapsed: false },
          ],
        }));
      },

      renameFavoriteFolder: (folderId, name) => {
        set((s) => ({
          favoriteFolders: s.favoriteFolders.map((f) => (f.id === folderId ? { ...f, name } : f)),
        }));
      },

      deleteFavoriteFolder: (folderId) => {
        set((s) => {
          const folder = s.favoriteFolders.find((f) => f.id === folderId);
          const movedEntries = folder?.entries ?? [];
          return {
            favorites: [...s.favorites, ...movedEntries],
            favoriteFolders: s.favoriteFolders.filter((f) => f.id !== folderId),
          };
        });
      },

      toggleFavoriteFolder: (folderId) => {
        set((s) => ({
          favoriteFolders: s.favoriteFolders.map((f) =>
            f.id === folderId ? { ...f, collapsed: !f.collapsed } : f,
          ),
        }));
      },

      moveFavoriteToFolder: (url, folderId) => {
        set((s) => {
          const entry = s.favorites.find((f) => f.url === url);
          if (!entry) return s;
          return {
            favorites: s.favorites.filter((f) => f.url !== url),
            favoriteFolders: s.favoriteFolders.map((folder) =>
              folder.id === folderId ? { ...folder, entries: [...folder.entries, entry] } : folder,
            ),
          };
        });
      },

      moveHistoryToFavorites: (entry, folderId) => {
        set((s) => {
          const existsTopLevel = s.favorites.some((f) => f.url === entry.url);
          const existsInFolder = s.favoriteFolders.some((folder) =>
            folder.entries.some((e) => e.url === entry.url),
          );
          if (existsTopLevel || existsInFolder) return s;
          const newEntry: BrowserHistoryEntry = { ...entry, visitedAt: new Date().toISOString() };
          if (folderId) {
            return {
              favoriteFolders: s.favoriteFolders.map((folder) =>
                folder.id === folderId
                  ? { ...folder, entries: [...folder.entries, newEntry] }
                  : folder,
              ),
            };
          }
          return { favorites: [...s.favorites, newEntry] };
        });
      },

      removeFavoriteFromFolder: (url, folderId) => {
        set((s) => ({
          favoriteFolders: s.favoriteFolders.map((folder) =>
            folder.id === folderId
              ? { ...folder, entries: folder.entries.filter((e) => e.url !== url) }
              : folder,
          ),
        }));
      },

      // ── Editor actions ──────────────────────────────────────────────

      openEditorFile: (relativePath) => {
        set((s) => {
          const pes = getProjectEditor(s.editorStateByProjectId, s.activeProjectId);
          // Check if already open
          const existing = pes.tabs.find((t) => t.relativePath === relativePath);
          if (existing) {
            return {
              editorStateByProjectId: updateProjectEditorInMap(
                s.editorStateByProjectId,
                s.activeProjectId,
                (p) => ({ ...p, activeTabId: existing.id }),
              ),
            };
          }
          const id = nextEditorTabId();
          const newTab: EditorTab = { id, relativePath, pinned: false };
          // Replace the current unpinned "preview" tab if one exists
          const activeTab = pes.tabs.find((t) => t.id === pes.activeTabId);
          if (activeTab && !activeTab.pinned) {
            return {
              editorStateByProjectId: updateProjectEditorInMap(
                s.editorStateByProjectId,
                s.activeProjectId,
                (p) => ({
                  tabs: p.tabs.map((t) => (t.id === activeTab.id ? newTab : t)),
                  activeTabId: id,
                }),
              ),
            };
          }
          // No preview tab — add as new
          return {
            editorStateByProjectId: updateProjectEditorInMap(
              s.editorStateByProjectId,
              s.activeProjectId,
              (p) => ({
                tabs: [...p.tabs, newTab],
                activeTabId: id,
              }),
            ),
          };
        });
      },

      pinEditorTab: (tabId) => {
        set((s) => ({
          editorStateByProjectId: updateProjectEditorInMap(
            s.editorStateByProjectId,
            s.activeProjectId,
            (p) => ({
              ...p,
              tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, pinned: true } : t)),
            }),
          ),
        }));
      },

      closeEditorTab: (tabId) => {
        set((s) => ({
          editorStateByProjectId: updateProjectEditorInMap(
            s.editorStateByProjectId,
            s.activeProjectId,
            (pes) => {
              const idx = pes.tabs.findIndex((t) => t.id === tabId);
              if (idx < 0) return pes;
              const remaining = pes.tabs.filter((t) => t.id !== tabId);
              if (remaining.length === 0) return { tabs: [], activeTabId: null };
              const needsNew = pes.activeTabId === tabId;
              return {
                tabs: remaining,
                activeTabId: needsNew
                  ? (remaining[Math.min(idx, remaining.length - 1)]?.id ?? null)
                  : pes.activeTabId,
              };
            },
          ),
        }));
      },

      setActiveEditorTab: (tabId) => {
        set((s) => ({
          editorStateByProjectId: updateProjectEditorInMap(
            s.editorStateByProjectId,
            s.activeProjectId,
            (pes) => {
              if (!pes.tabs.some((t) => t.id === tabId)) return pes;
              return { ...pes, activeTabId: tabId };
            },
          ),
        }));
      },
    }),
    {
      name: SIDE_PANEL_STORAGE_KEY,
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        open: state.open,
        mode: state.mode,
        browserStateByProjectId: state.browserStateByProjectId,
        editorStateByProjectId: state.editorStateByProjectId,
        favorites: state.favorites,
        favoriteFolders: state.favoriteFolders,
        history: state.history,
      }),
      onRehydrateStorage: () => (state) => {
        // One-time cleanup after hydration — sanitize any corrupted tab URLs
        if (!state) return;
        const cleaned = sanitizeBrowserStateMap(state.browserStateByProjectId);
        if (cleaned !== state.browserStateByProjectId) {
          useSidePanelStore.setState({ browserStateByProjectId: cleaned });
        }
      },
      migrate: (persisted: unknown, version: number) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2 || !state["favoriteFolders"]) {
          state["favoriteFolders"] = [];
        }
        if (version < 4 || !state["editorStateByProjectId"]) {
          state["editorStateByProjectId"] = {};
        }
        // Clean stale fields from ancient store versions
        delete state["tabs"];
        delete state["activeTabId"];
        // Sanitize any [object Object] URLs in persisted tab data
        const bsMap = state["browserStateByProjectId"] as
          | Record<
              string,
              { tabs?: { id: string; url: string; title: string; favicon: string | null }[] }
            >
          | undefined;
        if (bsMap && typeof bsMap === "object") {
          for (const projectId of Object.keys(bsMap)) {
            const pbs = bsMap[projectId];
            if (pbs?.tabs) {
              pbs.tabs = pbs.tabs.filter(
                (t) =>
                  typeof t.url === "string" && t.url !== "[object Object]" && t.url !== "undefined",
              );
            }
          }
        }
        return state as unknown as SidePanelStore;
      },
    },
  ),
);

/** Selector: get tabs for the active project */
export function selectProjectTabs(state: SidePanelStore): BrowserTab[] {
  return getProjectBrowser(state.browserStateByProjectId, state.activeProjectId).tabs;
}

/** Selector: get active tab id for the active project */
export function selectProjectActiveTabId(state: SidePanelStore): string | null {
  return getProjectBrowser(state.browserStateByProjectId, state.activeProjectId).activeTabId;
}

/** Selector: get editor tabs for the active project */
export function selectProjectEditorTabs(state: SidePanelStore): EditorTab[] {
  return getProjectEditor(state.editorStateByProjectId, state.activeProjectId).tabs;
}

/** Selector: get active editor tab id for the active project */
export function selectProjectActiveEditorTabId(state: SidePanelStore): string | null {
  return getProjectEditor(state.editorStateByProjectId, state.activeProjectId).activeTabId;
}
